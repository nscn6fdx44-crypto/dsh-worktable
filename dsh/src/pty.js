/**
 * 真 PTY 桥（host 侧）。
 *
 * 为什么要它：0.8.53 之前的终端是「一条命令起一个进程 + 管道」，跑不了 vim / top / ssh /
 * 交互式提示符，Ctrl+C 也进不到前台程序里。真终端要的是伪终端（PTY）。
 *
 * 为什么不装 node-pty 依赖：
 *   node-pty 是原生模块，npm 装上也得现场编译（用户机器多半没有 MSVC）。
 *   DSH 桌面端自己就带了一份（它自己的终端功能要用），ABI 与宿主进程完全一致，
 *   直接借来用最稳。JS 入口在 app.asar 里（Electron 能读 asar），原生 .node 在
 *   app.asar.unpacked 里（Electron 自动落到解包目录）。拿不到就返回 ok:false，
 *   上层退回「命令模式」，功能降级但不报错。
 *
 * 只依赖 node 内置模块 + 可选的 node-pty，不 import 任何宿主服务。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/* 会话里最多留多少字符的历史输出（重新挂上终端时先回放这一段） */
const MAX_BACKLOG = 240 * 1024

let loaded = null

/** 找一份能用的 node-pty；结果缓存，失败也缓存（避免每次开终端都去试一遍） */
export function loadPty() {
  if (loaded) return loaded
  const errors = []
  const res = process.resourcesPath || ''
  const dirs = []
  if (res) {
    dirs.push(join(res, 'app.asar', 'dsh', 'node_modules', 'node-pty'))
    dirs.push(join(res, 'app.asar', 'node_modules', 'node-pty'))
    dirs.push(join(res, 'app.asar.unpacked', 'dsh', 'node_modules', 'node-pty'))
    dirs.push(join(res, 'app.asar.unpacked', 'node_modules', 'node-pty'))
  }
  /* 万一哪天 node-pty 被装进插件自己的 node_modules，这条也能命中 */
  try {
    const mod = createRequire(import.meta.url)('node-pty')
    if (mod && typeof mod.spawn === 'function') {
      loaded = { ok: true, mod, from: 'node-pty（插件依赖）', error: '' }
      return loaded
    }
  } catch (err) {
    errors.push('node-pty: ' + msg(err))
  }
  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) { errors.push(dir + '：不存在'); continue }
      const mod = createRequire(join(dir, 'index.js'))(dir)
      if (mod && typeof mod.spawn === 'function') {
        loaded = { ok: true, mod, from: dir, error: '' }
        return loaded
      }
      errors.push(dir + '：没有 spawn')
    } catch (err) {
      errors.push(dir + '：' + msg(err))
    }
  }
  loaded = { ok: false, mod: null, from: '', error: errors.slice(0, 3).join(' | ') }
  return loaded
}

/** 拿哪个 shell：Windows 优先 powershell（有 pwsh 就用 pwsh），其余用 $SHELL */
export function shellSpec() {
  if (process.platform === 'win32') {
    const pwsh = process.env.PWSH_PATH || ''
    if (pwsh && existsSync(pwsh)) return { file: pwsh, args: ['-NoLogo'] }
    /* 不走 -NoProfile：用户的 profile 里有别名和 PATH，交互终端反而不该屏蔽 */
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] }
}

const sessions = new Map()

function msg(err) {
  return String((err && (err.message || err)) || '未知错误')
}

/** 开一个 PTY 会话（同 id 已存在就先关掉旧的） */
export function openSession(id, opts = {}) {
  const p = loadPty()
  if (!p.ok) return { ok: false, error: '这个环境里找不到可用的 node-pty：' + p.error }
  /* 同一个 id 已经活着就复用：切标签页回来接上原来那个 shell，不要重开 */
  const alive = getSession(id)
  if (alive) return { ok: true, session: alive, shell: alive.shellFile || '', cwd: alive.cwd, reused: true }
  closeSession(id)

  const cols = clamp(opts.cols, 20, 400, 100)
  const rows = clamp(opts.rows, 6, 200, 30)
  const cwd = pickCwd(opts.cwd)
  const shell = shellSpec()
  let pty
  try {
    pty = p.mod.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', WT_SESSION: String(id) },
      /* conpty 在部分 Windows 版本上会丢输出，node-pty 提供这个开关 */
      useConpty: process.platform === 'win32' ? true : undefined,
    })
  } catch (err) {
    return { ok: false, error: 'PTY 启动失败：' + msg(err) }
  }

  const session = {
    id, pty, cwd, cols, rows, shellFile: shell.file,
    backlog: '',
    listeners: new Set(),
    exited: false,
    code: null,
    at: Date.now(),
  }
  pty.onData((d) => {
    session.backlog += d
    if (session.backlog.length > MAX_BACKLOG) {
      session.backlog = session.backlog.slice(-MAX_BACKLOG)
    }
    for (const fn of session.listeners) {
      try { fn(d) } catch { /* 单个订阅者出错不影响别人 */ }
    }
  })
  pty.onExit((e) => {
    session.exited = true
    session.code = e && typeof e.exitCode === 'number' ? e.exitCode : 0
    for (const fn of session.listeners) {
      try { fn(null) } catch { /* ignore */ }
    }
    session.listeners.clear()
    /* 留 10 分钟给「切回来还能看到结果」，之后清掉 */
    setTimeout(() => { if (sessions.get(id) === session) sessions.delete(id) }, 10 * 60 * 1000).unref?.()
  })
  sessions.set(id, session)
  return { ok: true, session, shell: shell.file, cwd }
}

export function getSession(id) {
  const s = sessions.get(String(id || ''))
  if (!s || s.exited) return null
  return s
}

/** 只读一眼（含已退出的），给诊断接口用 */
export function peekSession(id) {
  return sessions.get(String(id || '')) || null
}

export function closeSession(id) {
  const s = sessions.get(String(id || ''))
  if (!s) return false
  try { s.pty.kill() } catch { /* 已经没了 */ }
  sessions.delete(String(id))
  return true
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id, cwd: s.cwd, cols: s.cols, rows: s.rows, exited: s.exited, code: s.code, at: s.at,
  }))
}

function clamp(n, min, max, dflt) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return dflt
  return Math.max(min, Math.min(max, v))
}

function pickCwd(p) {
  const cand = String(p || '')
  try {
    if (cand && existsSync(cand)) return cand
  } catch { /* 权限不够就当没有 */ }
  return homedir()
}
