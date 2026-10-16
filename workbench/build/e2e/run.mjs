/* 权限降级矩阵：用真实 Edge/Chrome 跑 workbench/index.html，逐条验证扫描与授权链路。

   覆盖目标（旧自动化全部走不到的部分）：
   - 选择 C:\ 这类位置时不再「选完才报错」
   - 只读权限下扫描与浏览照常可用
   - 保存时才争取写权限，且必须在用户手势内
   - 页面加载/刷新路径绝不调用 requestPermission
   - 深层项目可用深度扫描扫到
   - 大根目录在预算内返回且不静默截断
   - 兼容模式处理大清单时不冻结主线程

   用法：node build/e2e/run.mjs [--only M3] [--browser <path>]
   退出码：全通过 0，任一失败 1（可挂 CI）。 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, connect, shutdown, findBrowser, fileUrl } from './cdp.mjs';
import { fsMockSource, FLAT_FILES_HELPER } from './fs-mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..', '..', 'index.html');

const results = [];
function ck(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + id + ' ' + name + (detail ? ' — ' + detail : ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 轮询等待：页面里没有可 await 的 Promise 句柄，只能按 DOM 状态轮询 */
async function until(tab, jsExpr, timeoutMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await tab.evalJs(jsExpr); } catch (e) { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(150);
  }
}

async function goControl(tab) {
  await tab.evalJs("setView('control')");
  await sleep(150);
}

/* 目录扫描进行中时按钮文案是「扫描中…点击取消」，用它判断扫描结束 */
const IDLE = `(() => {
  const b = document.querySelector('[data-act="dir-scan"]');
  return !b || b.textContent.indexOf('扫描中') < 0;
})()`;

async function newScenario(conn, plan, tree) {
  const tab = await conn.newTab();
  await tab.inject(FLAT_FILES_HELPER);
  await tab.inject(fsMockSource(plan, tree));
  await tab.goto(fileUrl(PAGE, 'fs=' + plan));
  return tab;
}

async function scanDone(tab) {
  await until(tab, IDLE, 30000);
  await sleep(200);
}

/* ------------------------------------------------------------------ */

async function casePickBlocked(conn) {
  /* M1+M2：模拟选择 C:\ 盘根 —— showDirectoryPicker 本身抛 SecurityError */
  const tab = await newScenario(conn, 'blocked-pick', 'std');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await sleep(400);
    const log = await tab.evalJs('window.__FS__.log');
    const picks = log.filter((o) => o.op === 'pick');
    ck('M1', '盘根被拦时只弹一次选择器（不再链式重试）', picks.length === 1, 'pick 次数 ' + picks.length);
    ck('M2', '选择目录时申请的是「读」而非「读写」', picks.length === 1 && picks[0].mode === 'read',
      picks.length ? String(picks[0].mode) : '—');
    const bar = await tab.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M1b', '失败原因常驻显示（用户不再「不知道为什么没反应」）', bar.includes('上次失败'), '');
    ck('M1c', '失败提示里给出可行动的下一步', bar.includes('兼容模式扫描') && bar.includes('上次失败'), '');
  } finally { await tab.close(); }
}

async function caseReadOnlyScan(conn) {
  /* M3+M4：只读权限下，扫描与 repo 浏览都应照常可用 */
  const tab = await newScenario(conn, 'read', 'std');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    const n = await tab.evalJs('zeroProjects().length');
    ck('M3', '只读权限下扫描出 2 个项目', n === 2, String(n) + ' 个');
    const bar = await tab.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M3b', '状态显示「已授权 · 只读浏览」而不是「可读写」',
      bar.includes('已授权 · 只读浏览') && !bar.includes('已授权 · 可读写'), '');
    ck('M3c', '权限行明确区分只读', bar.includes('权限') && bar.includes('只读'), '');
    const log = await tab.evalJs('window.__FS__.log');
    const rwReq = log.filter((o) => o.op === 'request' && o.mode === 'readwrite');
    ck('M4', '扫描与浏览全程未请求过写权限', rwReq.length === 0, 'readwrite 请求 ' + rwReq.length + ' 次');

    /* 打开项目，repo 窗格应自动进入可浏览的 live 模式 */
    const pid = await tab.evalJs('(zeroProjects()[0] || {}).id');
    await tab.evalJs(`openProject(${JSON.stringify(pid)})`);
    const live = await until(tab, `!!document.querySelector('[data-live-tree]')`, 8000);
    ck('M4b', '只读权限下 repo 窗格仍能解析目录并浏览', live, live ? 'live' : 'snapshot');
    const note = await tab.evalJs("(document.getElementById('wbSplit')||{}).innerHTML || ''");
    ck('M4c', '窗格文案如实说明是只读（不再谎称可直接保存）',
      note.includes('只读') && !note.includes('可直接读取并保存文件'), '');
  } finally { await tab.close(); }
}

