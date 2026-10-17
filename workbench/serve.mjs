#!/usr/bin/env node
/*
 * 工作台本地服务（零依赖）
 *
 * 一个进程同时提供四件事：
 *   1. workbench.html —— 单文件工作台本身（每次请求现读，改完刷新即见）
 *   2. 项目文件的目录树与读写 API（repo 窗格；无需浏览器目录选择器）
 *   3. 本机项目索引重扫与端口采集（projects 窗格）
 *   4. 网页反代（web / chat 窗格；剥掉 X-Frame-Options 等内嵌封锁头）
 *
 * 安全边界：写操作只经 /api/file，且路径一律钉死在 workbench.registry.json
 * 里登记过的项目根之内；服务只绑 127.0.0.1。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  closeSync, existsSync, openSync, readFileSync, readdirSync, readSync,
  statSync, writeFileSync
} from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* 访问令牌：设了 WB_TOKEN 后，除本机（127.0.0.1）外，所有 /api 与 /proxy 请求
   必须带 ?token=… 或请求头 x-wb-token / Authorization: Bearer。本机豁免，自己无感。 */
const REQUIRED_TOKEN = process.env.WB_TOKEN || "";
function isLocalAddress(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}
function tokenOk(req) {
  if (!REQUIRED_TOKEN) return true;
  if (isLocalAddress(req.socket.remoteAddress)) return true;
  const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const q = u.searchParams.get("token") || "";
  const h = String(req.headers["x-wb-token"] || "");
  const auth = String(req.headers["authorization"] || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return q === REQUIRED_TOKEN || h === REQUIRED_TOKEN || bearer === REQUIRED_TOKEN;
}

const ROOT = dirname(fileURLToPath(import.meta.url));
/* 个人版 workbench.html 优先；只有公开版 index.html 时也能跑 */
const HTML_PATH = existsSync(join(ROOT, "workbench.html"))
  ? join(ROOT, "workbench.html")
  : join(ROOT, "index.html");
const REGISTRY_PATH = join(ROOT, "workbench.registry.json");
const VERSION = "2.0";

/* 反代时要剥掉的响应头：前两个是内嵌封锁，其余是编码/连接类，
   转发过去会与本地解码结果矛盾；set-cookie 一并剥掉以降低攻击面。 */
const STRIPPED_HEADERS = new Set([
  "x-frame-options",
  "frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "set-cookie2",
  "strict-transport-security"
]);

const MAX_ENTRIES = 400;
const MAX_READ = 512 * 1024;
const MAX_WRITE = 1024 * 1024;
const PROXY_TIMEOUT_MS = 15000;
const USER_AGENT = "workbench-local/2.0 (+local viewer)";

/* 目录树里不展示的目录：构建产物、编辑器缓存、版本库内部 */
const IGNORED_DIRS = new Set([
  ".git", ".vs", ".trae", ".worktable", ".vscode", ".idea",
  "node_modules", "dist", "out", "build", "bin", "obj", "x64",
  ".next", ".cache", ".venv", "venv", "__pycache__", "target", "coverage"
]);

/* 重扫索引时的遍历规则（与早期采集脚本一致）。
   一律由 homedir 推导，不写死任何用户名，仓库可公开。 */
const HOME = homedir();
const DEFAULT_SCAN_ROOTS = [
  join(HOME, "Desktop"),
  join(HOME, "source"),
  join(HOME, "Documents"),
  join(HOME, "code"),
  join(HOME, "AppData", "Roaming", "TRAE SOLO CN", "ModularData", "ai-agent", "work-mode-projects"),
  join(HOME, ".trae-cn", "skills")
];

const SCAN_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", "build", ".vscode", ".venv", "venv",
  "__pycache__", "target", "bin", "obj", ".next", ".cache", "Library", "Temp",
  ".trae", ".idea", "coverage", ".pytest_cache", ".mypy_cache"
]);

const DEFAULT_AI_PRESETS = [
  { name: "本机 Open WebUI", url: "http://localhost:3000" },
  { name: "本机 LobeChat", url: "http://localhost:3210" },
  { name: "本机 LibreChat", url: "http://localhost:3080" },
  { name: "DeepSeek", url: "https://chat.deepseek.com" },
  { name: "豆包", url: "https://www.doubao.com/chat" },
  { name: "ChatGPT", url: "https://chatgpt.com" }
];

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ============================================================
   登记表
   ============================================================ */
