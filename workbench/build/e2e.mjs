/* 真实浏览器端到端（开发期可选）：用 Edge / Chrome 的 headless 模式 + CDP
   在 file:// 下真跑一遍 index.html 的「零服务模式」：授权 → 扫描 → 渲染 → 读写。

   为什么需要它：静态校验与沙箱冒烟只能证明逻辑正确，证明不了「真实浏览器 + file://」
   下 DOM/CSS/IndexedDB 都能跑通。本脚本用真实引擎复核，并独立探测 file:// 下 IndexedDB 可用性。

   唯一无法自动化的是操作系统的目录选择弹窗，因此用注入的假 FileSystemDirectoryHandle 代替。
   本脚本的假句柄只覆盖「授权 → 扫描 → 渲染 → 读写」这条主链路，
   权限矩阵（只读 / 被拒 / 盘根被拦 / 刷新续期 / 深度扫描）由 build/e2e/run.mjs 覆盖 ——
   那里的句柄桩额外补了真实 FileSystemHandle 才有的两项行为（可被 IndexedDB 结构化克隆、
   requestPermission 与 queryPermission 状态联动），所以才能测到句柄持久化与刷新续期。

   用法：node build/e2e.mjs [目标产物，默认 index.html]
   浏览器可用环境变量 WT_BROWSER 指定。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = process.argv[2] || 'index.html';   // 与 build-public.mjs 的产出名保持一致
const PAGE = path.join(ROOT, TARGET);
const PORT = 9300 + Math.floor(Math.random() * 500);

const BROWSERS = [
  process.env.WT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

const browser = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!browser) {
  console.log('跳过真实浏览器端到端：未找到 Edge / Chrome。可用 WT_BROWSER 指定可执行文件路径。');
  process.exit(0);
}
if (!fs.existsSync(PAGE)) {
  console.log('找不到产物：' + PAGE + '（先跑 node build/build.mjs 或 node build/build-public.mjs）');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ck = (n, c, d) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n + (d ? ' \u2014 ' + d : '')); if (!c) fails.push(n); };

/* 注入到新文档执行、早于页面脚本：伪造一个目录树，覆盖 window.showDirectoryPicker */
const STUB = `
(function(){
  function mkFile(name, text, lastModified){
    return {
      kind:'file', name,
      async getFile(){ return { name, size: text.length, lastModified: lastModified || 1750000000000, text: async () => text }; },
      async queryPermission(){ return 'granted'; },
      async requestPermission(){ return 'granted'; }
    };
  }
  function mkDir(name, children){
    const map = new Map(children.map(c => [c.name, c]));
    return {
      kind:'directory', name,
      async *entries(){ for (const c of children) yield [c.name, c]; },
      async *values(){ for (const c of children) yield c; },
      async *keys(){ for (const c of children) yield c.name; },
      async getDirectoryHandle(n){ const c = map.get(n); if (!c || c.kind !== 'directory') throw new Error('NotFound: ' + n); return c; },
      async getFileHandle(n){ const c = map.get(n); if (!c || c.kind !== 'file') throw new Error('NotFound: ' + n); return c; },
      async queryPermission(){ return 'granted'; },
      async requestPermission(){ return 'granted'; },
      async isSameEntry(o){ return o === this; }
    };
  }
  var ROOT = mkDir('MyProjects', [
    mkDir('smart-car', [
      mkFile('README.md', '# 智能小车\\n\\n基于 STM32F103 的两轮差速小车，含电机 PWM 驱动与编码器测速。\\n'),
      mkFile('CMakeLists.txt', 'project(smart_car)\\n'),
      mkDir('src', [mkFile('main.c', 'int main(){return 0;}\\n')]),
      mkDir('.git', [mkFile('HEAD', 'ref: refs/heads/main\\n')])
    ]),
    mkDir('web-dash', [
      mkFile('package.json', '{"name":"web-dash","scripts":{"dev":"vite --port 5173"}}'),
      mkFile('README.md', '# 数据看板\\n\\nVite + Vue3 轻量看板。\\n')
    ]),
    mkDir('scratch', [mkFile('notes.txt', 'hello\\n')]),
    mkDir('node_modules', [mkDir('junk', [mkFile('package.json', '{}')])])
  ]);
  var SOLO = mkDir('solo-app', [
    mkFile('package.json', '{"name":"solo-app","scripts":{"dev":"vite --port 4321"}}'),
    mkFile('README.md', '# 单项目\\n\\n直接选中的项目文件夹本身应被识别。\\n'),
    mkDir('.git', [mkFile('HEAD', 'ref: refs/heads/main\\n')])
  ]);
  /* 超大根：模拟选到 C:\\ —— 40 个顶层目录 × 80 个子目录，远超 2500 个目录的遍历预算 */
  var SUBS = []; for (var i = 0; i < 80; i++) SUBS.push(mkDir('sub' + i, [mkFile('notes.txt', 'x')]));
  var TOPS = []; for (var i = 0; i < 40; i++) TOPS.push(mkDir('dir' + i, SUBS));
  var BIG = mkDir('BigDrive', TOPS.concat([
    mkDir('zz-late-project', [mkFile('package.json', '{"name":"late"}'), mkDir('.git', [mkFile('HEAD', 'x')])]),
    mkDir('Windows', [mkDir('System32', [mkDir('packaged', [mkFile('package.json', '{}')])])]),
    mkDir('Program Files', [mkDir('Vendor', [mkFile('package.json', '{}')])]),
    mkDir('AppData', [mkDir('Local', [mkDir('app-junk', [mkFile('package.json', '{}')])])])
  ]));
  window.__wtRoots = { root: ROOT, solo: SOLO, big: BIG };
  window.__wtUse = function(which){ window.showDirectoryPicker = async function(){ return window.__wtRoots[which]; }; };
  window.__wtUse('root');
  window.__wtStubReady = true;
})();
`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-e2e-'));
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-sync', '--disable-component-update',
  '--disable-background-networking', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  'about:blank'
], { stdio: 'ignore' });

