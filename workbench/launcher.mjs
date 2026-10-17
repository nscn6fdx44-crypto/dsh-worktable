#!/usr/bin/env node
/*
 * 工作台启动器（零依赖）
 *
 * 浏览器沙箱禁止网页直接拉起本机进程，所以「网页里一键启动本地服务」需要一个
 * 常驻的极轻 Node 进程来当桥梁：它只绑 127.0.0.1（本机管理用），提供一个启动页，
 * 点「启动工作台」就拉起 serve.mjs 并跳转到它。
 *
 * 用法：
 *   node launcher.mjs                          # 常驻 127.0.0.1:7339
 *   WB_LAUNCHER_PORT=7400 node launcher.mjs    # 换端口
 *
 * 想让「别的电脑也能连」，给 serve 设 WB_HOST=0.0.0.0 与 WB_TOKEN：
 *   这些值会从环境变量透传给 serve（launcher 继承 process.env）。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WB_LAUNCHER_PORT) || 7339;
const SERVE_PORT = Number(process.env.WB_PORT) || 7331;
const SERVE_HOST = process.env.WB_HOST || "127.0.0.1";
const TOKEN_REQUIRED = Boolean(process.env.WB_TOKEN);
const VERSION = "1.0";

let serveProc = null;
let serveReady = false;

function lanAddresses() {
  const out = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  } catch { /* 取不到网卡信息不影响主功能 */ }
  return out;
}

let serveActualPort = SERVE_PORT;
function serveUrl() {
  return "http://127.0.0.1:" + serveActualPort + "/";
}
async function healthOkOn(port) {
  try {
    const r = await fetch("http://127.0.0.1:" + port + "/api/health");
    return r.ok;
  } catch { return false; }
}
async function healthOk() { return healthOkOn(serveActualPort); }

