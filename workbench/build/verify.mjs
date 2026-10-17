/* 回归校验：语法 / 自包含 / 数据契约 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* 个人版 workbench.html 存在时校验它；否则退回公开版 index.html（仓库形态） */
const personalPath = path.join(ROOT, 'workbench.html');
const hasPersonal = fs.existsSync(personalPath);
const html = fs.readFileSync(hasPersonal ? personalPath : path.join(ROOT, 'index.html'), 'utf8');

const fail = [];
const ok = [];
const check = (name, cond, detail) => (cond ? ok : fail).push(name + (detail ? ' — ' + detail : ''));

/* 1. 自包含：不允许外部资源引用（快照正文里的纯文本 URL 不算） */
check('无 <script src>', !/<script[^>]+src=/i.test(html));
check('无 <link rel=stylesheet>', !/<link[^>]+rel=["']?stylesheet/i.test(html));
check('无 @import', !/@import/i.test(html));
check('无 CDN 外链属性', !/(src|href|srcset)=["']https?:\/\//i.test(html));
check('无 CSS url() 外链', !/url\(\s*["']?https?:/i.test(html));

/* 2. 结构完整性 */
check('含 DOCTYPE', /^<!DOCTYPE html>/i.test(html));
check('无未替换占位符', !html.includes('/*__DATA__*/'));
check('标签闭合 </html>', html.trim().endsWith('</html>'));
for (const id of ['plist', 'cardGrid', 'crBody', 'portsStrip', 'wbSplit', 'crStats', 'stateFilter', 'scrim', 'toasts']) {
  check('元素 #' + id, html.includes('id="' + id + '"'));
}

/* 3. 脚本语法 + 数据契约（在沙箱里真正求值 DATA） */
const m = html.match(/<script>([\s\S]*)<\/script>/);
check('存在内联 script', !!m);
if (m) {
  const src = m[1];
  try { new vm.Script(src); ok.push('script 语法通过'); }
  catch (e) { fail.push('script 语法错误 — ' + e.message); }

  /* 行尾符无关：本仓库 core.autocrlf=true 时产物是 CRLF，别人那里可能是 LF。
     用正则匹配 \r?\n，否则「未找到 DATA 字面量」会随机器行尾符而变，门禁不可信。 */
  const SEP = /\r?\n\r?\n\/\* ===/;
  const dmStart = src.indexOf('const DATA = ');
  const dmRel = dmStart >= 0 ? src.slice(dmStart).search(SEP) : -1;
  const dmEnd = dmRel >= 0 ? dmStart + dmRel : -1;
  if (dmStart < 0 || dmEnd < 0) { fail.push('未找到 DATA 字面量'); }
  else {
    const raw = src.slice(dmStart + 'const DATA = '.length, dmEnd).trim().replace(/;$/, '');
    const DATA = JSON.parse(raw);
    /* 公开版不注入示例项目：打开即是空的，项目全部来自访问者扫描自己的机器。
       个人版（workbench.html，不入库）的 13 项由下方 hasPersonal 分支校验。 */
    if (!hasPersonal) {
      check('公开版无示例项目（打开即空）', Array.isArray(DATA.projects) && DATA.projects.length === 0, String(DATA.projects.length));
    }
    check('DATA.trees 键与 projects id 对齐', DATA.projects.every(p => DATA.trees[p.id]), '缺 ' + DATA.projects.filter(p => !DATA.trees[p.id]).map(p => p.id).join(','));
    check('DATA.ports 为数组', Array.isArray(DATA.ports), String(DATA.ports.length) + ' 条');
    check('snapshot 已填', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(DATA.snapshot), DATA.snapshot);
    if (hasPersonal) {
      check('个人版 projects 13 项', DATA.projects.length === 13, String(DATA.projects.length));
      check('个人版 ports 40 条', DATA.ports.length === 40, String(DATA.ports.length));
      check('个人版 trees 13 键', Object.keys(DATA.trees).length === 13, String(Object.keys(DATA.trees).length));
    }
    const badTree = Object.entries(DATA.trees).filter(([, t]) => !Array.isArray(t.tree) || t.tree.some(n => !Array.isArray(n) || n.length < 2));
    check('tree 节点形状 [path,isDir,size]', badTree.length === 0, badTree.map(x => x[0]).join(','));
    const badS = Object.entries(DATA.trees).flatMap(([id, t]) => (t.samples || []).filter(s => typeof s.p !== 'string' || typeof s.t !== 'string').map(() => id));
    check('samples 形状 {p,t}', badS.length === 0, badS.join(','));
    if (hasPersonal) {
      const nested = DATA.projects.filter(p => p.nested).map(p => p.id);
      check('嵌套项目已标记', nested.length === 4, nested.join(','));
    }
    const live = DATA.projects.filter(p => p.live);
    check('live 字段形状', live.every(p => p.live.port && p.live.proc), live.map(p => p.id + ':' + p.live.port).join(','));
  }
}

/* 4. v2 改造：新窗格 / 新预设 / 方形卡片 / 本地服务契约 */
check('新窗格 projects 已注册', /projects:\s*\{[^}]*本地检索/.test(html));
check('新窗格 chat 已注册', /chat:\s*\{[^}]*AI 对话/.test(html));
check('KIND_ORDER 含 projects 与 chat', /const KIND_ORDER = \[[^\]]*'projects'[^\]]*'chat'/.test(html));
check('chat 预设在册', /const PRESET_ORDER = \[[^\]]*'chat'/.test(html));
check('chat 预设 CSS', /\.pane-grid\[data-preset="chat"\]/.test(html));
check('方形卡片 aspect-ratio', /\.card\{[^}]*aspect-ratio:1/.test(html));
check('控制室卡片 2×2 方形', /\.control-card\{[^}]*aspect-ratio:1/.test(html));
check('网格 align-items:start', /\.grid\{[^}]*align-items:start/.test(html));
check('模式徽章元素', html.includes('id="modeBadge"'));
check('本地检索窗格锚点', html.includes('data-proj-list'));
check('AI 对话 iframe 锚点', /data-frame="chat-/.test(html));
check('服务模式直读写调用', /\/api\/tree\?project=/.test(html) && /\/api\/file/.test(html));
check('服务探测 /api/health', html.includes("fetch('/api/health'"));
check('DATA.aiPresets 已注入', /"aiPresets":\[\{/.test(html));

/* 4b. 视觉体系对齐 dsh-worktable 控制室 */
check('蓝图网格底 30px', /background-size:30px 30px/.test(html) && /mask-image:radial-gradient/.test(html));
check('玻璃卡片锥形渐变描边', /\.card::after\{[^}]*conic-gradient\(from 45deg/.test(html));
check('卡片多层渐变底', /\.card\{[^}]*linear-gradient\(135deg,rgba\(255,255,255,\.20\)/.test(html));
check('工作中旋转彗星光环', /@property --wt-angle/.test(html) && /@keyframes wtAngleSpin\{to\{--wt-angle:360deg\}\}/.test(html));
check('彗星光环用遮罩挖空', /\.card\.busy::before\{[^}]*mask-composite:exclude/.test(html));
check('斜向扫光 wtSweep', /@keyframes wtSweep/.test(html) && html.includes('wt-sweep'));
check('状态霓虹描边 glowDone/glowNeed', /\.card\.glow-done\{/.test(html) && /\.card\.glow-needs\{/.test(html));
check('卡片内部结构 c-head/c-srow/c-preview', /\.c-head\{/.test(html) && /\.c-srow\{/.test(html) && /\.c-preview\{/.test(html));
check('虚线玻璃「添加项目」卡片', /\.add-card\{[^}]*1\.5px dashed/.test(html) && /data-act="add-project"[^>]*tabindex/.test(html));
check('悬浮玻璃顶栏 Dock', /\.topbar\{[^}]*backdrop-filter:blur\(14px\)/.test(html));
check('侧栏项目行 emoji + 状态光', /\.pitem \.pi-ico\{/.test(html) && html.includes('class="pi-arrow"'));
check('卡片渲染输出新结构', /c-head[\s\S]{0,400}c-srow[\s\S]{0,400}c-preview/.test(html));
check('卡片 emoji 映射表', html.includes('CAT_EMOJI'));
check('内容预览取 README 样本', /function projPreview\(/.test(html));
check('相对时间基准为快照', /function relTime\(/.test(html));

/* 4c. 控制室背景层：蓝图网格 + 漂移光斑（对齐 dsh-worktable 的 consoleBg） */
check('光斑背景层 wt-bg', /\.wt-bg\{[^}]*position:fixed/.test(html) && /\.wt-bg::after\{[^}]*background-size:30px 30px/.test(html));
check('光斑用 56vmax 模糊 + screen 叠加', /\.wt-blob\{[^}]*width:56vmax[^}]*blur\(64px\)[^}]*mix-blend-mode:screen/.test(html));
check('四组光斑漂移关键帧', ['wtBlob1', 'wtBlob2', 'wtBlob3', 'wtBlob4'].every(k => html.includes('@keyframes ' + k)));
check('光斑 DOM 节点已挂载', html.includes('class="wt-blob wt-b1"') && html.includes('class="wt-blob wt-b4"'));
check('光斑只走暖色（无紫蓝）', !/#(7a5cff|00c2ff|ff5f9e)/i.test(html));
check('卡片网格留白 64px + 下沉居中', /\.grid\{[^}]*--gap:64px/.test(html) && /\.grid\{[^}]*margin:clamp\(32px,9vh,110px\)/.test(html));

/* 4d. 控制室卡片终版细节（对齐参考仓库第五~十六轮定案） */
check('卡片去磨砂：底 .24 且无 backdrop-filter', /\.card\{[^}]*rgba\(18,23,32,\.24\)/.test(html) && !/\.card\{[^}]*backdrop-filter/.test(html));
check('工作中光环加厚到 3px', /\.card\.busy::before\{[^}]*padding:3px/.test(html));
check('工作中双层外发光加强', /\.card\.busy\{box-shadow:0 0 10px rgba\(240,180,41,\.55\),0 0 34px rgba\(240,180,41,\.40\)\}/.test(html));
check('预览字号 8.5px / 13px 行高', /\.c-preview\{[^}]*font-size:8\.5px;line-height:13px/.test(html));
check('预览清洗函数并已接入', html.includes('function cleanPreviewText(') && html.includes('cleanPreviewText(pick.t)'));
check('名字 20px / 状态 22px / 图标 31px', /\.c-name\{[^}]*font-size:20px/.test(html) && /\.c-status\{[^}]*font-size:22px/.test(html) && /\.c-ico\{[^}]*font-size:31px/.test(html));

/* 4e. AI 对话窗格：放大 + 内嵌逻辑 */
check('chat 预设对话列占大头', /\.pane-grid\[data-preset="chat"\]\{grid-template-columns:1fr 1\.25fr\}/.test(html));
check('对话窗格改 flex 撑满高度', /\.pane-body\.chat-body\{[^}]*display:flex[^}]*flex-direction:column/.test(html) && /\.chat-wrap\{flex:1 1 auto;height:auto/.test(html));
check('chat-body 修饰类按窗格类型挂载', html.includes("(k === 'chat' ? ' chat-body' : '')"));
check('URL 规范化函数并已接入', html.includes('function normalizeUrl(') && html.includes('normalizeUrl(pane.content'));
check('探测到封锁头直接给兜底', html.includes('if(j.frameBlock){') && html.includes('该站点声明了禁止内嵌'));
check('对话 iframe 授予剪贴板权限', html.includes('allow="clipboard-write"'));

const regPath = path.join(ROOT, 'workbench.registry.json');
if (fs.existsSync(regPath)) {
  let reg = null;
  try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { reg = null; }
  check('registry 可解析', !!reg);
  if (reg) {
    check('registry.projects 非空', Array.isArray(reg.projects) && reg.projects.length > 0, String((reg.projects || []).length));
    check('registry.projects[].path 齐全', (reg.projects || []).every(p => typeof p.path === 'string' && p.path.length > 2));
    check('registry.scanRoots 非空', Array.isArray(reg.scanRoots) && reg.scanRoots.length > 0, String((reg.scanRoots || []).length));
    check('registry.aiPresets url 合法', Array.isArray(reg.aiPresets) && reg.aiPresets.length > 0 &&
      reg.aiPresets.every(a => /^https?:\/\//.test(a.url) && typeof a.name === 'string'));
  }
} else if (hasPersonal) {
  fail.push('workbench.registry.json 不存在（需先跑 build.mjs）');
}

/* 5. 公开版 index.html：无示例数据（打开即空），且不得含任何本机标识 */
const pubPath = path.join(ROOT, 'index.html');
if (fs.existsSync(pubPath)) {
  const pub = fs.readFileSync(pubPath, 'utf8');
  check('公开版自包含（无外链）', !/<script[^>]+src=/i.test(pub) && !/(src|href)=["']https?:\/\//i.test(pub));
  check('公开版无本机用户名', !pub.includes('jinshuaiyu'));
  check('公开版无用户目录前缀', !pub.includes('C:\\Users\\') && !pub.includes('LAPTOP-'));
  check('公开版无 AppData 绝对路径', !pub.includes('AppData\\Roaming'));
  check('公开版快照已标注', pub.includes('公开版（打开后扫描你自己的项目）'));
  check('公开版体积 < 400KB', pub.length / 1024 < 400, (pub.length / 1024).toFixed(1) + ' KB');

  const pm = pub.match(/<script>([\s\S]*)<\/script>/);
  const ds = pm && pm[1].indexOf('const DATA = ');
  const de0 = pm && ds >= 0 ? pm[1].slice(ds).search(/\r?\n\r?\n\/\* ===/) : -1;
  const de = de0 >= 0 && ds >= 0 ? de0 + ds : -1;
  if (ds >= 0 && de >= 0) {
    const PD = JSON.parse(pm[1].slice(ds + 'const DATA = '.length, de).trim().replace(/;$/, ''));
    /* 公开版不再注入示例数据：projects / trees / ports 三者都应为空，
       页面打开即空，项目全部来自访问者扫描自己的机器 */
    check('公开版无示例项目（projects 为空）', Array.isArray(PD.projects) && PD.projects.length === 0, String(PD.projects.length));
    check('公开版无示例目录树（trees 为空）', Object.keys(PD.trees || {}).length === 0, String(Object.keys(PD.trees || {}).length));
    check('公开版无示例端口（ports 为空）', Array.isArray(PD.ports) && PD.ports.length === 0, String(PD.ports.length));
    check('公开版 AI 对话预设仍在', Array.isArray(PD.aiPresets) && PD.aiPresets.length > 0, String((PD.aiPresets || []).length) + ' 条');
  } else {
    fail.push('公开版未找到 DATA 字面量');
  }
} else {
  fail.push('index.html 不存在（需先跑 build-public.mjs）');
}

/* 6. 体积 */
const kb = html.length / 1024;
check('单文件 < 400KB', kb < 400, kb.toFixed(1) + ' KB');

console.log('校验目标 :', hasPersonal ? 'workbench.html（个人版）' : 'index.html（公开版）');
console.log('通过 ' + ok.length + ' 项');
if (fail.length) { console.log('\n失败 ' + fail.length + ' 项:'); fail.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('\n全部通过 ✓');
