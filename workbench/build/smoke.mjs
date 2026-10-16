/* 运行时冒烟：用最小 DOM 桩在沙箱里真跑一遍脚本，捕获渲染期异常
   跑两个场景：快照模式（file://，无本地服务）与 服务模式（/api/health 可用） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = process.argv[2] || 'workbench.html';
const html = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

const failures = [];
const check = (scenario, name, cond, detail) => {
  if (cond) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failures.push(scenario + ' / ' + name); }
};

function buildContext(fetchStub) {
  const writes = [];
  const byId = new Map();

  function makeEl(tag = 'div') {
    const el = {
      tagName: tag.toUpperCase(), _html: '', _text: '', dataset: {}, value: '', disabled: false,
      style: { setProperty() {}, display: '' },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
      focus() {}, select() {}, closest: () => null,
      querySelector: () => makeEl(), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0 })
    };
    Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = v; writes.push([tag, v]); } });
    Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = v; } });
    return el;
  }
  const getEl = (id) => { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); };

  const document = {
    getElementById: getEl,
    querySelector: (s) => (s === '[data-live-tree]' || s === '[data-live-file]' ? null : makeEl()),
    querySelectorAll: () => [],
    createElement: (t) => makeEl(t),
    body: makeEl('body'),
    execCommand: () => true
  };

  const ctx = {
    document, console, Date, Math, JSON, URL, Set, Map, Array, Object, String, Number, Intl, Promise,
    setTimeout: () => 0, clearTimeout: () => {},
    fetch: fetchStub,
    localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } },
    navigator: {}, window: { addEventListener() {} }, alert() {}
  };
  ctx.window.document = document;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, writes, getEl };
}

const flush = () => new Promise((r) => setImmediate(r));

async function runScenario(label, fetchStub, server) {
  console.log('\n【' + label + '】');
  const { ctx, writes, getEl } = buildContext(fetchStub);

  let err = null;
  try { new vm.Script(src).runInContext(ctx, { timeout: 20000 }); }
  catch (e) { err = e; }
  if (err) { console.log('  ✗ 运行时异常：' + err.message); failures.push(label + ' / 脚本启动'); return; }
  check(label, '脚本启动（buildIndex → renderAll → detectServer）', true);

  const cardHtml = getEl('cardGrid')._html;
  const m = cardHtml.match(/data-act="open-project" data-pid="([^"]+)"/);
  check(label, '卡片网格已渲染', cardHtml.length > 200, cardHtml.length + ' 字符');
  check(label, '方形卡片结构（c-head/c-srow/c-preview）',
    cardHtml.includes('c-head') && cardHtml.includes('c-div') && cardHtml.includes('c-srow') && cardHtml.includes('c-preview'));
  check(label, '控制室为 2×2 方形卡片', cardHtml.includes('control-card'));
  check(label, '末尾虚线「添加项目」卡片', cardHtml.includes('add-card') && cardHtml.includes('add-plus'));
  check(label, '卡片带 emoji 图标', /<span class="c-ico"[^>]*>[^<]+<\/span>/.test(cardHtml));
  check(label, '工作中卡片带扫光层', !cardHtml.includes('busy') || cardHtml.includes('wt-sweep'));
  if (!m) { console.log('  ✗ 未取到项目 id'); failures.push(label + ' / 项目 id'); return; }
  const pid = m[1];

  ctx.openProject(pid);
  await flush();

  const splitHtml = getEl('wbSplit')._html;
  check(label, '分栏工作台已渲染', splitHtml.includes('pane-grid'), splitHtml.length + ' 字符');
  check(label, 'repo 窗格锚点存在', splitHtml.includes('class="tree"'));

  if (server) {
    check(label, '服务模式：repo 窗格显示「服务端读写」', splitHtml.includes('服务端读写') && splitHtml.includes('data-srv-tree="0"'));
    check(label, '服务模式：不再显示「连接目录」', !splitHtml.includes('连接目录'));
    check(label, '模式徽章 = 本地服务 · 可读写', getEl('modeBadge')._html.includes('本地服务'));
  } else {
    check(label, '快照模式：repo 窗格显示「连接目录」', splitHtml.includes('连接目录'));
    check(label, '快照模式：提示启动本地服务', splitHtml.includes('启动工作台.bat'));
    check(label, '模式徽章 = 快照模式 · 只读', getEl('modeBadge')._html.includes('快照模式'));
  }

  /* 用例：本地检索窗格 */
  ctx.setPaneKind(0, 'projects');
  await flush();
  const pj = getEl('wbSplit')._html;
  check(label, 'projects 窗格产出非空', pj.includes('data-proj-list="0"') && pj.includes('本地检索'));
  check(label, 'projects 窗格含搜索与刷新', pj.includes('data-field="proj-q"') && pj.includes('scan-refresh'));
  check(label, 'projects 窗格含分组与过滤', pj.includes('data-act="proj-group"') && pj.includes('data-act="proj-filter"'));

  /* 用例：AI 对话窗格 */
  ctx.setPaneKind(1, 'chat');
  await flush();
  const ch = getEl('wbSplit')._html;
  check(label, 'chat 窗格含 iframe', ch.includes('data-frame="chat-1"'));
  check(label, 'chat 窗格含预设 select', ch.includes('data-act="chat-preset"'));
  check(label, 'chat 窗格含复制项目上下文', ch.includes('data-act="copy-context"'));
  check(label, 'chat 窗格含兜底层', ch.includes('data-fallback="chat-1"'));
  check(label, 'chat 窗格体挂 chat-body 修饰类（flex 撑满高度）', ch.includes('pane-body chat-body'));
  check(label, 'normalizeUrl 给裸地址补协议',
    ctx.normalizeUrl('localhost:3210') === 'http://localhost:3210'
    && ctx.normalizeUrl('chat.deepseek.com') === 'https://chat.deepseek.com'
    && ctx.normalizeUrl('  "http://127.0.0.1:7332"  ') === 'http://127.0.0.1:7332'
    && ctx.normalizeUrl('') === '');

  /* 用例：对话布局预设自动填充 */
  ctx.clearPane(1);
  ctx.setPreset('chat');
  await flush();
  const presetHtml = getEl('wbSplit')._html;
  check(label, 'chat 预设生效', presetHtml.includes('data-preset="chat"'));
  check(label, 'chat 预设自动放入 AI 对话', presetHtml.includes('data-frame="chat-1"'));

  /* 用例：项目栏多选移除 / 恢复（放在最后，会清空项目栏再恢复） */
  const total = ctx.allProjects().length;
  const plistHtml = getEl('plist')._html;
  check(label, '项目栏行已渲染', plistHtml.includes('data-act="open-project"') && plistHtml.includes('pi-arrow'), total + ' 行');
  check(label, '项目栏「添加 / 多选」入口存在', getEl('selToggle').className === 'nl-btn');
  check(label, '默认非多选：行内无复选框、工具条与恢复条隐藏',
    !plistHtml.includes('pi-check') && getEl('selbar').className === 'selbar'
    && getEl('restoreBar').className === 'restore-bar');

  ctx.setSelectMode(true);
  check(label, '多选态：复选框 + 工具条 + 按钮高亮',
    getEl('plist')._html.includes('pi-check') && getEl('plist').className === 'plist selecting'
    && getEl('selbar').className === 'selbar show' && getEl('selToggle').className === 'nl-btn on');
  check(label, '未选中时移除按钮禁用', getEl('selDel').disabled === true);

  ctx.listSelectAll();
  check(label, '全选：计数就绪且移除按钮可用',
    getEl('selInfo')._text === '已选 ' + total + ' / ' + total + ' 项' && getEl('selDel').disabled === false);
  check(label, '全选后行内高亮', getEl('plist')._html.includes('pitem sel'));

  ctx.deleteSelected();
  check(label, '首次点「移除」进入二次确认（不落盘）',
    getEl('selDel')._text === '确认移除 ' + total + ' 项'
    && getEl('selDel').className === 'btn small danger armed'
    && ctx.allProjects().length === total);

  ctx.deleteSelected();
  check(label, '确认后项目栏清空并退出多选',
    String(getEl('plistCount')._text) === '0' && ctx.allProjects().length === 0
    && getEl('plist').className === 'plist' && getEl('selbar').className === 'selbar');
  check(label, '移除后出现恢复条', getEl('restoreBar').className === 'restore-bar show');

  ctx.restoreRemoved();
  check(label, '恢复后项目栏回满、恢复条隐藏',
    ctx.allProjects().length === total && String(getEl('plistCount')._text) === String(total)
    && getEl('restoreBar').className === 'restore-bar');
  check(label, '恢复后行内复选框消失', !getEl('plist')._html.includes('pi-check'));

  /* 用例：自定义添加 */
  getEl('fName').value = '冒烟测试项目';
  getEl('fPath').value = '';
  getEl('fLangs').value = 'Node, JS';
  ctx.confirmAdd();
  const added = ctx.allProjects().filter((p) => p.custom);
  check(label, '自定义添加落入项目栏', added.length === 1 && String(getEl('plistCount')._text) === String(total + 1),
    added.length ? added[0].alias : '未新增');
  check(label, '自定义项语言标签解析正确',
    added.length === 1 && added[0].langs.join('/') === 'Node/JS', added.length ? added[0].langs.join('/') : '—');
  check(label, '自定义项无路径时给出占位', added.length === 1 && added[0].path === '（未填写路径）');
  check(label, '自定义项渲染进侧栏列表', getEl('plist')._html.includes('冒烟测试项目'));

  check(label, '渲染写入非空', writes.filter(([, v]) => v && v.length > 40).length > 5);
}

const rejectFetch = () => Promise.reject(new Error('no local server (file:// snapshot mode)'));
const okFetch = () => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve({
    ok: true, mode: 'server', version: '2.0', root: ROOT,
    aiPresets: [{ name: '本机 Open WebUI', url: 'http://localhost:3000' }]
  })
});

await runScenario('快照模式（file://）', rejectFetch, false);
await runScenario('服务模式（/api/health 可用）', okFetch, true);

console.log('');
if (failures.length) {
  console.log('✗ 冒烟失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log('✓ 两个场景全部跑通');
