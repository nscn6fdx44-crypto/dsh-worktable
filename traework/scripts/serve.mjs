#!/usr/bin/env node
// 本地服务：一个进程同时提供三件事
//   1. 工作台 HTML（每次请求现渲染，改完数据文件刷新即可见）
//   2. 项目文件的目录树与读写 API（模块窗格 repo 用）
//   3. 网页反代（模块窗格 web 用；剥掉 X-Frame-Options，否则目标站点拒绝被内嵌）
// 纯 Node、零依赖。只读写数据文件里登记过的项目目录，路径一律限制在项目根之内。
import { createServer } from "node:http";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import * as core from "../lib/core.mjs";
import { buildHtml } from "./render.mjs";

/** 目录树里不展示的目录：构建产物、编辑器缓存、版本库内部。 */
const IGNORED_DIRS = new Set([
  ".git",
  ".vs",
  ".trae",
  ".worktable",
  "bin",
  "obj",
  "x64",
  "node_modules",
  "dist",
  "out"
]);

/** 反代时要剥掉的响应头：前两个是内嵌封锁，其余是编码/连接类，转发过去会与本地解码结果矛盾。 */
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
const USER_AGENT = "traework-worktable/0.1 (+local viewer)";

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readState(filePath) {
  if (!existsSync(filePath)) return core.defaultState();
  return core.normalizeState(JSON.parse(readFileSync(filePath, "utf8")));
}

function projectRoot(state, projectId) {
  if (!projectId) throw new HttpError(400, "缺少 project 参数");
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new HttpError(404, `找不到项目：${projectId}`);
  if (!project.folder) throw new HttpError(404, `项目 ${project.name} 没有登记目录`);
  if (!existsSync(project.folder)) throw new HttpError(404, `项目目录不存在：${project.folder}`);
  return project.folder;
}

/** 把相对路径钉在项目根之内；`..` 或绝对路径一律拒绝。 */
function resolveWithin(root, relPath) {
  const base = resolve(root);
  const target = resolve(base, relPath || ".");
  if (target !== base && !target.startsWith(base + sep)) {
    throw new HttpError(400, "路径越界，已拒绝");
  }
  return target;
}

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
      try {
        size = statSync(resolve(absPath, entry.name)).size;
      } catch {
        size = 0;
      }
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
  try {
    readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }

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
    throw new HttpError(400, `目标目录不存在：${relPath}`);
  }
  writeFileSync(absPath, content, "utf8");
  return { path: relPath, bytes };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, filePath) {
  const html = buildHtml(readState(filePath));
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
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

function targetUrl(rawUrl) {
  if (!rawUrl) throw new HttpError(400, "缺少 url 参数");
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new HttpError(400, `不是合法 URL：${rawUrl}`);
  }
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

/** 只探上游状态，不转发正文：让网页窗格能先把「为什么打不开」讲清楚，而不是甩一个空白框。 */
async function probe(rawUrl) {
  const target = targetUrl(rawUrl);
  const upstream = await fetchUpstream(target);
  const status = upstream.status;
  const contentType = upstream.headers.get("content-type") ?? "";
  await upstream.body?.cancel().catch(() => {});
  return {
    url: target.href,
    status,
    contentType,
    ok: status < 400,
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

async function handle(req, res, filePath) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const state = readState(filePath);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(res, filePath);
    return;
  }
  if (url.pathname === "/api/tree") {
    const root = projectRoot(state, url.searchParams.get("project"));
    sendJson(res, 200, listDir(root, url.searchParams.get("path") ?? ""));
    return;
  }
  if (url.pathname === "/api/file" && req.method === "GET") {
    const root = projectRoot(state, url.searchParams.get("project"));
    sendJson(res, 200, readTextFile(root, url.searchParams.get("path") ?? ""));
    return;
  }
  if (url.pathname === "/api/file" && req.method === "POST") {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "请求体不是合法 JSON");
    }
    const root = projectRoot(state, payload?.project);
    sendJson(res, 200, writeTextFile(root, payload?.path ?? "", payload?.content));
    return;
  }
  if (url.pathname === "/api/probe") {
    sendJson(res, 200, await probe(url.searchParams.get("url") ?? ""));
    return;
  }
  if (url.pathname === "/proxy") {
    await proxy(url.searchParams.get("url") ?? "", res);
    return;
  }
  throw new HttpError(404, `没有这个路径：${url.pathname}`);
}

export function startServer({ filePath, port = 7331, host = "127.0.0.1" }) {
  const server = createServer((req, res) => {
    handle(req, res, filePath).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      const text = error instanceof Error ? error.message : String(error);
      const code = error instanceof HttpError ? error.code : null;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, status, { error: text, code });
    });
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address();
      const actualPort = typeof actual === "object" && actual ? actual.port : port;
      resolvePromise({ server, port: actualPort, url: `http://${host}:${actualPort}/` });
    });
  });
}