function registryPath() {
  return process.env.WB_REGISTRY || REGISTRY_PATH;
}

function loadRegistry() {
  const registryPath_ = registryPath();
  if (!existsSync(registryPath_)) {
    return { projects: [], scanRoots: DEFAULT_SCAN_ROOTS, aiPresets: DEFAULT_AI_PRESETS };
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath_, "utf8").replace(/^\uFEFF/, ""));
    return {
      projects: Array.isArray(raw.projects) ? raw.projects : [],
      scanRoots: Array.isArray(raw.scanRoots) && raw.scanRoots.length ? raw.scanRoots : DEFAULT_SCAN_ROOTS,
      aiPresets: Array.isArray(raw.aiPresets) && raw.aiPresets.length ? raw.aiPresets : DEFAULT_AI_PRESETS
    };
  } catch (error) {
    throw new HttpError(500, `登记表解析失败：${error.message}`);
  }
}

/** 登记一个自定义项目目录，让 repo 窗格能读写它。
    只增不删：移除项目只影响界面，登记表保持完整，以便随时恢复。 */
function registerProject({ id, name, path }) {
  if (!id || typeof id !== "string") throw new HttpError(400, "缺少项目 id");
  const abs = typeof path === "string" ? path.trim() : "";
  if (!abs) throw new HttpError(400, "缺少项目路径");
  if (!isAbsolute(abs)) throw new HttpError(400, "目录路径必须是绝对路径");
  if (!existsSync(abs)) throw new HttpError(404, `路径不存在：${abs}`, "not-found");
  if (!statSync(abs).isDirectory()) throw new HttpError(400, `不是目录：${abs}`, "not-a-directory");

  const registry = loadRegistry();
  const entry = { id, name: name || basename(abs), path: abs, langs: detectLangs(abs) };
  const idx = registry.projects.findIndex((p) => p.id === id);
  if (idx >= 0) registry.projects[idx] = { ...registry.projects[idx], ...entry };
  else registry.projects.push(entry);

  writeFileSync(registryPath(), JSON.stringify(registry, null, 2), "utf8");
  return entry;
}

function projectRoot(registry, projectId) {
  if (!projectId) throw new HttpError(400, "缺少 project 参数");
  const project = registry.projects.find((p) => p.id === projectId);
  if (!project) throw new HttpError(404, `找不到项目：${projectId}`, "not-found");
  if (!project.path) throw new HttpError(404, `项目 ${project.name || projectId} 没有登记目录`, "not-found");
  if (!existsSync(project.path)) throw new HttpError(404, `项目目录不存在：${project.path}`, "not-found");
  return project.path;
}

/** 把相对路径钉在项目根之内；`..` 或绝对路径一律拒绝。 */
function resolveWithin(root, relPath) {
  const base = resolve(root);
  const target = resolve(base, relPath || ".");
  if (target !== base && !target.startsWith(base + sep)) {
    throw new HttpError(400, "路径越界，已拒绝", "out-of-range");
  }
  return target;
}

/* ============================================================
   文件读写
   ============================================================ */
function listDir(root, relPath) {
  const absPath = resolveWithin(root, relPath);
  if (!existsSync(absPath)) throw new HttpError(404, `目录不存在：${relPath || "/"}`, "not-found");
  if (!statSync(absPath).isDirectory()) throw new HttpError(400, `不是目录：${relPath}`, "not-a-directory");

  const dirs = [];
  const files = [];
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      dirs.push({ name: entry.name, path: childRel });
    } else if (entry.isFile()) {
      let size = 0;
      try { size = statSync(join(absPath, entry.name)).size; } catch { size = 0; }
      files.push({ name: entry.name, path: childRel, size });
    }
  }
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));

  const total = dirs.length + files.length;
  const truncated = total > MAX_ENTRIES;
  return {
    name: basename(absPath),
    path: relPath,
    dirs: truncated ? dirs.slice(0, MAX_ENTRIES) : dirs,
    files: truncated ? files.slice(0, Math.max(0, MAX_ENTRIES - dirs.length)) : files,
    truncated
  };
}