let ws = null, seq = 0;
const pending = new Map();
const events = [];
function send(method, params, sessionId) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 20000);
  });
}

async function main() {
  console.log('浏览器 : ' + browser);
  console.log('目标   : ' + PAGE);

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json()).webSocketDebuggerUrl; if (wsUrl) break; } catch (e) {}
    await sleep(250);
  }
  if (!wsUrl) { console.log('✗ 浏览器调试端口未就绪'); process.exitCode = 1; return; }

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
    } else if (msg.method) events.push(msg);
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB }, sessionId);

  const fileUrl = 'file:///' + PAGE.replace(/\\/g, '/').replace(/^\//, '');
  await send('Page.navigate', { url: fileUrl }, sessionId);
  for (let i = 0; i < 80; i++) { if (events.some((e) => e.method === 'Page.loadEventFired')) break; await sleep(150); }
  await sleep(700);

  const evalJs = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : 'eval 异常');
    return r.result.value;
  };

  console.log('\n【环境（file://）】');
  ck('注入桩就绪', await evalJs('!!window.__wtStubReady'));
  ck('isSecureContext', await evalJs('window.isSecureContext'));
  ck('showDirectoryPicker 可用', await evalJs('typeof window.showDirectoryPicker === "function"'));

  console.log('\n【file:// 下 IndexedDB 独立探测】');
  const idbProbe = await evalJs(`new Promise(res => {
    const t = setTimeout(() => res('TIMEOUT'), 3000);
    try {
      const rq = indexedDB.open('wt-e2e-probe', 1);
      rq.onsuccess = () => { clearTimeout(t); res('OK'); };
      rq.onerror = () => { clearTimeout(t); res('ERROR'); };
      rq.onblocked = () => { clearTimeout(t); res('BLOCKED'); };
    } catch (e) { clearTimeout(t); res('THROW:' + e.message); }
  })`, true);
  ck('IndexedDB.open 成功', idbProbe === 'OK', idbProbe);

  console.log('\n【启动状态】');
  ck('dirBar 给出「选择本机目录」入口', (await evalJs('document.getElementById("dirBar").textContent')).includes('选择本机目录'));
  ck('未授权时不误报已授权', !(await evalJs('document.getElementById("dirBar").textContent')).includes('已授权'));

  console.log('\n【选择本机目录 → 扫描】');
  await evalJs('pickScanRoot()', true);
  await sleep(400);
  const zs = JSON.parse(await evalJs('JSON.stringify(zeroProjects().map(p => ({name:p.name, langs:p.langs, git:p.git, ports:p.ports})))'));
  ck('扫描出 2 个项目（无标记目录与 node_modules 已排除）', zs.length === 2, zs.map((p) => p.name).join(','));
  ck('.git 目录被认成项目', zs.some((p) => p.name === 'smart-car' && p.git));
  ck('工程标记文件推导语言', zs.some((p) => p.name === 'smart-car' && p.langs.includes('C/C++')));
  ck('package.json 声明端口被解析', zs.some((p) => p.name === 'web-dash' && p.ports.includes(5173)));
  ck('扫描结果并入项目栏', (await evalJs('allProjects().length')) === (await evalJs('DATA.projects.length')) + 2);
  ck('dirBar 显示「已授权 · 可读写」', (await evalJs('document.getElementById("dirBar").textContent')).includes('已授权'));
  ck('模式徽章 = 本机目录 · 零服务读写', (await evalJs('document.getElementById("modeBadge").textContent')).includes('本机目录'));
  const cardHtml = await evalJs('document.getElementById("cardGrid").innerHTML');
  ck('卡片网格渲染出扫描项目', cardHtml.includes('smart-car') && cardHtml.includes('web-dash'));

  console.log('\n【IndexedDB 读写链路】');
  const rt = await evalJs(`(async () => { try { await idbPut('__e2e__','v'); return await idbGet('__e2e__'); } catch (e) { return 'ERR:' + (e && e.message); } })()`, true);
  ck('idbPut / idbGet 往返成功', rt === 'v', String(rt));

  console.log('\n【repo 窗格随扫描根自动读写】');
  await evalJs('(async()=>{ openProject(zeroProjects()[0].id); })()', true);
  await sleep(500);
  ck('repo 窗格进入可读写（data-live-tree）', (await evalJs('document.getElementById("wbSplit").innerHTML')).includes('data-live-tree'));

  console.log('\n【回归：直接选中单个项目文件夹当扫描根】');
  await evalJs('clearScanRoot()', true);
  await sleep(200);
  await evalJs('window.__wtUse("solo")');
  await evalJs('pickScanRoot()', true);
  await sleep(300);
  const solo = JSON.parse(await evalJs('JSON.stringify(zeroProjects().map(p => ({name:p.name, path:p.path})))'));
  ck('根目录本身被认成 1 个项目', solo.length === 1, solo.map((p) => p.name).join(','));
  ck('根项目名取目录名', solo[0] && solo[0].name === 'solo-app', solo[0] ? solo[0].name : '—');
  ck('根项目路径非空且无尾部分隔符', !!solo[0] && !!solo[0].path && !/[\\/]$/.test(solo[0].path), solo[0] ? solo[0].path : '—');
  ck('根项目渲染进卡片网格', (await evalJs('document.getElementById("cardGrid").innerHTML')).includes('solo-app'));

  console.log('\n【回归：超大根（C:\\ 场景）· 不再「点了没反应」】');
  await evalJs('clearScanRoot()', true);
  await sleep(200);
  await evalJs('window.__wtUse("big")');
  /* 扫描可能在毫秒级完成，轮询抓不稳；改为包装 setScanState 记录每一次调用，确定性更强 */
  await evalJs('window.__wtProgress = []; window.__wtSetScanState = setScanState; setScanState = m => { window.__wtProgress.push(m); return window.__wtSetScanState(m); };');
  const t0 = Date.now();
  await evalJs('pickScanRoot()', true);
  await sleep(200);
  const elapsed = Date.now() - t0;
  await evalJs('setScanState = window.__wtSetScanState');
  const progress = JSON.parse(await evalJs('JSON.stringify(window.__wtProgress)'));
  ck('扫描期间界面有实时进度反馈', progress.some((m) => m.includes('正在扫描')), progress.slice(0, 3).join(' | ') || '无');
  ck('进度行接入了真实 DOM（扫描结束应被清空）',
    await evalJs('(() => { setScanState("进度探针"); const ok = document.getElementById("dirBar").textContent.includes("进度探针"); setScanState(""); return ok; })()'));
  ck('扫描在预算内返回（未挂住）', elapsed < 8000, elapsed + 'ms');
  const hstats = JSON.parse(await evalJs('JSON.stringify(zeroScan.stats)'));
  ck('遍历数被硬上限截断', hstats.visited === 2500, 'visited=' + hstats.visited);
  ck('结果标记为不完整', hstats.truncated === true, String(hstats.truncated));
  const hbar = await evalJs('document.getElementById("dirBar").textContent');
  ck('dirBar 给出「已达扫描上限」明确提示', hbar.includes('已达扫描上限'));
  const hnames = JSON.parse(await evalJs('JSON.stringify(zeroProjects().map(p => p.name))'));
  ck('巨型子树排前面也不吃光预算（广度优先）· 后置浅层项目被发现', hnames.includes('zz-late-project'), hnames.join(','));
  ck('系统目录 Windows / Program Files / AppData 被跳过',
    !hnames.includes('packaged') && !hnames.includes('Vendor') && !hnames.includes('app-junk'), hnames.join(','));

  console.log('\n【兼容模式扫描（webkitdirectory 清单 · 不依赖目录选择器）】');
  await evalJs('clearScanRoot()', true);
  await sleep(200);
  /* 真实浏览器里无法伪造 <input type=file> 的 files，但兼容模式只用到 File 的
     name / size / lastModified / webkitRelativePath / text()，用普通对象即可覆盖整条链路 */
  await evalJs(`(function(){
    var mk = function(rel, text){ return { name: rel.split('/').pop(), size: text.length, lastModified: 1750000000000, webkitRelativePath: rel, text: async function(){ return text; } }; };
    onFlatPicked({ target: { files: [
      mk('MyProjects/smart-car/README.md', '# 智能小车\\n\\n基于 STM32F103 的两轮差速小车，含电机 PWM 驱动。\\n'),
      mk('MyProjects/smart-car/CMakeLists.txt', 'project(smart_car)\\n'),
      mk('MyProjects/smart-car/src/main.c', 'int main(){return 0;}\\n'),
      mk('MyProjects/smart-car/.git/HEAD', 'ref: refs/heads/main\\n'),
      mk('MyProjects/web-dash/package.json', '{"scripts":{"dev":"vite --port 5173"}}'),
      mk('MyProjects/scratch/notes.txt', 'hello\\n')
    ] } });
  })()`, true);
  await sleep(500);
  const fzs = JSON.parse(await evalJs('JSON.stringify(zeroProjects().map(p => ({name:p.name, langs:p.langs, git:p.git})))'));
  ck('从文件清单识别出 2 个项目', fzs.length === 2, fzs.map((p) => p.name).join(','));
  ck('.git 与工程标记文件照常识别', fzs.some((p) => p.name === 'smart-car' && p.git && p.langs.includes('C/C++')));
  ck('扫描模式标记为 flat', (await evalJs('zeroScan.mode')) === 'flat');
  ck('dirBar 显示「只读（兼容模式）」', (await evalJs('document.getElementById("dirBar").textContent')).includes('只读（兼容模式）'));
  ck('模式徽章 = 兼容模式 · 只读', (await evalJs('document.getElementById("modeBadge").textContent')).includes('兼容模式'));
  ck('目录树从清单还原（真实 DOM 断言走 flatListAt）',
    (await evalJs('flatListAt("smart-car").files.map(f => f.name).join(",")')) === 'CMakeLists.txt,README.md');
  await evalJs('(async()=>{ openProject(zeroProjects().find(p => p.name === "smart-car").id); })()', true);
  await sleep(500);
  const fsplit = await evalJs('document.getElementById("wbSplit").innerHTML');
  ck('repo 窗格进入兼容模式只读', fsplit.includes('data-flat-tree') && fsplit.includes('兼容模式 · 只读'));
  ck('repo 窗格在真实浏览器里渲染出目录树（锚定到项目根，而非扫描根）',
    fsplit.includes('README.md') && fsplit.includes('CMakeLists.txt') && fsplit.includes('src/'));
  ck('清单内文件可只读打开',
    await evalJs('(async()=>{ const f = flatFiles && flatFiles.get("smart-car/README.md"); return f ? (await f.text()).indexOf("差速小车") >= 0 : false; })()', true));

  console.log('\n【控制台异常】');
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text));
  ck('无未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('');
  if (fails.length) { console.log('✗ 真实浏览器端到端失败 ' + fails.length + ' 项：\n   · ' + fails.join('\n   · ')); process.exitCode = 1; }
  else console.log('✓ 真实浏览器端到端全部通过');
}

main().catch((e) => { console.log('✗ 端到端异常：' + ((e && e.stack) || e)); process.exitCode = 1; })
  .finally(() => { try { child.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} });
