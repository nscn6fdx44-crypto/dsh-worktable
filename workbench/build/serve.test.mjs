/* 服务端用例：把 serve.mjs 真正跑起来，用 HTTP 打一遍路由契约
   全部读写都发生在系统临时目录里的 scratch 项目上，不碰用户真实项目 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const failures = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failures.push(name); }
};

/* ---------- scratch 项目 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-serve-test-'));
const projDir = path.join(tmp, 'scratch-proj');
fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(projDir, 'node_modules', 'left-pad'), { recursive: true });
fs.mkdirSync(path.join(projDir, '.git'), { recursive: true });
fs.writeFileSync(path.join(projDir, 'README.md'), '# scratch\nhello workbench\n', 'utf8');
fs.writeFileSync(path.join(projDir, 'package.json'), '{"name":"scratch-proj","version":"1.0.0"}\n', 'utf8');
fs.writeFileSync(path.join(projDir, 'src', 'main.js'), 'console.log("scratch");\n', 'utf8');

const registryPath = path.join(tmp, 'registry.json');
fs.writeFileSync(registryPath, JSON.stringify({
  projects: [{ id: 'scratch', name: 'scratch-proj', alias: '测试项目', path: projDir }],
  scanRoots: [tmp],
  aiPresets: [{ name: '本机 Open WebUI', url: 'http://localhost:3000' }]
}), 'utf8');

process.env.WB_REGISTRY = registryPath;

/* ---------- 上游桩：验证反代剥头与 base 注入 ---------- */
const upstream = createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'set-cookie': 'sid=leak; Path=/'
  });
  res.end('<html><head><title>upstream</title></head><body>hello upstream</body></html>');
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamPort = upstream.address().port;

/* ---------- 第二个上游桩：只给 CSP frame-ancestors，不给 X-Frame-Options ----------
   覆盖新增的 CSP 探测：'self' 要判为封锁，* 要放行 */
const cspOnly = createServer((req, res) => {
  const open = (req.url || '').startsWith('/open');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': open
      ? "default-src 'self'; frame-ancestors *"
      : "default-src 'self'; frame-ancestors 'self'"
  });
  res.end('<html><body>csp only</body></html>');
});
await new Promise((r) => cspOnly.listen(0, '127.0.0.1', r));
const cspPort = cspOnly.address().port;

const { startServer } = await import(pathToFileURL(path.join(ROOT, 'serve.mjs')).href);
const { server, port } = await startServer({ port: 0 });
const base = `http://127.0.0.1:${port}`;

const getJson = async (p) => {
  const res = await fetch(base + p);
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, res };
};
const postJson = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json, res };
};
const q = (s) => encodeURIComponent(s);

console.log('\n【本地服务路由契约】');

/* 1. 健康检查 */
{
  const { status, json } = await getJson('/api/health');
  check('GET /api/health 返回 200', status === 200, String(status));
  check('health.mode = server 且 version = 2.0', json && json.mode === 'server' && json.version === '2.0',
    json ? `${json.mode} / ${json.version}` : 'null');
  check('health.aiPresets 为数组且非空', Array.isArray(json?.aiPresets) && json.aiPresets.length > 0,
    json ? json.aiPresets.length + ' 项' : 'null');
  check('health 只暴露登记项目数', json?.projects === 1, String(json?.projects));
}

/* 2. 工作台本体 */
{
  const res = await fetch(base + '/');
  const html = await res.text();
  check('GET / 返回工作台 HTML', res.status === 200 && html.includes('<!DOCTYPE html>') && html.includes('cardGrid'),
    html.length + ' 字符');
  check('GET / 响应头为 text/html', (res.headers.get('content-type') || '').includes('text/html'),
    res.headers.get('content-type'));
}

/* 3. 目录树 */
{
  const { status, json } = await getJson('/api/tree?project=scratch');
  check('GET /api/tree 列目录', status === 200 && Array.isArray(json?.dirs) && Array.isArray(json?.files),
    json ? `${json.dirs.length} 目录 / ${json.files.length} 文件` : String(status));
  check('tree 忽略 node_modules 与 .git',
    json?.dirs.length === 1 && json.dirs[0].name === 'src',
    (json?.dirs || []).map((d) => d.name).join(','));
  check('tree 文件含 README.md 与 package.json',
    (json?.files || []).map((f) => f.name).sort().join(',') === 'README.md,package.json',
    (json?.files || []).map((f) => f.name).join(','));
  check('tree 文件带字节大小', (json?.files || []).every((f) => typeof f.size === 'number' && f.size > 0));
}

/* 4. 目录树：子目录导航 */
{
  const { status, json } = await getJson('/api/tree?project=scratch&path=' + q('src'));
  check('GET /api/tree 子目录', status === 200 && json?.path === 'src' && json.files.length === 1,
    json?.files?.[0]?.name);
}