async function caseSaveUpgrade(conn, plan, expectWrites) {
  const tab = await newScenario(conn, plan, 'std');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    const pid = await tab.evalJs('(zeroProjects()[0] || {}).id');
    await tab.evalJs(`openProject(${JSON.stringify(pid)})`);
    await until(tab, `!!document.querySelector('[data-live-tree]')`, 8000);
    /* 目录树是异步填充的（容器先于行出现），必须等文件行真的渲染出来。
       打开文件这一步直接调 liveOpen：它在别处已被覆盖，这里要测的是「保存」这一下。 */
    await until(tab, `!!document.querySelector('[data-act="live-open"]')`, 8000);
    const rel = await tab.evalJs(`(() => {
      const b = document.querySelector('[data-act="live-open"]');
      return b ? b.dataset.rel : null;
    })()`);
    await tab.evalJs(`liveOpen(${JSON.stringify(pid)}, 0, ${JSON.stringify(rel || '')})`);
    await until(tab, `!!document.querySelector('[data-act="live-save"]')`, 8000);
    /* 只有这一下必须是真实手势：requestPermission 依赖 user activation。
       等证据出现而不是死等固定时长，否则会偶发「点到了但还没执行完就断言」的假失败。 */
    await tab.click('[data-act="live-save"]');
    await until(tab, `(() => {
      const F = window.__FS__;
      const t = document.getElementById('toasts');
      return F.writes.length > 0
        || F.log.some(o => o.op === 'request' && o.mode === 'readwrite')
        || (t && t.textContent && t.textContent.indexOf('未能取得写权限') >= 0);
    })()`, 8000);
    const writes = await tab.evalJs('window.__FS__.writes.length');
    const log = await tab.evalJs('window.__FS__.log');
    const reqs = log.filter((o) => o.op === 'request' && o.mode === 'readwrite');
    if (expectWrites) {
      ck('M5', '点保存时才争取写权限，且手势有效', reqs.length >= 1 && reqs.every((o) => o.gesture === true),
        reqs.map((o) => 'gesture=' + o.gesture).join(',') || '未发起');
      ck('M5b', '升级成功后写入磁盘', writes === 1, writes + ' 次写盘');
    } else {
      ck('M6', '写权限被拒时不写入任何内容', writes === 0, writes + ' 次写盘');
      const still = await tab.evalJs(`!!document.querySelector('[data-live-tree]')`);
      ck('M6b', '被拒后仍可继续浏览（句柄未被清除）', still, still ? '仍可浏览' : '浏览中断');
      const toast = await tab.evalJs("(document.getElementById('toasts')||{}).textContent || ''");
      ck('M6c', '给出可行动的解释而不是笼统的「写入失败」', toast.includes('未能取得写权限'),
        (toast || '').slice(0, 30));
    }
  } finally { await tab.close(); }
}

async function caseLoadNoRequest(conn) {
  /* M7：页面加载（含刷新恢复）路径绝不能调用 requestPermission */
  const tab = await newScenario(conn, 'read', 'std');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    /* 重新导航，模拟刷新：注入脚本会把 __FS__ 重置，日志只记这次加载之后的调用 */
    await tab.goto(fileUrl(PAGE, 'fs=read'));
    await sleep(1200);
    const log = await tab.evalJs('window.__FS__.log');
    const reqs = log.filter((o) => o.op === 'request');
    ck('M7', '刷新加载时未调用 requestPermission（旧实现必失败且会硬扫一遍）', reqs.length === 0,
      reqs.length + ' 次请求');
    const bar = await tab.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M7b', '刷新后仍保持已授权状态', bar.includes('已授权'), '');
  } finally { await tab.close(); }
}

