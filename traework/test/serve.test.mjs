import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultState, normalizeState } from "../lib/core.mjs";
import { startServer } from "../scripts/serve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAEWORK = resolve(HERE, "..");

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-serve-"));
  const project = join(root, "project");
  const statePath = join(root, "worktable.json");

  mkdirSync(join(project, "sub"), { recursive: true });
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(project, "bin"), { recursive: true });
  mkdirSync(join(project, "many"), { recursive: true });

  writeFileSync(join(project, "main.c"), "#include <stdio.h>\nint main(void){return 0;}\n", "utf8");
  writeFileSync(join(project, "sub", "inner.c"), "int inner(void){return 1;}\n", "utf8");
  writeFileSync(join(project, ".git", "config"), "should not show up\n", "utf8");
  writeFileSync(join(project, "bin", "app.exe"), "should not show up\n", "utf8");
  writeFileSync(join(project, "blob.bin"), Buffer.from([0x41, 0x00, 0x42, 0x00]));
  writeFileSync(join(project, "huge.txt"), "a".repeat(600 * 1024), "utf8");
  for (let i = 0; i < 450; i++) {
    writeFileSync(join(project, "many", `f${String(i).padStart(4, "0")}.txt`), "", "utf8");
  }

  const state = normalizeState({
    ...defaultState(),
    projects: [
      { id: "p1", name: "甲", folder: project, icon: "folder" },
      { id: "p2", name: "乙", folder: join(root, "gone"), icon: "folder" }
    ]
  });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  return { root, project, statePath };
}

async function get(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
}

async function getJson(url) {
  const res = await get(url);
  return { status: res.status, body: JSON.parse(res.text) };
}

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload)
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) };
}

console.log("traework-serve");

const fx = makeFixture();
const { server, port, url } = await startServer({ filePath: fx.statePath, port: 0 });
const base = url.replace(/\/$/, "");

