/* 运行时冒烟：用最小 DOM 桩在沙箱里真跑一遍脚本，捕获渲染期异常
   跑两个场景：快照模式（file://，无本地服务）与 服务模式（/api/health 可用） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = process.argv[2] || 'index.html';   // 与 build-public.mjs 的产出名保持一致
const html = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

const failures = [];
const check = (scenario, name, cond, detail) => {
  if (cond) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failures.push(scenario + ' / ' + name); }
};

function buildContext(fetchStub, extra) {
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
  Object.assign(ctx, extra || {});
  if (extra && extra.window) extra.window.document = document;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, writes, getEl };
}

const flush = () => new Promise((r) => setImmediate(r));
/* 假 IndexedDB 的每次事务都要跨几个宏任务才提交，多空转几轮再断言 */
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };

async function runScenario(label, fetchStub, server) {
  console.log('\n【' + label + '】');
  const { ctx, writes, getEl } = buildContext(fetchStub);

  /* 公开版不再内置示例项目（DATA.projects 为空）：给场景预置两个「扫描项目」
     （走 wt2.zero——真实扫描结果的持久化通道，与访客扫完自己机器的结果同形），
     让「取 pid → 打开项目 → 分栏 / 多选移除 / 恢复 / 自定义添加」全流程有对象可跑。
     预置两个而非一个：唯一项目若恰是当前打开项，行类名会是 'pitem active sel'，
     'pitem sel' 子串断言需要另一个未激活的行才成立。扫描项（非自定义）删除后进
     removed 可恢复，与真实行为一致。 */
  ctx.localStorage.setItem('wt2.zero', JSON.stringify({
    scannedAt: '2026-10-17T13:00:00.000Z', rootName: 'smoke-root', rootPath: '',
    mode: 'handle',
    projects: [
      { rel: 'smoke-demo', name: 'smoke-demo', path: 'D:\\projects\\smoke-demo',
        langs: ['TypeScript'], category: '本机扫描', sizeBytes: 1048576, files: 12,
        truncated: false, estimated: false, updated: '2026-10-17', git: false,
        samples: [], ports: [], live: null },
      { rel: 'smoke-demo2', name: 'smoke-demo2', path: 'D:\\projects\\smoke-demo2',
        langs: ['Python'], category: '本机扫描', sizeBytes: 2097152, files: 8,
        truncated: false, estimated: false, updated: '2026-10-16', git: false,
        samples: [], ports: [], live: null }
    ],
    stats: { visited: 6, depth: 2, errors: 0, truncated: false, measured: 2 }
  }));

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
    /* 公开版没有内置快照项目，打开的是扫描项目：repo 窗格走「零服务解析」分支，
       显示「解析中…」与零服务提示（句柄在真实浏览器里会解析成 live，沙箱里保持解析态） */
    check(label, '快照模式：扫描项目 repo 窗格显示「解析中」', splitHtml.includes('解析中'));
    check(label, '快照模式：扫描项目 repo 窗格显示零服务提示', splitHtml.includes('本机目录（零服务）'));
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

  /* repo 窗格的「连接目录」分支：公开版没有内置快照项目，自定义项没有目录树，
     repoBody 对它走 snapshot 分支——提示连接真实目录 / 启动本地服务。
     打开刚添加的这个自定义项目，把这条分支的覆盖补回来。
     仅快照模式断言：服务模式下任何项目都走服务端读写分支（上面已覆盖）。 */
  if (!server && added.length) {
    ctx.openProject(added[0].id);
    await flush();
    const snapHtml = getEl('wbSplit')._html;
    check(label, '自定义项目 repo 窗格显示「连接目录」', snapHtml.includes('连接目录'));
    check(label, '自定义项目 repo 窗格提示启动本地服务', snapHtml.includes('启动工作台.bat'));
  }

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

/* ============================================================
   零服务模式：假目录树 + 假 IndexedDB，真跑「授权 → 扫描 → 读写 → 刷新续用」
   ============================================================ */
const mkFile = (name, text, lastModified) => ({
  kind: 'file', name,
  getFile: async () => ({ name, size: text.length, lastModified: lastModified || 1750000000000, text: async () => text })
});
const mkDir = (name, children) => {
  const map = new Map(children.map((c) => [c.name, c]));
  return {
    kind: 'directory', name,
    entries: async function* () { for (const c of children) yield [c.name, c]; },
    getDirectoryHandle: async (n) => {
      const c = map.get(n);
      if (!c || c.kind !== 'directory') throw new Error('not-a-directory: ' + n);
      return c;
    },
    getFileHandle: async (n) => {
      const c = map.get(n);
      if (!c || c.kind !== 'file') throw new Error('not-a-file: ' + n);
      return c;
    }
  };
};

const ZERO_ROOT = mkDir('MyProjects', [
  mkDir('smart-car', [
    mkFile('README.md', '# 智能小车\n\n基于 STM32F103 的两轮差速小车，含电机 PWM 驱动与编码器测速。\n'),
    mkFile('CMakeLists.txt', 'project(smart_car)\n'),
    mkDir('.git', [mkFile('HEAD', 'ref: refs/heads/main\n')])
  ]),
  mkDir('web-dash', [
    mkFile('package.json', '{"scripts":{"dev":"vite --port 5173"}}'),
    mkFile('README.md', '# 数据看板\n\nVite + Vue3 轻量看板，npm run dev 后落在 5173。\n')
  ]),
  mkDir('scratch', [mkFile('notes.txt', 'hello\n')]),
  mkDir('node_modules', [mkDir('junk', [mkFile('package.json', '{}')])])
]);

/* 最小 IndexedDB 桩：句柄存进 Map，跨 context 可复用（模拟刷新后仍在）。
   两个关键点必须贴近真实 IndexedDB：
   ① transaction() 必须返回事务对象本身（oncomplete/onerror 挂在这个对象上），不能返回包装对象；
   ② 提交用宏任务（setImmediate）触发——真实 oncomplete 发生在当前任务之后，
      用微任务会在 vm 上下文里抢在同步赋值之前执行。 */
function fakeIndexedDB() {
  const store = new Map();
  const later = (fn) => setImmediate(fn);
  const mkDb = () => ({
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {};
      const os = {
        put: (v, k) => { store.set(k, v); later(() => tx.oncomplete && tx.oncomplete()); return { result: v }; },
        get: (k) => { const rq = { result: store.get(k) }; later(() => tx.oncomplete && tx.oncomplete()); return rq; },
        delete: (k) => { store.delete(k); later(() => tx.oncomplete && tx.oncomplete()); return { result: undefined }; }
      };
      tx.objectStore = () => os;
      return tx;
    }
  });
  return {
    open: () => {
      const req = {};
      later(() => {
        req.result = mkDb();
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    _store: store
  };
}

/* 上下文里的顶层 const/let 不在 globalThis 上，用 runInContext 取 */
const peek = (ctx, expr) => vm.runInContext(expr, ctx);

const zeroFetch = (url) => (String(url).includes(':5173/')
  ? Promise.resolve({ ok: true, status: 200 })
  : Promise.reject(new Error('port closed')));

async function runZeroScenario() {
  const L = '零服务模式';
  console.log('\n【零服务模式（本机目录授权 + 单页扫描）】');

  const idb = fakeIndexedDB();
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
  const win = { addEventListener() {}, showDirectoryPicker: async () => ZERO_ROOT };

  const { ctx, getEl } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  let err = null;
  try { new vm.Script(src).runInContext(ctx, { timeout: 20000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 运行时异常：' + err.message); failures.push(L + ' / 脚本启动'); return; }
  check(L, '脚本启动（含 restoreScanRoot）', true);
  await settle();   // 等启动时的 restoreScanRoot 走完 IndexedDB 读取

  const base = ctx.allProjects().length;
  check(L, '未授权时 dirBar 给出「选择本机目录」入口',
    getEl('dirBar')._html.includes('选择本机目录') && getEl('dirBar')._html.includes('零服务模式'));
  check(L, '未授权时不误报已授权', !getEl('dirBar')._html.includes('已授权 · 可读写'));

  await ctx.pickScanRoot();
  await settle();

  const zs = ctx.zeroProjects();
  check(L, '扫描出 2 个项目（无标记目录与 node_modules 已排除）', zs.length === 2, zs.map((p) => p.name).join(','));
  const car = zs.find((p) => p.name === 'smart-car');
  const dash = zs.find((p) => p.name === 'web-dash');
  check(L, '.git 目录被认成项目并标记 git', !!car && car.git === true);
  check(L, '工程标记文件推导语言标签', !!car && car.langs.indexOf('C/C++') >= 0, car ? car.langs.join('/') : '—');
  check(L, 'package.json 里的声明端口被解析', !!dash && dash.ports.indexOf(5173) >= 0, dash ? dash.ports.join(',') : '—');
  /* 预览按设计会滤掉 `# 标题` 行，取的是 README 正文首段 */
  check(L, 'README 正文首段进入卡片预览', !!car && ctx.projPreview(car).indexOf('差速小车') >= 0,
    car ? ctx.projPreview(car).slice(0, 30) : '—');
  check(L, '扫描结果并入项目栏', ctx.allProjects().length === base + 2, base + ' → ' + ctx.allProjects().length);
  check(L, '授权后 dirBar 变为「已授权 · 可读写」', getEl('dirBar')._html.includes('已授权 · 可读写'));
  check(L, '模式徽章 = 本机目录 · 零服务读写', getEl('modeBadge')._html.includes('本机目录'));
  check(L, '句柄已写入 IndexedDB', idbStoreSize(idb) > 0, String(idbStoreSize(idb)));

  /* repo 窗格：扫描根 + 相对路径自动解析成目录句柄，无需再手选目录 */
  ctx.openProject(car.id);
  await settle();
  const split = getEl('wbSplit')._html;
  check(L, '零服务下 repo 窗格自动进入可读写模式',
    split.includes('data-live-tree="0"') && split.includes('已连接真实目录'), split.includes('data-live-tree="0"') ? 'live' : 'snapshot');

  /* 端口探测（近似）：只探常见端口，命中 5173 即标记该项目的运行状态 */
  await ctx.probeLocalPorts();
  await settle();
  const lp = peek(ctx, 'localPorts');
  check(L, '端口探测覆盖常见端口清单', !!lp && lp.attempted === 27, lp ? String(lp.attempted) : '—');
  check(L, '命中端口回填到项目的 live 状态',
    ctx.zeroProjects().filter((p) => p.live && p.live.port === 5173).length === 1);
  check(L, '控制室端口条渲染探测结果', getEl('portsStrip')._html.includes(':5173'));

  /* 模拟刷新：同一个 IndexedDB / localStorage，句柄与扫描结果都应复用 */
  const { ctx: ctx2 } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  try { new vm.Script(src).runInContext(ctx2, { timeout: 20000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 刷新后运行时异常：' + err.message); failures.push(L + ' / 刷新后启动'); return; }
  await settle();
  const g2 = (expr) => peek(ctx2, expr);
  check(L, '刷新后从 localStorage 复用扫描结果（不重扫）', g2('zeroScan.projects.length') === 2, String(g2('zeroScan.projects.length')));
  check(L, '刷新后从 IndexedDB 复用目录句柄并直接授权', !!g2('scanRoot'));
  check(L, '刷新后控制室仍显示已授权', (() => { const el = ctx2.document.getElementById('dirBar'); return el && el._html.includes('已授权 · 可读写'); })());

  /* 清除：授权与扫描结果一并清空，项目栏回落 */
  await ctx.clearScanRoot();
  await settle();
  check(L, '清除后项目栏回落到原始数量', ctx.allProjects().length === base, String(ctx.allProjects().length));
  check(L, '清除后 IndexedDB 里的句柄被移除', idbStoreSize(idb) === 0, String(idbStoreSize(idb)));
}

/* 假 IndexedDB 内部 Map 的条目数 */
function idbStoreSize(idb) {
  return idb._store ? idb._store.size : 0;
}

/* 回归：直接选中「单个项目文件夹」当扫描根时，根目录本身必须被认成项目 */
async function runZeroRootScenario() {
  const L = '零服务·直接选中项目文件夹';
  console.log('\n【' + L + '】');
  const SOLO = mkDir('solo-app', [
    mkFile('package.json', '{"name":"solo-app","scripts":{"dev":"vite --port 4321"}}'),
    mkFile('README.md', '# 单项目\n\n直接选中的项目文件夹本身应被识别。\n'),
    mkDir('.git', [mkFile('HEAD', 'ref: refs/heads/main\n')])
  ]);
  const idb = fakeIndexedDB();
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
  const win = { addEventListener() {}, showDirectoryPicker: async () => SOLO };

  const { ctx, getEl } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  let err = null;
  try { new vm.Script(src).runInContext(ctx, { timeout: 20000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 运行时异常：' + err.message); failures.push(L + ' / 脚本启动'); return; }
  await settle();
  const base = ctx.allProjects().length;

  await ctx.pickScanRoot();
  await settle();

  const zs = ctx.zeroProjects();
  check(L, '根目录本身被认成 1 个项目（rel 为空串）', zs.length === 1, zs.map((p) => p.name).join(','));
  check(L, '根项目名取目录名', zs[0] && zs[0].name === 'solo-app', zs[0] ? zs[0].name : '—');
  check(L, '根项目路径非空且不带多余分隔符', !!zs[0] && !!zs[0].path && !/[\\/]$/.test(zs[0].path), zs[0] ? zs[0].path : '—');
  check(L, '根项目已并入项目栏', ctx.allProjects().length === base + 1, base + ' → ' + ctx.allProjects().length);
  check(L, '扫描结果写入 dirBar 扫描行', getEl('dirBar')._html.includes('个项目 · 扫描于'));

  if (zs.length === 1) {
    ctx.openProject(zs[0].id);
    await settle();
    const split = getEl('wbSplit')._html;
    check(L, '根项目 repo 窗格直接进入可读写模式',
      split.includes('data-live-tree="0"') && split.includes('已连接真实目录'));
  }
}

/* 回归：选中 C:\ 这类超大根时必须「几秒内给出明确结果」，而不是卡住不动、界面像没反应。
   同时验证两点：① 遍历为广度优先——巨型子树排在前面也不会把预算吃光，后面的浅层项目照样能被发现；
   ② 系统目录（Windows / Program Files / AppData）被直接跳过，不参与遍历。 */
async function runZeroHugeRootScenario() {
  const L = '零服务·超大根（C:\\ 场景）';
  console.log('\n【' + L + '】');
  const SUBS = Array.from({ length: 80 }, (_, i) => mkDir('sub' + String(i).padStart(2, '0'), [mkFile('notes.txt', 'x')]));
  const TOPS = Array.from({ length: 40 }, (_, i) => mkDir('dir' + String(i).padStart(2, '0'), SUBS));
  const BIG = mkDir('BigDrive', [
    /* 巨型子树故意排在前面：深度优先会在这里耗光 2500 个目录的预算 */
    ...TOPS,
    /* 排在后面的浅层项目，只有广度优先才来得及发现 */
    mkDir('zz-late-project', [mkFile('package.json', '{"name":"late"}'), mkDir('.git', [mkFile('HEAD', 'x')])]),
    mkDir('Windows', [mkDir('System32', [mkDir('packaged', [mkFile('package.json', '{"name":"win-junk"}')])])]),
    mkDir('Program Files', [mkDir('Vendor', [mkFile('package.json', '{"name":"vendor-junk"}')])]),
    mkDir('AppData', [mkDir('Local', [mkDir('app-junk', [mkFile('package.json', '{"name":"app-junk"}')])])])
  ]);
  const idb = fakeIndexedDB();
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
  const win = { addEventListener() {}, showDirectoryPicker: async () => BIG };

  const { ctx, getEl } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  let err = null;
  try { new vm.Script(src).runInContext(ctx, { timeout: 30000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 运行时异常：' + err.message); failures.push(L + ' / 脚本启动'); return; }
  await settle();

  const t = Date.now();
  await ctx.pickScanRoot();
  const elapsed = Date.now() - t;
  await settle();

  const stats = peek(ctx, 'zeroScan.stats') || {};
  check(L, '扫描在预算内返回（未挂住）', elapsed < 8000, elapsed + 'ms');
  check(L, '遍历数被硬上限截断', stats.visited === 2500, 'visited=' + stats.visited);
  check(L, '结果标记为不完整', stats.truncated === true, String(stats.truncated));
  check(L, 'dirBar 给出「已达扫描上限」明确提示', getEl('dirBar')._html.includes('已达扫描上限'));
  const zs = ctx.zeroProjects();
  const names = zs.map((p) => p.name).join(',') || '—';
  check(L, '巨型子树排前面也不吃光预算（广度优先）· 后置浅层项目被发现',
    zs.some((p) => p.name === 'zz-late-project'), names);
  check(L, '系统目录 Windows 被跳过（内部项目未出现）', !zs.some((p) => p.name === 'packaged'), names);
  check(L, '系统目录 Program Files 被跳过（内部项目未出现）', !zs.some((p) => p.name === 'Vendor'), names);
  check(L, '系统目录 AppData 被跳过（内部项目未出现）', !zs.some((p) => p.name === 'app-junk'), names);
}

/* 兼容模式扫描：<input webkitdirectory> 的文件清单 → 虚拟目录树 → 项目识别 → 只读浏览。
   这一条链路不依赖 showDirectoryPicker、不需要任何权限，是「选择目录失败」时的兜底通道，
   所以本场景故意不提供 window.showDirectoryPicker，证明它确实不依赖该 API。 */
const mkFlatFile = (rel, text, lastModified) => ({
  name: rel.split('/').pop(), size: text.length, lastModified: lastModified || 1750000000000,
  webkitRelativePath: rel, text: async () => text
});

async function runFlatScenario() {
  const L = '兼容模式扫描';
  console.log('\n【' + L + '（webkitdirectory 文件清单 · 无权限依赖）】');
  const FILES = [
    mkFlatFile('MyProjects/smart-car/README.md', '# 智能小车\n\n基于 STM32F103 的两轮差速小车，含电机 PWM 驱动与编码器测速。\n'),
    mkFlatFile('MyProjects/smart-car/CMakeLists.txt', 'project(smart_car)\n'),
    mkFlatFile('MyProjects/smart-car/src/main.c', 'int main(){return 0;}\n'),
    mkFlatFile('MyProjects/smart-car/.git/HEAD', 'ref: refs/heads/main\n'),
    mkFlatFile('MyProjects/web-dash/package.json', '{"scripts":{"dev":"vite --port 5173"}}'),
    mkFlatFile('MyProjects/web-dash/README.md', '# 数据看板\n\nVite + Vue3 轻量看板。\n'),
    mkFlatFile('MyProjects/scratch/notes.txt', 'hello\n'),
    mkFlatFile('MyProjects/node_modules/junk/package.json', '{}')
  ];
  const idb = fakeIndexedDB();
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
  const win = { addEventListener() {} };   // 故意不给 showDirectoryPicker

  const { ctx, getEl } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  let err = null;
  try { new vm.Script(src).runInContext(ctx, { timeout: 20000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 运行时异常：' + err.message); failures.push(L + ' / 脚本启动'); return; }
  await settle();
  const base = ctx.allProjects().length;

  check(L, '无 showDirectoryPicker 时仍提供「兼容模式扫描」入口',
    getEl('dirBar')._html.includes('兼容模式扫描') && !getEl('dirBar')._html.includes('data-act="dir-pick"'));
  check(L, '未授权时不误报已授权', !getEl('dirBar')._html.includes('已授权 · 可读写'));

  await ctx.onFlatPicked({ target: { files: FILES } });
  await settle();

  const zs = ctx.zeroProjects();
  const names = zs.map((p) => p.name).join(',') || '—';
  check(L, '从文件清单识别出 2 个项目（node_modules / 无标记目录已排除）', zs.length === 2, names);
  const car = zs.find((p) => p.name === 'smart-car');
  const dash = zs.find((p) => p.name === 'web-dash');
  check(L, '.git 目录被认成项目并标记 git', !!car && car.git === true);
  check(L, '工程标记文件推导语言标签', !!car && car.langs.indexOf('C/C++') >= 0, car ? car.langs.join('/') : '—');
  check(L, 'package.json 里的声明端口被解析', !!dash && dash.ports.indexOf(5173) >= 0, dash ? dash.ports.join(',') : '—');
  check(L, 'README 正文首段进入卡片预览', !!car && ctx.projPreview(car).indexOf('差速小车') >= 0,
    car ? ctx.projPreview(car).slice(0, 30) : '—');
  const rawCar = (peek(ctx, 'zeroScan.projects') || []).find((p) => p.name === 'smart-car') || {};
  check(L, '体积与文件数来自 File 清单（无需读盘）', rawCar.sizeBytes > 0 && rawCar.files === 3,
    rawCar.sizeBytes + 'B / ' + rawCar.files + ' 文件（.git 内部不计）');
  check(L, '扫描结果并入项目栏', ctx.allProjects().length === base + 2, base + ' → ' + ctx.allProjects().length);
  check(L, '扫描模式标记为 flat', peek(ctx, 'zeroScan.mode') === 'flat', String(peek(ctx, 'zeroScan.mode')));
  check(L, 'dirBar 状态 = 已扫描 · 只读（兼容模式）', getEl('dirBar')._html.includes('只读（兼容模式）'));
  check(L, '模式徽章 = 兼容模式 · 只读', getEl('modeBadge')._html.includes('兼容模式'));
  check(L, '兼容模式不写 IndexedDB（没有句柄可存）', idbStoreSize(idb) === 0, String(idbStoreSize(idb)));
  check(L, 'dirBar 说明写明不能写盘', getEl('dirBar')._html.includes('不能直接写盘'));

  /* 只读浏览：文件清单还原出目录树，且只走内存、不需要句柄 */
  const at = ctx.flatListAt('smart-car');
  check(L, '目录树从清单还原（子目录 + 文件）',
    at.dirs.map((d) => d.name).join(',') === '.git,src' && at.files.map((f) => f.name).join(',') === 'CMakeLists.txt,README.md',
    at.dirs.map((d) => d.name).join(',') + ' | ' + at.files.map((f) => f.name).join(','));
  check(L, '文件大小取自 File 对象', at.files.some((f) => f.name === 'README.md' && f.size > 0));
  check(L, '深层目录可继续下钻', ctx.flatListAt('smart-car/src').files.map((f) => f.name).join(',') === 'main.c');
  check(L, '根级目录列表可用', ctx.flatListAt('').dirs.map((d) => d.name).indexOf('smart-car') >= 0);

  /* repo 窗格：兼容模式直接进入只读浏览，不再尝试解析目录句柄 */
  ctx.openProject(car.id);
  await settle();
  const split = getEl('wbSplit')._html;
  check(L, 'repo 窗格进入兼容模式只读', split.includes('data-flat-tree="0"') && split.includes('兼容模式 · 只读'));
  check(L, 'repo 窗格提示不能写盘', split.includes('不能写盘'));
  check(L, 'repo 窗格不再出现「连接目录」按钮', !split.includes('data-act="connect-dir"'));

  /* 模拟刷新：项目列表要复用，但文件清单是会话级的，必须提示重扫一次 */
  const { ctx: ctx2 } = buildContext(zeroFetch, { indexedDB: idb, localStorage: ls, window: win });
  try { new vm.Script(src).runInContext(ctx2, { timeout: 20000 }); } catch (e) { err = e; }
  if (err) { console.log('  ✗ 刷新后运行时异常：' + err.message); failures.push(L + ' / 刷新后启动'); return; }
  await settle();
  check(L, '刷新后复用扫描结果（不重扫）', peek(ctx2, 'zeroScan.projects.length') === 2, String(peek(ctx2, 'zeroScan.projects.length')));
  check(L, '刷新后仍标记为 flat 模式', peek(ctx2, 'zeroScan.mode') === 'flat');
  check(L, '刷新后文件清单失效（会话级，不落盘）', peek(ctx2, 'flatFiles') === null);
  check(L, '刷新后控制室仍显示兼容模式状态',
    (() => { const el = ctx2.document.getElementById('dirBar'); return el && el._html.includes('只读（兼容模式）'); })());
}

await runScenario('快照模式（file://）', rejectFetch, false);
await runScenario('服务模式（/api/health 可用）', okFetch, true);
await runZeroScenario();
await runZeroRootScenario();
await runZeroHugeRootScenario();
await runFlatScenario();

console.log('');
if (failures.length) {
  console.log('✗ 冒烟失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log('✓ 全部场景跑通（快照 / 服务 / 零服务 / 单项目根 / 超大根 / 兼容模式）');
