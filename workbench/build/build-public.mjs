/* 生成公开演示版 index.html：注入虚构示例数据，绝不写入本机真实路径。
   用途：GitHub Pages 展示 / 分享给他人（workbench.html 是个人版，含本机路径，不进仓库）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const template = fs.readFileSync(path.join(HERE, 'workbench.template.html'), 'utf8');

const SNAPSHOT = '2026-10-16 19:00 · 公开演示版（示例数据）';

/* 示例项目：路径一律用 D:\projects\... 这类通用占位，不含任何真实用户信息 */
const projects = [
  {
    id: 'smart-car-fw', name: 'smart-car-fw', alias: '智能小车固件',
    path: 'D:\\projects\\smart-car-fw',
    langs: ['C', 'C++', 'STM32', 'Makefile'], category: '嵌入式',
    sizeBytes: 48234496, sizeMB: 46.0, git: true, updated: '2026-09-28', files: 812,
    exists: true, nested: false
  },
  {
    id: 'vision-demo', name: 'vision-demo', alias: '视觉识别 Demo',
    path: 'D:\\projects\\vision-demo',
    langs: ['Python', 'OpenCV', 'PyTorch'], category: 'AI',
    sizeBytes: 133169152, sizeMB: 127.0, git: true, updated: '2026-10-08', files: 356,
    exists: true, nested: false,
    live: { port: 8000, pid: 20412, proc: 'python', memMB: 186 },
    declaredPorts: [8000]
  },
  {
    id: 'web-dashboard', name: 'web-dashboard', alias: '数据看板',
    path: 'D:\\projects\\web-dashboard',
    langs: ['TypeScript', 'Vue', 'Vite'], category: '前端',
    sizeBytes: 52428800, sizeMB: 50.0, git: true, updated: '2026-10-12', files: 264,
    exists: true, nested: false,
    live: { port: 5173, pid: 17890, proc: 'node', memMB: 142 },
    declaredPorts: [5173]
  },
  {
    id: 'blog-site', name: 'blog-site', alias: '个人博客',
    path: 'D:\\projects\\blog-site',
    langs: ['Astro', 'MDX', 'CSS'], category: '前端',
    sizeBytes: 18874368, sizeMB: 18.0, git: true, updated: '2026-09-15', files: 141,
    exists: true, nested: false
  },
  {
    id: 'script-toolbox', name: 'script-toolbox', alias: '脚本工具箱',
    path: 'D:\\projects\\script-toolbox',
    langs: ['Python', 'PowerShell'], category: '工具',
    sizeBytes: 4194304, sizeMB: 4.0, git: false, updated: '2026-08-22', files: 57,
    exists: true, nested: false
  },
  {
    id: 'esp-weather', name: 'esp-weather', alias: 'ESP32 气象站',
    path: 'D:\\projects\\esp-weather',
    langs: ['C++', 'ESP-IDF'], category: '嵌入式',
    sizeBytes: 96468992, sizeMB: 92.0, git: true, updated: '2026-07-30', files: 903,
    exists: true, nested: false
  }
];

const T = (nodes, samples) => ({ tree: nodes, samples: samples || [] });

const trees = {
  'smart-car-fw': T([
    ['src', 1, 0], ['src/main.c', 0, 18342], ['src/motor.c', 0, 7412],
    ['include', 1, 0], ['include/motor.h', 0, 1204],
    ['CMakeLists.txt', 0, 642], ['README.md', 0, 2140]
  ], [
    { p: 'README.md', t: '# 智能小车固件\n\n基于 STM32F103 的两轮差速小车，含电机 PWM 驱动、编码器测速与串口调试协议。\n\n## 目录\n- `src/` 驱动与主循环\n- `include/` 头文件\n\n## 构建\n```sh\nmake -j8\n```\n' }
  ]),
  'vision-demo': T([
    ['app', 1, 0], ['app/server.py', 0, 9214], ['app/detect.py', 0, 14380],
    ['models', 1, 0], ['models/yolov8n.onnx', 0, 12451840],
    ['requirements.txt', 0, 318], ['README.md', 0, 3620]
  ], [
    { p: 'README.md', t: '# 视觉识别 Demo\n\n本地起一个 FastAPI 服务，浏览器上传图片即返回检测框。默认监听 `8000`。\n\n```bash\npip install -r requirements.txt\npython app/server.py\n```\n' }
  ]),
  'web-dashboard': T([
    ['src', 1, 0], ['src/main.ts', 0, 2841], ['src/App.vue', 0, 7412],
    ['src/components', 1, 0], ['src/components/ChartCard.vue', 0, 5120],
    ['package.json', 0, 812], ['vite.config.ts', 0, 604], ['README.md', 0, 1860]
  ], [
    { p: 'README.md', t: '# 数据看板\n\nVite + Vue3 的轻量看板，`npm run dev` 后默认落在 `5173`。\n\n数据源可切换为本地 JSON 或远端接口。\n' }
  ]),
  'blog-site': T([
    ['src', 1, 0], ['src/pages', 1, 0], ['src/pages/index.astro', 0, 2410],
    ['src/content', 1, 0], ['src/content/hello.mdx', 0, 1120],
    ['astro.config.mjs', 0, 512], ['README.md', 0, 980]
  ], [
    { p: 'README.md', t: '# 个人博客\n\nAstro 静态站点，文章写在 `src/content/` 下的 MDX 里，构建产物可直接丢到静态托管。\n' }
  ]),
  'script-toolbox': T([
    ['scripts', 1, 0], ['scripts/rename.py', 0, 2140], ['scripts/backup.ps1', 0, 1680],
    ['README.md', 0, 1420]
  ], [
    { p: 'README.md', t: '# 脚本工具箱\n\n零依赖小脚本合集：批量重命名、目录备份、日志切片。\n\n每个脚本都在文件头写了用法注释。\n' }
  ]),
  'esp-weather': T([
    ['main', 1, 0], ['main/app_main.c', 0, 11240], ['main/sensor.c', 0, 6420],
    ['components', 1, 0], ['components/bme280', 1, 0],
    ['sdkconfig', 0, 4820], ['README.md', 0, 2740]
  ], [
    { p: 'README.md', t: '# ESP32 气象站\n\nESP-IDF 工程，BME280 采集温湿度气压，MQTT 上报。\n\n```bash\nidf.py build flash monitor\n```\n' }
  ])
};

const ports = [
  { port: 5173, pid: 17890, proc: 'node', memMB: 142, address: '127.0.0.1' },
  { port: 8000, pid: 20412, proc: 'python', memMB: 186, address: '127.0.0.1' },
  { port: 5432, pid: 9120, proc: 'postgres', memMB: 64, address: '127.0.0.1' }
];

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

const leaks = ['jinshuaiyu', 'C:\\Users\\', 'AppData\\Roaming', 'LAPTOP-'];
const hit = leaks.filter((k) => out.includes(k));
if (hit.length) throw new Error('公开版疑似含本机标识：' + hit.join(' / '));

console.log('snapshot :', SNAPSHOT);
console.log('projects :', projects.length);
console.log('trees    :', Object.keys(trees).length);
console.log('ports    :', ports.length);
console.log('leak scan:', hit.length ? hit.join(',') : 'clean ✓');
console.log('output   :', outPath, (out.length / 1024).toFixed(1) + ' KB');