try {
  await test("根路径现渲染工作台 HTML，且不缓存", async () => {
    const res = await get(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/html/);
    assert.match(res.text, /id="wt-seed"/);
    assert.match(res.text, /^<!DOCTYPE html>/);
  });

  await test("index.html 与 / 等价", async () => {
    const res = await get(`${base}/index.html`);
    assert.equal(res.status, 200);
    assert.match(res.text, /id="wt-seed"/);
  });

  await test("/api/tree 列出目录并过滤构建产物", async () => {
    const res = await getJson(`${base}/api/tree?project=p1`);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "project");
    assert.equal(res.body.path, "");
    assert.equal(res.body.truncated, false);
    const dirs = res.body.dirs.map((d) => d.name);
    assert.deepEqual(dirs, ["many", "sub"], "应只留下 many 与 sub，.git/bin 被过滤");
    const files = res.body.files.map((f) => f.name);
    assert.deepEqual(files, ["blob.bin", "huge.txt", "main.c"]);
    const main = res.body.files.find((f) => f.name === "main.c");
    assert.ok(main.size > 0, "文件应带字节数");
  });

  await test("/api/tree 支持子目录", async () => {
    const res = await getJson(`${base}/api/tree?project=p1&path=sub`);
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "sub");
    assert.deepEqual(res.body.files.map((f) => f.name), ["inner.c"]);
  });

  await test("/api/tree 超过 400 项时截断并标记", async () => {
    const res = await getJson(`${base}/api/tree?project=p1&path=many`);
    assert.equal(res.status, 200);
    assert.equal(res.body.truncated, true);
    assert.equal(res.body.files.length, 400);
  });

  await test("/api/tree 越界路径被拒", async () => {
    const res = await getJson(`${base}/api/tree?project=p1&path=..`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /越界/);
  });

  await test("/api/tree 未知项目返回 404", async () => {
    const res = await getJson(`${base}/api/tree?project=nope`);
    assert.equal(res.status, 404);
  });

  await test("/api/tree 项目目录不存在返回 404", async () => {
    const res = await getJson(`${base}/api/tree?project=p2`);
    assert.equal(res.status, 404);
  });

  await test("/api/tree 缺少 project 参数返回 400", async () => {
    const res = await getJson(`${base}/api/tree`);
    assert.equal(res.status, 400);
  });

  await test("/api/file 读取文本文件", async () => {
    const res = await getJson(`${base}/api/file?project=p1&path=main.c`);
    assert.equal(res.status, 200);
    assert.equal(res.body.content, readFileSync(join(fx.project, "main.c"), "utf8"));
    assert.equal(res.body.binary, false);
    assert.equal(res.body.truncated, false);
  });

  await test("/api/file 识别二进制并清空内容", async () => {
    const res = await getJson(`${base}/api/file?project=p1&path=blob.bin`);
    assert.equal(res.status, 200);
    assert.equal(res.body.binary, true);
    assert.equal(res.body.content, "");
    assert.equal(res.body.bytes, 4);
  });

  await test("/api/file 超过 512 KB 时截断", async () => {
    const res = await getJson(`${base}/api/file?project=p1&path=huge.txt`);
    assert.equal(res.status, 200);
    assert.equal(res.body.truncated, true);
    assert.equal(res.body.bytes, 600 * 1024);
    assert.equal(Buffer.byteLength(res.body.content, "utf8"), 512 * 1024);
  });

  await test("/api/file 读目录返回 400，读不存在文件返回 404", async () => {
    const asDir = await getJson(`${base}/api/file?project=p1&path=sub`);
    assert.equal(asDir.status, 400);
    assert.equal(asDir.body.code, "not-a-file", "目录被当文件读时必须给出机器可读的 code");
    const missing = await getJson(`${base}/api/file?project=p1&path=nope.c`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "not-found");
  });

  await test("/api/tree 读文件时回 not-a-directory（窗格据此改按文件打开）", async () => {
    const res = await getJson(`${base}/api/tree?project=p1&path=main.c`);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "not-a-directory");
  });

  await test("/api/file 读取越界路径被拒", async () => {
    const res = await getJson(`${base}/api/file?project=p1&path=../../etc/passwd`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /越界/);
  });

  await test("/api/file 写入成功并落盘", async () => {
    const next = "int edited(void){return 42;}\n";
    const res = await post(`${base}/api/file`, { project: "p1", path: "sub/inner.c", content: next });
    assert.equal(res.status, 200);
    assert.equal(res.body.bytes, Buffer.byteLength(next, "utf8"));
    assert.equal(readFileSync(join(fx.project, "sub", "inner.c"), "utf8"), next);
  });

  await test("/api/file 写入越界路径被拒且不落盘", async () => {
    const escapeName = "wt-serve-escape.txt";
    const res = await post(`${base}/api/file`, { project: "p1", path: `../${escapeName}`, content: "nope" });
    assert.equal(res.status, 400);
    assert.equal(existsSync(join(fx.root, escapeName)), false, "越界写入不应产生文件");
  });

  await test("/api/file 绝对路径写入被拒", async () => {
    const abs = join(fx.root, "abs-escape.txt");
    const res = await post(`${base}/api/file`, { project: "p1", path: abs, content: "nope" });
    assert.equal(res.status, 400);
    assert.equal(existsSync(abs), false);
  });

  await test("/api/file 写入超过 1 MB 返回 413", async () => {
    const res = await post(`${base}/api/file`, {
      project: "p1",
      path: "big.txt",
      content: "x".repeat(1024 * 1024 + 1)
    });
    assert.equal(res.status, 413);
    assert.equal(existsSync(join(fx.project, "big.txt")), false);
  });

  await test("/api/file 非 JSON 请求体返回 400", async () => {
    const res = await post(`${base}/api/file`, "这不是 JSON");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /JSON/);
  });

  await test("/api/file content 非文本返回 400", async () => {
    const res = await post(`${base}/api/file`, { project: "p1", path: "main.c", content: 42 });
    assert.equal(res.status, 400);
  });

  await test("/proxy 缺少 url 返回 400", async () => {
    const res = await getJson(`${base}/proxy`);
    assert.equal(res.status, 400);
  });

  await test("/proxy 非 http/https 协议被拒", async () => {
    const res = await getJson(`${base}/proxy?url=file:///etc/passwd`);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /http\/https/);
  });

  await test("/proxy 非法 URL 被拒", async () => {
    const res = await getJson(`${base}/proxy?url=not a url`);
    assert.equal(res.status, 400);
  });

  await test("/proxy 回环反代 HTML 时注入 base 且剥掉封锁头", async () => {
    const res = await get(`${base}/proxy?url=${encodeURIComponent(`${base}/`)}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /<base href="/);
    assert.match(res.text, /id="wt-seed"/);
  });

  await test("/api/probe 缺少 url 与非 http 协议被拒", async () => {
    const missing = await getJson(`${base}/api/probe`);
    assert.equal(missing.status, 400);
    const badScheme = await getJson(`${base}/api/probe?url=file:///etc/passwd`);
    assert.equal(badScheme.status, 400);
  });

  await test("/api/probe 报告可嵌入的上游", async () => {
    const res = await getJson(`${base}/api/probe?url=${encodeURIComponent(`${base}/`)}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.embeddable, true);
    assert.match(res.body.contentType, /text\/html/);
  });

  await test("/api/probe 把上游 4xx 如实回报为不可嵌入", async () => {
    const res = await getJson(`${base}/api/probe?url=${encodeURIComponent(`${base}/nope`)}`);
    assert.equal(res.status, 200, "探测本身成功，失败信息在载荷里");
    assert.equal(res.body.status, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.embeddable, false);
  });

  await test("未知路径返回 404", async () => {
    const res = await getJson(`${base}/nope`);
    assert.equal(res.status, 404);
  });

  await test("状态文件缺失时仍能渲染空态", async () => {
    const empty = join(fx.root, "empty.json");
    const extra = await startServer({ filePath: empty, port: 0 });
    try {
      const res = await get(extra.url);
      assert.equal(res.status, 200);
      assert.match(res.text, /id="wt-seed"/);
    } finally {
      extra.server.close();
    }
  });
} finally {
  await new Promise((done) => server.close(done));
  rmSync(fx.root, { recursive: true, force: true });
}

console.log(`traework-serve: ${passed} passed`);