function launchServe() {
  if (serveProc) return { ok: true, already: true };
  const child = spawn(process.execPath, [join(ROOT, "serve.mjs")], {
    env: { ...process.env },
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  serveProc = child;
  child.on("exit", () => { serveProc = null; serveReady = false; });
  return { ok: true, already: false };
}

async function waitReady(ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < 20; i++) {
      const p = SERVE_PORT + i;
      if (await healthOkOn(p)) { serveActualPort = p; serveReady = true; return true; }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const PAGE = [
  "<!doctype html>",
  "<html lang='zh-CN'><head><meta charset='utf-8'>",
  "<meta name='viewport' content='width=device-width, initial-scale=1'>",
  "<title>工作台启动器</title>",
  "<style>",
  "  :root{color-scheme:dark}",
  "  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
  "    background:#0f1115;color:#e6e6e6;font:15px/1.6 system-ui,'Segoe UI',sans-serif}",
  "  .card{width:min(560px,92vw);background:#171a21;border:1px solid #262b36;border-radius:14px;padding:28px 30px;box-shadow:0 18px 50px rgba(0,0,0,.45)}",
  "  h1{margin:0 0 4px;font-size:20px}",
  "  .sub{color:#9aa4b2;margin:0 0 20px;font-size:13px}",
  "  .status{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:#0f1115;border:1px solid #262b36;margin-bottom:16px}",
  "  .dot{width:10px;height:10px;border-radius:50%;background:#3a3f4b;flex:none}",
  "  .dot.on{background:#2ecc71;box-shadow:0 0 0 4px rgba(46,204,113,.18)}",
  "  .btn{display:block;width:100%;box-sizing:border-box;padding:13px 16px;border:0;border-radius:10px;",
  "    background:#3b82f6;color:#fff;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}",
  "  .btn:hover{background:#2f6fe0}",
  "  .btn[disabled]{opacity:.5;cursor:default}",
  "  .ghost{background:#222732;border:1px solid #313845;color:#cdd5e0;margin-top:10px}",
  "  .lan{margin-top:18px;padding-top:16px;border-top:1px solid #262b36;font-size:13px;color:#9aa4b2}",
  "  .lan code{background:#0f1115;padding:2px 7px;border-radius:6px;color:#7ee787;border:1px solid #262b36}",
  "  .note{margin-top:14px;font-size:12px;color:#7b8494;line-height:1.7}",
  "</style></head><body>",
  "<div class='card'>",
  "  <h1>工作台启动器</h1>",
  "  <p class='sub'>零依赖本地服务 · 启动器 v" + VERSION + "</p>",
  "  <div class='status'><span class='dot' id='dot'></span><span id='stxt'>检测中…</span></div>",
  "  <button class='btn' id='go' disabled>启动工作台</button>",
  "  <div class='lan' id='lan'></div>",
  "  <div class='note'>",
  "    · 本机打开网页后点「选择本机目录」，扫的是<b>你这台电脑</b>的目录（浏览器安全沙箱，任何网页都如此）。<br>",
  "    · 若已设 <code>WB_HOST=0.0.0.0</code> + <code>WB_TOKEN</code>，同事用下方局域网地址连上后，其「projects 重扫」扫的是<b>这台服务器</b>的目录；他们点「选择本机目录」则扫他们自己的电脑。<br>",
  "    · 启动器仅绑 127.0.0.1，仅供本机管理，不对外暴露。",
  "  </div>",
  "</div>",
  "<script>",
  "  var dot=document.getElementById('dot'),stxt=document.getElementById('stxt'),go=document.getElementById('go'),lan=document.getElementById('lan');",
  "  function setStatus(running,url){",
  "    dot.className='dot'+(running?' on':'');",
  "    if(running){stxt.textContent='工作台已在运行：'+url;go.textContent='打开工作台';go.disabled=false;go.onclick=function(){location.href=url;};}",
  "    else{stxt.textContent='工作台未启动';go.textContent='启动工作台';go.disabled=false;go.onclick=start;}",
  "  }",
  "  function start(){go.disabled=true;go.textContent='启动中…';",
  "    fetch('/launch',{method:'POST'}).then(function(r){return r.json();}).then(function(j){",
  "      if(j.ok){location.href=j.url;}else{go.disabled=false;go.textContent='启动失败：'+(j.error||'未知');}",
  "    }).catch(function(e){go.disabled=false;go.textContent='启动失败：'+e;});",
  "  }",
  "  function refresh(){fetch('/api/status').then(function(r){return r.json();}).then(function(s){",
  "    setStatus(s.running,s.url);",
  "    if(s.lan&&s.lan.length){lan.innerHTML='同事可访问（需你已设 WB_HOST=0.0.0.0）：<br>'+s.lan.map(function(ip){return '<code>http://'+ip+':'+s.servePort+'/</code>';}).join(' &nbsp; ')+(s.tokenRequired?' &nbsp; 需带 ?token=你的令牌':'');}",
  "    else{lan.innerHTML='当前仅本机可访问（WB_HOST 未设 0.0.0.0）。';}",
  "  });}",
  "  refresh();setInterval(refresh,3000);",
  "</script>",
  "</body></html>"
].join("\n");

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}
function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:" + PORT);
    if (url.pathname === "/" || url.pathname === "/index.html") return send(res, 200, PAGE, "text/html; charset=utf-8");

    if (url.pathname === "/api/status") {
      const running = !!(serveProc && serveReady) || (await healthOk());
      return sendJson(res, 200, {
        running,
        url: serveUrl(),
        servePort: serveActualPort,
        lan: lanAddresses(),
        tokenRequired: TOKEN_REQUIRED
      });
    }

    if (url.pathname === "/launch" && req.method === "POST") {
      const r = launchServe();
      if (!r.ok) return sendJson(res, 500, { ok: false, error: "启动失败" });
      const ready = await waitReady();
      if (!ready) return sendJson(res, 504, { ok: false, error: "服务启动超时，请检查 7331 端口是否被占用" });
      return sendJson(res, 200, { ok: true, url: serveUrl() });
    }

    return sendJson(res, 404, { error: "没有这个路径：" + url.pathname });
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.message || error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  工作台启动器已就绪");
  console.log("  本机打开： http://127.0.0.1:" + PORT + "/");
  console.log("  点「启动工作台」即可拉起本地服务并跳转。");
  console.log("");
  console.log("  · 服务端口 " + SERVE_PORT + "，绑定 " + SERVE_HOST);
  console.log("  · 令牌 " + (TOKEN_REQUIRED ? "已启用（非本机需带令牌）" : "未启用"));
  console.log("  · 按 Ctrl+C 停止（不影响已拉起的本地服务）");
  console.log("");
});

process.on("SIGINT", () => { console.log("\n  启动器已停止。"); process.exit(0); });