/* 5. 目录树：错误分支 */
{
  const a = await getJson('/api/tree?project=nope');
  check('未知项目 → 404 not-found', a.status === 404 && a.json?.code === 'not-found', a.status + ' / ' + a.json?.code);
  const b = await getJson('/api/tree');
  check('缺 project 参数 → 400', b.status === 400, b.status + ' / ' + b.json?.error);
  const c = await getJson('/api/tree?project=scratch&path=' + q('../../escape'));
  check('路径穿越 → 400 out-of-range', c.status === 400 && c.json?.code === 'out-of-range', c.status + ' / ' + c.json?.code);
  const d = await getJson('/api/tree?project=scratch&path=' + q('README.md'));
  check('tree 指向文件 → 400 not-a-directory', d.status === 400 && d.json?.code === 'not-a-directory', d.status + ' / ' + d.json?.code);
}

/* 6. 文件读 */
{
  const { status, json } = await getJson('/api/file?project=scratch&path=' + q('README.md'));
  check('GET /api/file 读取内容一致', status === 200 && json?.content === '# scratch\nhello workbench\n',
    JSON.stringify(json?.content));
  check('file 返回 bytes 与 binary 标志', json?.bytes === 26 && json?.binary === false, String(json?.bytes));
  const a = await getJson('/api/file?project=scratch');
  check('file 缺 path → 400', a.status === 400, a.status + ' / ' + a.json?.error);
  const b = await getJson('/api/file?project=scratch&path=' + q('../registry.json'));
  check('file 路径穿越 → 400 out-of-range', b.status === 400 && b.json?.code === 'out-of-range', b.status + ' / ' + b.json?.code);
  const c = await getJson('/api/file?project=scratch&path=' + q('src'));
  check('file 指向目录 → 400 not-a-file', c.status === 400 && c.json?.code === 'not-a-file', c.status + ' / ' + c.json?.code);
}

/* 7. 文件写：往返 */
{
  const w = await postJson('/api/file', { project: 'scratch', path: 'src/new.txt', content: 'written by test\n' });
  check('POST /api/file 写入成功', w.status === 200 && w.json?.bytes === 16, w.status + ' / ' + JSON.stringify(w.json));
  const r = await getJson('/api/file?project=scratch&path=' + q('src/new.txt'));
  check('写后回读一致', r.status === 200 && r.json?.content === 'written by test\n', JSON.stringify(r.json?.content));
  check('写入落到磁盘', fs.readFileSync(path.join(projDir, 'src', 'new.txt'), 'utf8') === 'written by test\n');
}

/* 8. 文件写：错误分支 */
{
  const a = await postJson('/api/file', { project: 'scratch', path: 'no-such-dir/x.txt', content: 'x' });
  check('写入不存在目录 → 400 not-found', a.status === 400 && a.json?.code === 'not-found', a.status + ' / ' + a.json?.code);
  const b = await postJson('/api/file', { project: 'scratch', path: '../../escape.txt', content: 'x' });
  check('写入路径穿越 → 400 out-of-range', b.status === 400 && b.json?.code === 'out-of-range', b.status + ' / ' + b.json?.code);
  const c = await postJson('/api/file', { project: 'scratch', path: 'big.txt', content: 'a'.repeat(1024 * 1024 + 1) });
  check('写入超限 → 413', c.status === 413, c.status + ' / ' + c.json?.error);
  check('越界写入未落盘', !fs.existsSync(path.join(tmp, 'escape.txt')));
}

/* 9. 重扫索引 */
{
  const { status, json } = await getJson('/api/scan');
  check('GET /api/scan 返回扫描结果', status === 200 && Array.isArray(json?.projects) && !!json.scannedAt,
    json ? json.projects.length + ' 项' : String(status));
  check('scan 认出 scratch 项目及其语言', json?.projects.length === 1 && json.projects[0].name === 'scratch-proj'
    && json.projects[0].langs.includes('Node'),
    json?.projects?.[0] ? json.projects[0].langs.join('/') : '空');
}

/* 10. 端口采集 */
{
  const { status, json } = await getJson('/api/ports');
  check('GET /api/ports 返回数组', status === 200 && Array.isArray(json?.ports), status + ' / ' + json?.ports?.length + ' 条');
}