function readTextFile(root, relPath) {
  if (!relPath) throw new HttpError(400, "缺少 path 参数");
  const absPath = resolveWithin(root, relPath);
  if (!existsSync(absPath)) throw new HttpError(404, `文件不存在：${relPath}`, "not-found");
  const stat = statSync(absPath);
  if (!stat.isFile()) throw new HttpError(400, `不是文件：${relPath}`, "not-a-file");

  const truncated = stat.size > MAX_READ;
  const length = Math.min(stat.size, MAX_READ);
  const buffer = Buffer.alloc(length);
  const fd = openSync(absPath, "r");
  try { readSync(fd, buffer, 0, length, 0); } finally { closeSync(fd); }

  const binary = buffer.includes(0);
  return {
    path: relPath,
    content: binary ? "" : buffer.toString("utf8"),
    bytes: stat.size,
    truncated,
    binary
  };
}

function writeTextFile(root, relPath, content) {
  if (!relPath) throw new HttpError(400, "缺少 path 参数");
  if (typeof content !== "string") throw new HttpError(400, "content 需要是文本");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE) {
    throw new HttpError(413, `内容 ${bytes} 字节，超过 ${Math.round(MAX_WRITE / 1024)} KB 上限`);
  }
  const absPath = resolveWithin(root, relPath);
  const parent = dirname(absPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new HttpError(400, `目标目录不存在：${relPath}`, "not-found");
  }
  writeFileSync(absPath, content, "utf8");
  return { path: relPath, bytes };
}

/* ============================================================
   本机项目索引重扫
   ============================================================ */
const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_NODES = 40000;

function detectLangs(dir) {
  const has = (name) => existsSync(join(dir, name));
  const langs = [];
  if (has("package.json")) {
    langs.push(has("tsconfig.json") ? "TypeScript" : "JavaScript");
    langs.push("Node");
  }
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("manage.py")) langs.push("Python");
  if (has("Cargo.toml")) langs.push("Rust");
  if (has("go.mod")) langs.push("Go");
  if (has("pom.xml") || has("build.gradle")) langs.push("Java");
  if (has("CMakeLists.txt")) langs.push("C/C++");
  if (has("platformio.ini")) langs.push("PlatformIO");
  if (has("Gemfile")) langs.push("Ruby");
  if (has("composer.json")) langs.push("PHP");
  if (has("pubspec.yaml")) langs.push("Dart");

  if (!langs.length) {
    let names = [];
    try { names = readdirSync(dir); } catch { names = []; }
    const ext = (e) => names.some((n) => n.toLowerCase().endsWith(e));
    if (ext(".sln") || ext(".csproj")) langs.push("C#");
    if (ext(".ino")) langs.push("Arduino");
    if (ext(".rproj")) langs.push("R");
    if (ext(".c") || ext(".h")) langs.push("C");
  }
  if (!langs.length) langs.push("Other");
  return [...new Set(langs)];
}

function measureDir(dir) {
  let bytes = 0;
  let files = 0;
  let nodes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++nodes > SCAN_MAX_NODES) return { bytes, files, truncated: true };
      if (e.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(e.name)) continue;
        stack.push(join(cur, e.name));
      } else if (e.isFile()) {
        try { bytes += statSync(join(cur, e.name)).size; } catch { /* 读不到就跳过 */ }
        files++;
      }
    }
  }
  return { bytes, files, truncated: false };
}

function scanProjects(roots) {
  const found = [];

  const walk = (dir, depth) => {
    if (depth > SCAN_MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SCAN_SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      const langs = detectLangs(full);
      if (langs.length > 1 || langs[0] !== "Other") {
        const { bytes, files, truncated } = measureDir(full);
        let updated = "";
        try { updated = statSync(full).mtime.toISOString().slice(0, 10); } catch { updated = ""; }
        found.push({
          name: e.name,
          path: full,
          langs,
          git: existsSync(join(full, ".git")),
          updated,
          sizeBytes: bytes,
          files,
          sizeTruncated: truncated,
          depth
        });
      }
      walk(full, depth + 1);
    }
  };

  for (const r of roots) {
    if (!existsSync(r)) continue;
    walk(r, 1);
  }
  found.sort((a, b) => b.sizeBytes - a.sizeBytes || collator.compare(a.name, b.name));
  return found;
}

/* ============================================================
   端口采集（Windows 走 netstat + tasklist，其他平台降级）
   ============================================================ */
function runSync(cmd, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", () => resolvePromise(null));
    child.on("close", () => resolvePromise(Buffer.concat(chunks).toString("latin1")));
  });
}