async function caseResume(conn) {
  /* M8+M9：刷新后权限被收回 → 提示续期 → 点一次即恢复（只要读权限） */
  const tab = await newScenario(conn, 'read', 'std');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    await tab.close();
  } catch (e) { /* 下面用新标签页模拟 prompt 态 */ }

  const t2 = await newScenario(conn, 'prompt', 'std');
  try {
    await goControl(t2);
    await t2.click('[data-act="dir-pick"]');
    await until(t2, IDLE, 15000);
    /* 重新导航模拟刷新：此时浏览器把权限降为 prompt */
    await t2.goto(fileUrl(PAGE, 'fs=prompt'));
    await sleep(1200);
    const bar = await t2.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M8', '刷新后显示「需续期」而不是谎称已授权',
      bar.includes('需续期'), (bar.match(/需续期[^<]*/) || [''])[0]);
    const logBefore = await t2.evalJs('window.__FS__.log');
    ck('M8b', '刷新恢复路径未自动请求权限', logBefore.filter((o) => o.op === 'request').length === 0, '');
    await goControl(t2);
    await t2.click('[data-act="dir-resume"]');
    await scanDone(t2);
    const log = await t2.evalJs('window.__FS__.log');
    const reqs = log.filter((o) => o.op === 'request');
    ck('M9', '续期只申请「读」权限且恰好一次',
      reqs.length === 1 && reqs[0].mode === 'read' && reqs[0].gesture === true,
      reqs.map((o) => o.mode + '/gesture=' + o.gesture).join(',') || '未发起');
    const bar2 = await t2.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M9b', '续期后恢复为只读浏览并可直接扫描', bar2.includes('已授权 · 只读浏览'), '');
  } finally { await t2.close(); }
}

async function caseDeepScan(conn) {
  /* M10：项目埋在第 6 层，普通扫描够不到，深度扫描才够得到 */
  const tab = await newScenario(conn, 'read', 'deep');
  try {
    await goControl(tab);
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    const n1 = await tab.evalJs('zeroProjects().length');
    ck('M10', '普通扫描（4 层）扫不到第 6 层的项目', n1 === 0, n1 + ' 个');
    await tab.click('[data-act="dir-deep"]');
    await sleep(200);
    await tab.click('[data-act="dir-scan"]');
    await scanDone(tab);
    const n2 = await tab.evalJs('zeroProjects().length');
    ck('M10b', '开深度扫描后扫到该项目', n2 === 1, n2 + ' 个');
  } finally { await tab.close(); }
}

async function caseHugeRoot(conn) {
  /* M11：100×100 目录的超大根，必须在预算内返回并如实标注截断 */
  const tab = await newScenario(conn, 'read', 'huge');
  try {
    await goControl(tab);
    const t0 = Date.now();
    await tab.click('[data-act="dir-pick"]');
    await scanDone(tab);
    const ms = Date.now() - t0;
    ck('M11', '超大根在 8 秒内返回（不会卡住不动）', ms < 8000, (ms / 1000).toFixed(1) + 's');
    const bar = await tab.evalJs("(document.getElementById('dirBar')||{}).innerHTML || ''");
    ck('M11b', '截断被如实告知，不假装扫全了', bar.includes('已达扫描上限'), '');
  } finally { await tab.close(); }
}