/* 10.5 自定义项目登记（项目栏「添加」把目录登记进服务） */
{
  const customDir = path.join(tmp, 'custom-proj');
  fs.mkdirSync(path.join(customDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(customDir, 'index.js'), 'export const x = 1;\n', 'utf8');

  const rel = await postJson('/api/register', { id: 'custom-1', name: '自定义', path: 'relative/dir' });
  check('register 拒绝相对路径 → 400', rel.status === 400 && /绝对路径/.test(rel.json?.error || ''),
    rel.status + ' / ' + rel.json?.error);

  const miss = await postJson('/api/register', { id: 'custom-1', name: '自定义', path: path.join(tmp, 'nope-dir') });
  check('register 拒绝不存在的路径 → 404', miss.status === 404, miss.status + ' / ' + miss.json?.error);

  const file = await postJson('/api/register', { id: 'custom-1', name: '自定义', path: path.join(customDir, 'index.js') });
  check('register 拒绝文件路径 → 400', file.status === 400 && /不是目录/.test(file.json?.error || ''),
    file.status + ' / ' + file.json?.error);

  const noId = await postJson('/api/register', { name: '自定义', path: customDir });
  check('register 缺 id → 400', noId.status === 400 && /缺少项目 id/.test(noId.json?.error || ''),
    noId.status + ' / ' + noId.json?.error);

  const ok = await postJson('/api/register', { id: 'custom-1', name: '自定义项目', path: customDir });
  check('register 登记成功', ok.status === 200 && ok.json?.project?.path === customDir, JSON.stringify(ok.json?.project));

  const tree = await getJson('/api/tree?project=custom-1');
  check('登记后仓库窗格可直接读取该目录',
    tree.status === 200 && (tree.json?.files || []).map((f) => f.name).join(',') === 'index.js',
    JSON.stringify(tree.json?.files));

  const read = await getJson('/api/file?project=custom-1&path=' + q('index.js'));
  check('登记后可直接读取文件内容', read.status === 200 && /export const x/.test(read.json?.content || ''), read.status + '');

  const again = await postJson('/api/register', { id: 'custom-1', name: '改名后', path: customDir });
  const persisted = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  check('重复登记同 id 为覆盖而非追加',
    again.status === 200 && persisted.projects.filter((p) => p.id === 'custom-1').length === 1,
    persisted.projects.map((p) => p.id).join(','));
  check('重复登记以新名称为准', persisted.projects.find((p) => p.id === 'custom-1')?.name === '改名后');
  check('登记未破坏既有条目', persisted.projects.some((p) => p.id === 'scratch' && p.path === projDir));
  check('登记保留扫描根与 AI 预设',
    Array.isArray(persisted.scanRoots) && persisted.scanRoots.length > 0 && Array.isArray(persisted.aiPresets));
}

/* 11. 探测与反代（打到本机上游桩） */
{
  const { status, json } = await getJson('/api/probe?url=' + q(`http://127.0.0.1:${upstreamPort}/`));
  check('GET /api/probe 识别上游状态与可嵌入性',
    status === 200 && json?.status === 200 && json?.embeddable === true && json?.frameBlock === 'X-Frame-Options: DENY',
    JSON.stringify(json));

  const cspBlocked = await getJson('/api/probe?url=' + q(`http://127.0.0.1:${cspPort}/`));
  check('probe 识别 CSP frame-ancestors 封锁',
    cspBlocked.status === 200 && cspBlocked.json?.frameBlock === "CSP frame-ancestors: 'self'",
    String(cspBlocked.json?.frameBlock));

  const cspOpen = await getJson('/api/probe?url=' + q(`http://127.0.0.1:${cspPort}/open`));
  check('probe 放过 frame-ancestors *',
    cspOpen.status === 200 && cspOpen.json?.frameBlock === null,
    String(cspOpen.json?.frameBlock));

  const res = await fetch(base + '/proxy?url=' + q(`http://127.0.0.1:${upstreamPort}/`));
  const html = await res.text();
  check('GET /proxy 剥离 x-frame-options', res.headers.get('x-frame-options') === null,
    String(res.headers.get('x-frame-options')));
  check('GET /proxy 剥离 CSP 与 set-cookie',
    res.headers.get('content-security-policy') === null && res.headers.get('set-cookie') === null);
  check('GET /proxy 注入 <base href> 让相对资源可解析', html.includes('<base href='), html.slice(0, 120));
  check('GET /proxy 正文完整透传', html.includes('hello upstream'));

  const bad = await getJson('/api/probe?url=' + q('ftp://example.com/x'));
  check('probe 拒绝非 http(s) → 400', bad.status === 400, bad.status + ' / ' + bad.json?.error);
}

/* 12. 兜底 */
{
  const { status, json } = await getJson('/api/nope');
  check('未知路由 → 404', status === 404 && /没有这个路径/.test(json?.error || ''), status + ' / ' + json?.error);
}

/* ---------- 收尾 ---------- */
server.close();
upstream.close();
cspOnly.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.log('✗ 服务端用例失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log('✓ 服务端路由契约全部通过');
