/* 把本机扫描快照注入模板，产出单文件 workbench.html */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_DIR = path.join(HERE, 'data');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const projects = readJSON(path.join(DATA_DIR, 'projects.json'));
const treesArr = readJSON(path.join(DATA_DIR, 'trees.json'));
const ports = readJSON(path.join(DATA_DIR, 'ports.json'));
const template = fs.readFileSync(path.join(HERE, 'workbench.template.html'), 'utf8');

/* ---------- 1. 嵌套判定：路径被另一个项目包含 ---------- */
const norm = (s) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
for (const p of projects) {
  const pp = norm(p.path);
  p.nested = projects.some(o => o !== p && pp.startsWith(norm(o.path) + '/'));
}

/* ---------- 2. 端口归属：项目自有配置声明的端口 + 此刻真的在监听 ---------- */
const SKIP = new Set(['node_modules', '.git', 'build', 'dist', 'out', 'target', '.trae', '.worktable', '.vscode', 'managed_components']);
const EXT = new Set(['.json', '.md', '.mjs', '.cjs', '.js', '.ts', '.py', '.txt', '.yml', '.yaml', '.toml', '.cfg', '.ini', '.env', '.ps1', '.sh']);
const MAX_FILE = 64 * 1024;

function collectFiles(dir, depth, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) collectFiles(full, depth - 1, acc); continue; }
    if (!EXT.has(path.extname(e.name).toLowerCase())) continue;
    try { if (fs.statSync(full).size > MAX_FILE) continue; } catch { continue; }
    acc.push(full);
  }
  return acc;
}

const PORT_HINTS = [
  /(?:localhost|127\.0\.0\.1)[:/](\d{2,5})/gi,
  /\bport\b\s*["']?\s*[:=]\s*["']?(\d{2,5})/gi,
  /--port[=\s]+(\d{2,5})/gi
];

const listening = new Map();
for (const pt of ports) if (!listening.has(pt.port)) listening.set(pt.port, pt);

for (const p of projects) {
  const declared = new Set();
  for (const f of collectFiles(p.path, 2, [])) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const re of PORT_HINTS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const n = +m[1];
        if (n >= 1024 && n <= 65535) declared.add(n);
      }
    }
  }
  for (const n of declared) {
    const pt = listening.get(n);
    if (pt && /^(node|python|python3|deno|bun|java|dotnet|go|cargo|vite|nginx)$/i.test(pt.proc)) {
      p.live = { port: pt.port, pid: pt.pid, proc: pt.proc, memMB: pt.memMB, addr: pt.address };
      break;
    }
  }
  if (declared.size) p.declaredPorts = [...declared].sort((a, b) => a - b);
}

/* ---------- 3. 目录树：数组 → 以 id 为键的对象 ---------- */
const trees = {};
for (const t of treesArr) trees[t.id] = { tree: t.tree || [], samples: t.samples || [] };

/* ---------- 4. 组装并注入 ---------- */
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const snapshot = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

/* AI 对话窗格的预设：构建期就写进快照，file:// 下也有可选列表 */
const AI_PRESETS = [
  { name: '本机 Open WebUI', url: 'http://localhost:3000' },
  { name: '本机 LobeChat', url: 'http://localhost:3210' },
  { name: '本机 LibreChat', url: 'http://localhost:3080' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
  { name: '豆包', url: 'https://www.doubao.com/chat' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' }
];

const DATA = { snapshot, projects, trees, ports, aiPresets: AI_PRESETS };
const payload = 'const DATA = ' + JSON.stringify(DATA) + ';';

if (!template.includes('/*__DATA__*/')) throw new Error('模板缺少 /*__DATA__*/ 占位符');
const out = template.replace('/*__DATA__*/', payload);

const outPath = path.join(ROOT, 'workbench.html');
fs.writeFileSync(outPath, out, 'utf8');

/* ---------- 5. 登记表：给本地服务 serve.mjs 用 ----------
   扫描根一律由 homedir 推导，避免把用户名写死进仓库 */
const HOME = os.homedir();
const SCAN_ROOTS = [
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'source'),
  path.join(HOME, 'Documents'),
  path.join(HOME, 'code'),
  path.join(HOME, 'AppData', 'Roaming', 'TRAE SOLO CN', 'ModularData', 'ai-agent', 'work-mode-projects'),
  path.join(HOME, '.trae-cn', 'skills')
];

const registryPath = path.join(ROOT, 'workbench.registry.json');
fs.writeFileSync(registryPath, JSON.stringify({
  projects: projects.map(p => ({ id: p.id, name: p.name, alias: p.alias, path: p.path })),
  scanRoots: SCAN_ROOTS,
  aiPresets: AI_PRESETS
}, null, 2), 'utf8');

/* ---------- 6. 报告 ---------- */
const liveN = projects.filter(p => p.live).length;
const nestedN = projects.filter(p => p.nested).length;
console.log('snapshot   :', snapshot);
console.log('projects   :', projects.length, '(nested', nestedN + ')');
console.log('trees      :', Object.keys(trees).length);
console.log('ports      :', ports.length);
console.log('live match :', liveN, projects.filter(p => p.live).map(p => p.id + ':' + p.live.port).join(', ') || '—');
console.log('output     :', outPath, (out.length / 1024).toFixed(1) + ' KB');
console.log('registry   :', registryPath, (fs.statSync(registryPath).size / 1024).toFixed(1) + ' KB');