async function caseFlatBigList(conn) {
  /* M12：兼容模式 60000 个文件清单 —— 主线程不能被饿死，列目录不能是 O(n) */
  const tab = await conn.newTab();
  await tab.inject(FLAT_FILES_HELPER);
  await tab.goto(fileUrl(PAGE, 'fs=read'));
  try {
    /* 计时与心跳都从「清单交到页面手上」那一刻起算：
       构造六万个 File 是桩自己的成本，算进来就测不到 scanFlatList 本身了。 */
    await tab.evalJs(`(() => {
      __mkFlatFiles(60000, 'BigRoot', function(f){
        window.__HB = 0; window.__T1 = Date.now(); __fireFlat(f);
      });
      return 'OK';
    })()`);
    await until(tab, `(() => {
      const t = document.getElementById('toasts');
      return !!(t && t.textContent && t.textContent.indexOf('兼容模式扫描完成') >= 0);
    })()`, 60000);
    const ms = await tab.evalJs('Date.now() - window.__T1');
    const hb = await tab.evalJs('window.__HB');
    /* 16ms 心跳：若主线程被长任务独占，实际心跳次数会远低于耗时/16。
       容许一半的损耗（定时器合并 + 后台节流），再多就说明扫描把界面卡死了。 */
    const expected = ms / 16 / 2;
    ck('M12', '处理 6 万条清单时主线程未被饿死', hb >= expected,
      '心跳 ' + hb + ' 次 / 期望 ≥' + Math.round(expected) + ' · 用时 ' + (ms / 1000).toFixed(1) + 's');
    const n = await tab.evalJs('zeroProjects().length');
    ck('M12b', '从清单里识别出项目', n > 0, n + ' 个');
    /* 列 5 次目录的总耗时：旧实现每次全量遍历 6 万条，这里必须是查表 */
    const t1 = Date.now();
    await tab.evalJs(`(() => { for (let i = 0; i < 5; i++) flatListAt('p' + i); return 1; })()`);
    const listMs = Date.now() - t1;
    ck('M12c', '切目录是查表而非全量遍历（5 次 < 50ms）', listMs < 50, listMs + 'ms');
    /* 光有「识别到项目」不够：清单若在第 4 万条就被 MAX_FLAT_FILES 截断，
       照样能认出前面那批项目。必须直接核对整棵树吃进去了多少条。 */
    const consumed = await tab.evalJs('flatFiles ? flatFiles.size : -1');
    ck('M12d', '6 万条清单被完整消费（没被清单上限悄悄截断）', consumed === 60000,
      consumed + ' / 60000 条');
    const st = await tab.evalJs('JSON.stringify(zeroScan.stats || {})');
    ck('M12e', '完整消费时如实标注未截断', st.indexOf('"truncated":false') >= 0, st);
  } finally { await tab.close(); }
}

/* ------------------------------------------------------------------ */

const CASES = {
  M1: casePickBlocked,
  M3: caseReadOnlyScan,
  M5: () => null,
  M7: caseLoadNoRequest,
  M8: caseResume,
  M10: caseDeepScan,
  M11: caseHugeRoot,
  M12: caseFlatBigList
};

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

  if (!fs.existsSync(PAGE)) {
    console.log('✗ 找不到产物 ' + PAGE + '，请先跑 node build/build-public.mjs');
    process.exit(1);
  }
  const browser = findBrowser();
  if (!browser) {
    console.log('跳过：未找到 Edge / Chrome，可用 --browser 或 WT_BROWSER 指定');
    process.exit(0);
  }

  const port = 9400 + Math.floor(Math.random() * 400);
  const launched = await launch(browser, port);
  const conn = await connect(launched);
  console.log('浏览器 : ' + browser);
  console.log('产物   : ' + PAGE + '（' + (fs.statSync(PAGE).size / 1024).toFixed(1) + ' KB）\n');

  try {
    if (only) {
      if (only === 'M5') await caseSaveUpgrade(conn, 'upgrade-ok', true);
      else if (only === 'M6') await caseSaveUpgrade(conn, 'upgrade-deny', false);
      else if (CASES[only]) await CASES[only](conn);
      else { console.log('未知用例 ' + only); process.exit(1); }
    } else {
      console.log('【盘根被拦】'); await casePickBlocked(conn);
      console.log('\n【只读权限】'); await caseReadOnlyScan(conn);
      console.log('\n【保存时升级 · 成功】'); await caseSaveUpgrade(conn, 'upgrade-ok', true);
      console.log('\n【保存时升级 · 被拒】'); await caseSaveUpgrade(conn, 'upgrade-deny', false);
      console.log('\n【刷新加载】'); await caseLoadNoRequest(conn);
      console.log('\n【续期】'); await caseResume(conn);
      console.log('\n【深度扫描】'); await caseDeepScan(conn);
      console.log('\n【超大根】'); await caseHugeRoot(conn);
      console.log('\n【兼容模式大清单】'); await caseFlatBigList(conn);
    }
  } catch (e) {
    console.log('\n✗ 驱动器异常：' + (e && e.message ? e.message : e));
    results.push({ id: 'ERR', name: '驱动器异常', ok: false, detail: String(e && e.message) });
  } finally {
    await shutdown(launched, conn);
  }

  const bad = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(52));
  console.log('通过 ' + (results.length - bad.length) + ' / ' + results.length);
  if (bad.length) {
    console.log('\n失败项：');
    bad.forEach((r) => console.log('  ✗ ' + r.id + ' ' + r.name + (r.detail ? ' — ' + r.detail : '')));
    process.exit(1);
  }
  console.log('全部通过 ✓');
  process.exit(0);
}

main();