async function scanPorts() {
  if (process.platform !== "win32") {
    return { ports: [], note: "端口采集目前仅支持 Windows，其他平台返回空列表" };
  }
  const [netstat, tasklist] = await Promise.all([
    runSync("netstat", ["-ano", "-p", "TCP"]),
    runSync("tasklist", ["/FO", "CSV", "/NH"])
  ]);
  if (!netstat) return { ports: [], note: "netstat 不可用，端口列表为空" };

  const procs = new Map();
  for (const line of (tasklist || "").split(/\r?\n/)) {
    const cols = line.split('","').map((s) => s.replace(/^"|"$/g, ""));
    if (cols.length < 5) continue;
    const pid = Number(cols[1]);
    if (!Number.isFinite(pid)) continue;
    const kb = Number(String(cols[4]).replace(/[^\d]/g, ""));
    procs.set(pid, { proc: cols[0], memMB: Number.isFinite(kb) ? Math.round((kb / 1024) * 10) / 10 : 0 });
  }

  const ports = [];
  for (const line of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line);
    if (!m) continue;
    const pid = Number(m[3]);
    const info = procs.get(pid) || { proc: "?", memMB: 0 };
    ports.push({
      port: Number(m[2]),
      address: m[1],
      pid,
      proc: info.proc,
      memMB: info.memMB,
      procPath: null,
      title: ""
    });
  }
  ports.sort((a, b) => a.port - b.port);
  return { ports, note: null };
}

/* ============================================================
   反代
   ============================================================ */
function targetUrl(rawUrl) {
  if (!rawUrl) throw new HttpError(400, "缺少 url 参数");
  let target;
  try { target = new URL(rawUrl); } catch { throw new HttpError(400, `不是合法 URL：${rawUrl}`); }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new HttpError(400, `只支持 http/https，收到：${target.protocol}`);
  }
  return target;
}

async function fetchUpstream(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    return await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "*/*" }
    });
  } catch (error) {
    throw new HttpError(502, `上游请求失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 只探上游状态，不转发正文：让窗格能先把「为什么打不开」讲清楚。 */
async function probe(rawUrl) {
  const target = targetUrl(rawUrl);
  const upstream = await fetchUpstream(target);
  const status = upstream.status;
  const contentType = upstream.headers.get("content-type") ?? "";
  const xfo = upstream.headers.get("x-frame-options");
  const csp = upstream.headers.get("content-security-policy") ?? "";
  await upstream.body?.cancel().catch(() => {});
  /* CSP 的 frame-ancestors 和 X-Frame-Options 一样会挡内嵌，而且更常见；
     只有 * 才是真的放行，'self' 或白名单对我们都是拦 */
  const ancestors = /frame-ancestors([^;]*)/i.exec(csp);
  const ancestorsValue = ancestors ? ancestors[1].trim() : "";
  const cspBlocks = Boolean(ancestorsValue) && ancestorsValue !== "*";
  const frameBlock = xfo
    ? `X-Frame-Options: ${String(xfo)}`
    : (cspBlocks ? `CSP frame-ancestors: ${ancestorsValue}` : null);
  return {
    url: target.href,
    status,
    contentType,
    ok: status < 400,
    frameBlock,
    embeddable: status < 400 && contentType.includes("text/html")
  };
}

async function proxy(rawUrl, res) {
  const target = targetUrl(rawUrl);
  const upstream = await fetchUpstream(target);

  const headers = {};
  for (const [key, value] of upstream.headers) {
    if (STRIPPED_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = value;
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const base = new URL(".", target).href.replace(/"/g, "%22");
    let html = await upstream.text();
    const tag = `<base href="${base}">`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`) : tag + html;
    const buffer = Buffer.from(html, "utf8");
    res.writeHead(upstream.status, { ...headers, "content-length": buffer.byteLength });
    res.end(buffer);
    return;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, { ...headers, "content-length": buffer.byteLength });
  res.end(buffer);
}

