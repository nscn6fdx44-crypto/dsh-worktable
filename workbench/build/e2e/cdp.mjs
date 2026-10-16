/* 零依赖 CDP 客户端：只用 Node 内置的 fetch 与 WebSocket（Node 22 起全局可用），
   不引入 puppeteer / playwright / ws。本仓库要求 Node 端零 npm 依赖，这条不能用别的实现换掉。

   用途：驱动真实 Edge/Chrome 跑权限降级矩阵。
   两个关键约束：
   ① 注入必须在 navigate 之前（Page.addScriptToEvaluateOnNewDocument），
      否则模板在解析阶段就把 showDirectoryPicker 读走了，事后替换来不及。
      因为每个场景要注入不同的桩，所以每个场景开一个独立标签页，避免注入源相互叠加。
   ② 点击必须用 Input.dispatchMouseEvent：CDP 派发的事件是 trusted，会激活 userActivation；
      页面内 element.click() 造不出手势，会让「保存时争取写权限」这类用例全部假失败。 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  process.env.WT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

export function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

export async function launch(browser, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cdp-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-component-update',
    '--disable-background-networking', '--disable-features=Translate,OptimizationHints',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) {
    try {
      const v = await (await fetch(base + '/json/version', { signal: AbortSignal.timeout(500) })).json();
      if (v && v.webSocketDebuggerUrl) {
        return { child, profile, wsUrl: v.webSocketDebuggerUrl, base };
      }
    } catch (e) { /* 端口还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  try { child.kill(); } catch (e) {}
  throw new Error('浏览器调试端口未就绪');
}

/* 建立一条 WS 连接，之后可以在上面开任意多个标签页 */
export async function connect(launched) {
  const ws = new WebSocket(launched.wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result);
    }
  };

  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
  });

  async function newTab() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);

    let loaded = false;
    const evWaiters = [];
    const onMsg = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.method === 'Page.loadEventFired' && msg.sessionId === sid) {
        loaded = true;
        while (evWaiters.length) evWaiters.pop()();
      }
    };
    ws.addEventListener('message', onMsg);

    const api = {
      sid, targetId,
      inject: (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }, sid),

      async goto(url) {
        loaded = false;
        await send('Page.navigate', { url }, sid);
        for (let i = 0; i < 150; i++) {
          if (loaded) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 400));
      },

      async evalJs(expr, awaitPromise = false) {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise }, sid);
        if (r.exceptionDetails) {
          const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
          throw new Error('eval 异常: ' + (d || JSON.stringify(r.exceptionDetails)));
        }
        return r.result ? r.result.value : undefined;
      },

      /* 先解析出元素的中心点，并做一次命中校验：
         拿坐标去 elementFromPoint，若命中的不是目标元素（被遮挡 / 布局未稳定），
         说明这个点不可靠，换个位置或等一帧再试，避免「点了个空气却当作点到了」。 */
      async locate(selector) {
        return api.evalJs(`(() => {
          const e = document.querySelector(${JSON.stringify(selector)});
          if (!e) return null;
          e.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) return null;
          const pts = [
            { x: r.left + r.width / 2, y: r.top + r.height / 2 },
            { x: r.left + 4, y: r.top + r.height / 2 },
            { x: r.left + r.width - 4, y: r.top + r.height / 2 }
          ];
          for (const p of pts) {
            const hit = document.elementFromPoint(p.x, p.y);
            if (hit && (hit === e || e.contains(hit) || hit.contains(e))) {
              return { x: p.x, y: p.y, w: r.width, h: r.height };
            }
          }
          const hit0 = document.elementFromPoint(pts[0].x, pts[0].y);
          let chain = [];
          for (let q = hit0; q && chain.length < 4; q = q.parentElement) {
            chain.push(q.tagName + (q.id ? '#' + q.id : '') + '.' + String(q.className || ''));
          }
          return {
            x: pts[0].x, y: pts[0].y, w: r.width, h: r.height, blocked: true,
            blocker: hit0 ? hit0.tagName + (hit0.id ? '#' + hit0.id : '') + '.' + String(hit0.className || '') : 'NONE',
            chain: chain.join(' < ')
          };
        })()`);
      },

      /* 用 CSS 选择器点击；先滚进视口再用 CDP 派发真实鼠标事件。
         命中校验失败（被入场动画的遮罩挡住）时退避重试，
         否则会出现「坐标对但点了个空气」，测试还以为点到了。 */
      async click(selector) {
        let box = null;
        for (let i = 0; i < 6; i++) {
          box = await api.locate(selector);
          if (box && !box.blocked) break;
          if (!box || box.blocked) await new Promise((r) => setTimeout(r, 250));
        }
        if (!box) throw new Error('元素不存在或不可见: ' + selector);
        if (box.blocked) {
          console.log('    [warn] 点击目标被遮挡，强行点击 ' + selector);
        }
        await api.clickAt(box.x, box.y);
        return box;
      },

      async clickText(tag, text) {
        const box = await api.evalJs(`(() => {
          const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
          const e = els.find(x => (x.textContent || '').indexOf(${JSON.stringify(text)}) >= 0);
          if (!e) return null;
          e.scrollIntoView({ block: 'center' });
          const r = e.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
        })()`);
        if (!box || !box.w) throw new Error('未找到含「' + text + '」的 ' + tag);
        return api.clickAt(box.x, box.y);
      },

      async clickAt(x, y) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sid);
        await send('Input.dispatchMouseEvent',
          { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sid);
        await send('Input.dispatchMouseEvent',
          { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sid);
        await new Promise((r) => setTimeout(r, 120));
      },

      async close() {
        ws.removeEventListener('message', onMsg);
        try { await send('Target.closeTarget', { targetId }); } catch (e) {}
      }
    };
    return api;
  }

  return {
    newTab,
    close: async () => { try { ws.close(); } catch (e) {} }
  };
}

export async function shutdown(launched, conn) {
  try { if (conn) await conn.close(); } catch (e) {}
  try { if (launched && launched.child) launched.child.kill(); } catch (e) {}
  try {
    if (launched && launched.profile) fs.rmSync(launched.profile, { recursive: true, force: true });
  } catch (e) {}
}

/* file:// URL：Windows 路径转成正斜杠，查询串会完整保留给 location.search */
export function fileUrl(absPath, query) {
  const p = String(absPath).replace(/\\/g, '/').replace(/^\//, '');
  return 'file:///' + p + (query ? '?' + query : '');
}
