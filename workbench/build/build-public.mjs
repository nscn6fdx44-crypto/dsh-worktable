/* 生成公开版 index.html：不注入任何示例数据——页面打开即是空的，
   访问者点「选择本机目录」或「兼容模式扫描」后，展示的是他自己机器上的项目。
   用途：GitHub Pages 展示 / 分享给他人（workbench.html 是个人版，含本机路径，不进仓库）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const template = fs.readFileSync(path.join(HERE, 'workbench.template.html'), 'utf8');

const SNAPSHOT = '2026-10-17 13:00 · 公开版（打开后扫描你自己的项目）';

/* 公开版不携带任何示例项目：打开即是空的（空态由模板渲染），
   扫到的项目全部来自访问者自己的机器。
   个人版（build.mjs 生成的 workbench.html）才注入真实扫描快照，且不入库。 */
const projects = [];

const trees = {};

const ports = [];

/* AI 对话窗格的外链预设：是常用 AI 服务的快捷入口，不是项目数据，保留 */
const aiPresets = [
  { name: '本机 Open WebUI', url: 'http://localhost:3000' },
  { name: '本机 LobeChat', url: 'http://localhost:3210' },
  { name: '本机 LibreChat', url: 'http://localhost:3080' },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
  { name: '豆包', url: 'https://www.doubao.com/chat' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' }
];

const DATA = { snapshot: SNAPSHOT, projects, trees, ports, aiPresets };
const payload = 'const DATA = ' + JSON.stringify(DATA) + ';';

if (!template.includes('/*__DATA__*/')) throw new Error('模板缺少 /*__DATA__*/ 占位符');
const out = template.replace('/*__DATA__*/', payload);

const outPath = path.join(ROOT, 'index.html');
fs.writeFileSync(outPath, out, 'utf8');

/* 另写一份到 public/ 用于静态托管 / 一键发布：该目录只含单文件，绝不含 serve.mjs，
   上线后页面必然进入零服务模式（访问者扫自己的机器），主机信息零暴露。 */
const pubDir = path.join(ROOT, 'public');
fs.mkdirSync(pubDir, { recursive: true });
const pubPath = path.join(pubDir, 'index.html');
fs.writeFileSync(pubPath, out, 'utf8');

const leaks = ['jinshuaiyu', 'C:\\Users\\', 'AppData\\Roaming', 'LAPTOP-'];
const hit = leaks.filter((k) => out.includes(k));
if (hit.length) {
  fs.rmSync(pubPath, { force: true });
  throw new Error('公开版疑似含本机标识：' + hit.join(' / '));
}

console.log('snapshot :', SNAPSHOT);
console.log('projects :', projects.length, '（公开版不注入示例项目，打开即空）');
console.log('trees    :', Object.keys(trees).length);
console.log('ports    :', ports.length);
console.log('leak scan:', hit.length ? hit.join(',') : 'clean ✓');
console.log('output   :', outPath, (out.length / 1024).toFixed(1) + ' KB');
console.log('deploy   :', pubPath);