/* ============================================================
   路由
   ============================================================ */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res) {
  if (!existsSync(HTML_PATH)) throw new HttpError(500, "workbench.html 不存在，请先跑 node build/build.mjs");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(readFileSync(HTML_PATH));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_WRITE + 4096) {
        reject(new HttpError(413, "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const registry = loadRegistry();

  if (url.pathname === "/" || url.pathname === "/index.html") return sendHtml(res);
  if (!tokenOk(req)) throw new HttpError(401, "需要访问令牌：在 URL 加 ?token=… 或用请求头 x-wb-token", "token-required");

  if (url.pathname === "/api/health") {
    const lan = [];
    try {
      for (const list of Object.values(networkInterfaces())) {
        for (const n of list || []) if (n.family === "IPv4" && !n.internal) lan.push(n.address);
      }
    } catch { /* 取不到网卡信息不影响主功能 */ }
    return sendJson(res, 200, {
      ok: true,
      mode: "server",
      version: VERSION,
      root: ROOT,
      host: process.env.WB_HOST || "127.0.0.1",
      lan,
      tokenRequired: !!REQUIRED_TOKEN,
      projects: registry.projects.length,
      scanRoots: registry.scanRoots.length,
      aiPresets: registry.aiPresets
    });
  }

  if (url.pathname === "/api/tree") {
    const root = projectRoot(registry, url.searchParams.get("project"));
    return sendJson(res, 200, listDir(root, url.searchParams.get("path") ?? ""));
  }

  if (url.pathname === "/api/file" && req.method === "GET") {
    const root = projectRoot(registry, url.searchParams.get("project"));
    return sendJson(res, 200, readTextFile(root, url.searchParams.get("path") ?? ""));
  }

  if (url.pathname === "/api/file" && req.method === "POST") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new HttpError(400, "请求体不是合法 JSON"); }
    const root = projectRoot(registry, payload?.project);
    return sendJson(res, 200, writeTextFile(root, payload?.path ?? "", payload?.content));
  }

  if (url.pathname === "/api/register" && req.method === "POST") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new HttpError(400, "请求体不是合法 JSON"); }
    return sendJson(res, 200, { ok: true, project: registerProject(payload ?? {}) });
  }

  if (url.pathname === "/api/scan") {
    const projects = scanProjects(registry.scanRoots);
    return sendJson(res, 200, {
      scannedAt: new Date().toISOString(),
      roots: registry.scanRoots,
      projects
    });
  }

  if (url.pathname === "/api/ports") {
    const result = await scanPorts();
    return sendJson(res, 200, { scannedAt: new Date().toISOString(), ...result });
  }

  if (url.pathname === "/api/probe") return sendJson(res, 200, await probe(url.searchParams.get("url") ?? ""));

  if (url.pathname === "/proxy") return proxy(url.searchParams.get("url") ?? "", res);

  throw new HttpError(404, `没有这个路径：${url.pathname}`);
}

/* ============================================================
   启动
   ============================================================ */
function listen(server, port, host) {
  return new Promise((resolvePromise, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolvePromise(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function startServer({ port = 7331, host = "127.0.0.1", tries = 20 } = {}) {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      const text = error instanceof Error ? error.message : String(error);
      const code = error instanceof HttpError ? error.code : null;
      if (res.headersSent) { res.destroy(); return; }
      sendJson(res, status, { error: text, code });
    });
  });

  for (let i = 0; i < tries; i++) {
    try {
      const address = await listen(server, port + i, host);
      const actual = typeof address === "object" && address ? address.port : port + i;
      return { server, port: actual, url: `http://${host}:${actual}/` };
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`端口 ${port} 起的 ${tries} 个位置都被占用`);
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch { /* 打不开浏览器不是错误，用户手动复制 URL 即可 */ }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (!existsSync(HTML_PATH)) {
    console.error("找不到 workbench.html，请先运行： node build/build.mjs");
    process.exit(1);
  }
  const host = process.env.WB_HOST || "127.0.0.1";
  const { url, port } = await startServer({ port: Number(process.env.WB_PORT) || 7331, host });
  const registry = loadRegistry();
  console.log("");
  console.log("  工作台本地服务已启动");
  console.log("  " + url);
  console.log("");
  console.log("  · 登记项目 " + registry.projects.length + " 个，可读写");
  console.log("  · 重扫根目录 " + registry.scanRoots.length + " 个");
  console.log("  · 按 Ctrl+C 停止");
  console.log("");
  if (process.env.WB_NO_OPEN !== "1") openBrowser(url);
  process.on("SIGINT", () => { console.log("\n  已停止。"); process.exit(0); });
  void port;
}
