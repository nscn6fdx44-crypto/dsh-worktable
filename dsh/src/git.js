/**
 * git / GitHub 能力（host 侧）
 *
 * 设计取舍
 *   1. **凭证不进 argv**：令牌只走环境变量 WT_GH_TOKEN，git 通过临时 credential.helper
 *      从环境里读。命令行里看不到 token，`ps` / 进程表也看不到。
 *   2. **不写用户的全局 git 配置**：helper 只作用于本次 execFile（`-c` 传参），
 *      不碰 `~/.gitconfig`。想让它对终端也生效，得用户在界面上明确勾选，
 *      走 `git credential approve` 写进系统凭据管理器。
 *   3. **失败不抛异常**：git 的「不是仓库 / 没有 upstream / 有冲突」都是正常状态，
 *      统一返回 `{ ok, error, detail }`，由路由层决定 HTTP 状态。
 *   4. 只跑白名单里的子命令（见 OPS），不接受客户端拼命令行；文件路径一律走 `--` 之后。
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_TIMEOUT = 15_000
const NET_TIMEOUT = 120_000
const MAX_DIFF_LINES = 4000
const MAX_DIFF_BYTES = 512 * 1024

/* ============================ 基础 ============================ */

function ghHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 令牌存放位置：跟自定义窗口库同目录，不写进用户项目 */
export function tokenFile() {
  return join(ghHome(), 'worktable-github.json')
}

/**
 * 临时凭证注入。
 * `credential.helper=` 先把系统里已有的 helper 清空（否则 Git Credential Manager 会弹窗），
 * 再接一个 shell 函数，从环境变量读令牌 —— 明文令牌永远不出现在 argv 里。
 */
const AUTH_ARGS = [
  '-c', 'credential.helper=',
  '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$WT_GH_TOKEN"; }; f',
]

/**
 * 跑 git。
 * @param {string} cwd 工作目录
 * @param {string[]} args 子命令与参数
 * @param {{token?:string, timeout?:number, input?:string}} opts
 */
export function runGit(cwd, args, opts = {}) {
  const token = typeof opts.token === 'string' ? opts.token : ''
  const timeout = Number(opts.timeout) > 0 ? Number(opts.timeout) : DEFAULT_TIMEOUT
  const full = (token ? AUTH_ARGS : []).concat(args)
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
  }
  if (token) env.WT_GH_TOKEN = token
  const attempt = (argv) => new Promise((done) => {
    const child = execFile('git', argv, {
      cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env,
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
      done({
        ok: !err,
        code,
        out: String(stdout || ''),
        err: String(stderr || '').trim(),
        error: err ? String(stderr || '').trim() || String(err.message || err) : '',
        killed: !!err?.killed,
      })
    })
    if (opts.input && child.stdin) {
      child.stdin.end(String(opts.input))
    }
  })
  return (async () => {
    /* Windows 上 schannel 的吊销检查常连不上（内网 / 代理），整条命令会直接失败。
       退让顺序：先只关吊销检查（不降级加密），用户显式允许时才关证书校验。
       非证书类错误（连不上、401、冲突）不重试。 */
    let out = await attempt(full)
    if (out.ok || !isTlsError(out.err)) return out
    const steps = [['-c', 'http.schannelCheckRevoke=false']]
    if (opts.insecure) steps.push(['-c', 'http.sslVerify=false'])
    for (const fix of steps) {
      out = await attempt(fix.concat(full))
      if (out.ok) return out
    }
    return out
  })()
}

/** schannel / OpenSSL 的证书校验失败（不是仓库不存在或冲突） */
function isTlsError(text) {
  return /CRYPT_E_NO_REVOCATION_CHECK|schannel:|SSL certificate problem|unable to get local issuer|certificate verify failed/i.test(String(text || ''))
}

/** 一次跑多条，按顺序；任一条失败就带着它的错误返回 */
async function chain(cwd, list, opts) {
  for (const args of list) {
    const r = await runGit(cwd, args, opts)
    if (!r.ok) return r
  }
  return { ok: true, code: 0, out: '', err: '', error: '' }
}

export async function isRepo(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.ok && r.out.includes('true')
}

/** 仓库根目录（子目录里也能定位到根） */
export async function repoRoot(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  return r.ok ? r.out.trim() : ''
}

/* ============================ 读取 ============================ */

export async function gitStatus(cwd) {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || !inside.out.includes('true')) {
    return {
      ok: true, repo: false, branch: '', changes: [], counts: null,
      error: inside.err || '不是 git 仓库', ahead: 0, behind: 0, upstream: '', remote: '', detached: false,
    }
  }
  const [branch, porcelain, upstream, remote, head, symref] = await Promise.all([
    runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    runGit(cwd, ['remote', 'get-url', 'origin']),
    runGit(cwd, ['rev-parse', '--short', 'HEAD']),
    /* 还没有第一次提交时 rev-parse --abbrev-ref 会给 "HEAD"，分支名要从 symbolic-ref 拿 */
    runGit(cwd, ['symbolic-ref', '--short', 'HEAD']),
  ])
  const changes = parsePorcelain(porcelain.out)
  const staged = changes.filter((c) => c.code[0] !== ' ' && c.code[0] !== '?').length
  const unstaged = changes.filter((c) => c.code[1] !== ' ' && c.code[0] !== '?').length
  const untracked = changes.filter((c) => c.code === '??').length
  const conflicts = changes.filter((c) => c.code[0] === 'U' || c.code[1] === 'U' || c.code === 'AA' || c.code === 'DD').length

  let ahead = 0
  let behind = 0
  const up = upstream.ok ? upstream.out.trim() : ''
  if (up) {
    const lr = await runGit(cwd, ['rev-list', '--left-right', '--count', up + '...HEAD'])
    if (lr.ok) {
      const [b, a] = lr.out.trim().split(/\s+/)
      behind = Number(b) || 0
      ahead = Number(a) || 0
    }
  }
  const br = branch.out.trim()
  const sym = symref.ok ? symref.out.trim() : ''
  const name = (br && br !== 'HEAD') ? br : (sym || br)
  return {
    ok: true,
    repo: true,
    branch: name || '(detached)',
    detached: !name || name === 'HEAD',
    head: head.ok ? head.out.trim() : '',
    unborn: !head.ok,
    ahead,
    behind,
    upstream: up,
    remote: remote.ok ? remote.out.trim() : '',
    changes,
    counts: { staged, unstaged, untracked, conflicts, total: changes.length },
    at: Date.now(),
  }
}

/** 解析 `status --porcelain=v1 -z`：重命名是「新路径\0旧路径」 */
export function parsePorcelain(raw) {
  const changes = []
  const parts = String(raw || '').split('\0')
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i]
    if (!row || row.length < 3) continue
    const code = row.slice(0, 2)
    const file = row.slice(3)
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i + 1] || ''
      i += 1
      changes.push({ code, file, from })
    } else {
      changes.push({ code, file })
    }
  }
  return changes
}

export async function gitLog(cwd, limit = 20, ref = '') {
  const args = ['log', '-n', String(limit), '--date=short', '--pretty=format:%h%x1f%ad%x1f%s%x1f%an%x1f%p']
  if (ref) args.push(ref)
  const res = await runGit(cwd, args)
  if (!res.ok) return { ok: false, commits: [], error: res.err || '读取提交历史失败' }
  const commits = res.out.split('\n').filter(Boolean).map((line) => {
    const [hash, date, subject, author, parents] = line.split('\x1f')
    return { hash, date, subject, author, parents: String(parents || '').split(' ').filter(Boolean).length }
  })
  return { ok: true, commits }
}

export async function gitBranches(cwd) {
  const [local, remote] = await Promise.all([
    runGit(cwd, ['for-each-ref', '--format=%(refname:short)%1f%(objectname:short)%1f%(HEAD)', 'refs/heads']),
    runGit(cwd, ['for-each-ref', '--format=%(refname:short)%1f%(objectname:short)', 'refs/remotes']),
  ])
  const list = local.ok
    ? local.out.split('\n').filter(Boolean).map((line) => {
      const [name, hash, head] = line.split('\x1f')
      return { name, hash, current: head === '*' }
    })
    : []
  const remoteList = remote.ok
    ? remote.out.split('\n').filter(Boolean).map((line) => {
      const [name, hash] = line.split('\x1f')
      return { name, hash }
    }).filter((b) => !b.name.endsWith('/HEAD'))
    : []
  return { ok: local.ok || remote.ok, branches: list, remotes: remoteList, error: local.ok ? '' : local.err }
}

export async function gitTags(cwd) {
  const res = await runGit(cwd, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%1f%(objectname:short)%1f%(creatordate:short)', 'refs/tags'])
  if (!res.ok) return { ok: false, tags: [], error: res.err }
  const tags = res.out.split('\n').filter(Boolean).map((line) => {
    const [name, hash, date] = line.split('\x1f')
    return { name, hash, date }
  })
  return { ok: true, tags }
}

/** 工作区改动预览。未跟踪文件 git 没有基线，直接把全文按「新增行」摆出来 */
export async function gitDiff(cwd, { file = '', staged = false, commit = '' } = {}) {
  if (commit) {
    const res = await runGit(cwd, ['show', '--no-color', '--stat', '--patch', '--format=medium', commit])
    return shape({ ok: res.ok, diff: res.out, error: res.err })
  }
  if (!file) {
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    const res = await runGit(cwd, args)
    return shape({ ok: res.ok, diff: res.out, error: res.err })
  }
  const status = await gitStatus(cwd)
  const item = (status.changes || []).find((c) => c.file === file)
  if (item && item.code === '??') {
    const abs = resolve(cwd, file)
    try {
      const st = statSync(abs)
      if (!st.isFile()) return { ok: true, diff: '', untracked: true, binary: false, note: '目录，不做预览' }
      if (st.size > MAX_DIFF_BYTES) return { ok: true, diff: '', untracked: true, note: '文件过大，不做预览' }
      const text = readFileSync(abs, 'utf8')
      if (text.includes('\0')) return { ok: true, diff: '', untracked: true, binary: true }
      const lines = text.split('\n').slice(0, MAX_DIFF_LINES)
      const body = lines.map((l) => '+' + l).join('\n')
      return { ok: true, diff: '--- /dev/null\n+++ b/' + file + '\n' + body, untracked: true, binary: false }
    } catch (err) {
      return { ok: false, diff: '', error: '读不到这个文件：' + String(err?.message ?? err) }
    }
  }
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', file)
  const res = await runGit(cwd, args)
  return shape({ ok: res.ok, diff: res.out, error: res.err })
}

function shape({ ok, diff, error }) {
  const text = String(diff || '')
  const binary = /^Binary files |^GIT binary patch/m.test(text)
  const lines = text.split('\n')
  const truncated = lines.length > MAX_DIFF_LINES
  return {
    ok,
    diff: truncated ? lines.slice(0, MAX_DIFF_LINES).join('\n') : text,
    truncated,
    binary,
    error: error || '',
  }
}

export async function gitRemotes(cwd) {
  const res = await runGit(cwd, ['remote', '-v'])
  if (!res.ok) return { ok: false, remotes: [], error: res.err }
  const map = new Map()
  for (const line of res.out.split('\n').filter(Boolean)) {
    const [name, url, kind] = line.split(/\s+/)
    if (!name || !url) continue
    const row = map.get(name) || { name, url: '', push: '' }
    if (kind === '(push)') row.push = url
    else row.url = url
    map.set(name, row)
  }
  return { ok: true, remotes: [...map.values()] }
}

/* ============================ 写操作 ============================ */

const MAX_FILES = 2000

function safeFiles(files) {
  const list = Array.isArray(files) ? files : []
  return list
    .map((f) => String(f || ''))
    .filter((f) => f && f.length < 1024 && !f.includes('\0'))
    .slice(0, MAX_FILES)
}

export async function gitStage(cwd, files) {
  const list = safeFiles(files)
  const args = list.length ? ['add', '--'].concat(list) : ['add', '-A']
  const res = await runGit(cwd, args)
  return { ok: res.ok, error: res.err || '' }
}

export async function gitUnstage(cwd, files) {
  const list = safeFiles(files)
  const args = list.length ? ['restore', '--staged', '--'].concat(list) : ['restore', '--staged', '--', '.']
  const res = await runGit(cwd, args)
  if (res.ok) return { ok: true }
  /* git < 2.23 没有 restore：退回 reset */
  const legacy = await runGit(cwd, ['reset', 'HEAD', '--'].concat(list.length ? list : ['.']))
  return { ok: legacy.ok, error: legacy.ok ? '' : (res.err || legacy.err) }
}

/** 丢弃改动：已跟踪的 restore，未跟踪的 clean（都走 `--` 白名单，不碰别的东西） */
export async function gitDiscard(cwd, files) {
  const list = safeFiles(files)
  if (!list.length) return { ok: false, error: '没有指定文件' }
  const status = await gitStatus(cwd)
  const untracked = new Set((status.changes || []).filter((c) => c.code === '??').map((c) => c.file))
  const tracked = list.filter((f) => !untracked.has(f))
  const fresh = list.filter((f) => untracked.has(f))
  const steps = []
  if (tracked.length) steps.push(['restore', '--worktree', '--'].concat(tracked))
  if (fresh.length) steps.push(['clean', '-f', '--'].concat(fresh))
  const res = await chain(cwd, steps)
  return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitCommit(cwd, { message = '', all = false, amend = false } = {}) {
  const msg = String(message || '').trim()
  if (!msg && !amend) return { ok: false, error: '提交说明不能为空' }
  const args = ['commit']
  if (amend) args.push('--amend')
  if (msg) args.push('-m', msg)
  else args.push('--no-edit')
  if (all) args.push('-a')
  const res = await runGit(cwd, args, { timeout: 60_000 })
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitFetch(cwd, { token = '', remote = '', prune = false, insecure = false } = {}) {
  const args = ['fetch', '--all']
  if (prune) args.push('--prune')
  if (remote) args.push(remote)
  const res = await runGit(cwd, args, { token, timeout: NET_TIMEOUT, insecure })
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitPull(cwd, { token = '', remote = '', branch = '', rebase = false, insecure = false } = {}) {
  const args = ['pull']
  if (rebase) args.push('--rebase')
  if (remote) args.push(remote, branch || '')
  const res = await runGit(cwd, args.filter(Boolean), { token, timeout: NET_TIMEOUT, insecure })
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitPush(cwd, { token = '', remote = 'origin', branch = '', force = false, tags = false, insecure = false } = {}) {
  const args = ['push']
  if (force) args.push('--force-with-lease')
  if (tags) args.push('--tags')
  args.push(remote)
  if (branch) args.push(branch)
  /* 没有 upstream 的第一次推送：顺手建上游，否则用户得自己再配一次 */
  const up = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!up.ok) args.splice(1, 0, '-u')
  const res = await runGit(cwd, args, { token, timeout: NET_TIMEOUT, insecure })
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitCheckout(cwd, { target = '', create = false, startPoint = '' } = {}) {
  const name = String(target || '').trim()
  if (!name) return { ok: false, error: '请指定分支或提交' }
  const args = ['checkout']
  if (create) {
    args.push('-b', name)
    if (startPoint) args.push(String(startPoint))
  } else if (/^origin\//.test(name)) {
    /* 远程分支：本地建同名跟踪分支，别落到 detached HEAD */
    const local = name.replace(/^[^/]+\//, '')
    args.push('--track', '-b', local, name)
  } else {
    args.push(name)
  }
  const res = await runGit(cwd, args, { timeout: 60_000 })
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitBranchOp(cwd, { action = 'list', name = '', force = false, renameTo = '' } = {}) {
  const branch = String(name || '').trim()
  if (action === 'list') return gitBranches(cwd)
  if (!branch) return { ok: false, error: '请指定分支名' }
  if (!/^[\w./@\-]{1,200}$/.test(branch)) return { ok: false, error: '分支名不合法' }
  if (action === 'delete') {
    const res = await runGit(cwd, ['branch', force ? '-D' : '-d', branch])
    return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
  }
  if (action === 'rename') {
    if (!renameTo) return { ok: false, error: '请填写新分支名' }
    const res = await runGit(cwd, ['branch', '-m', branch, String(renameTo)])
    return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
  }
  return { ok: false, error: '未知操作：' + action }
}

export async function gitTagOp(cwd, { action = 'create', name = '', message = '', target = '' } = {}) {
  const tag = String(name || '').trim()
  if (!tag) return { ok: false, error: '请填写标签名' }
  if (!/^[\w./@\-]{1,200}$/.test(tag)) return { ok: false, error: '标签名不合法' }
  if (action === 'delete') {
    const res = await runGit(cwd, ['tag', '-d', tag])
    return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
  }
  const msg = String(message || '').trim()
  const args = msg ? ['tag', '-a', tag, '-m', msg] : ['tag', tag]
  if (target) args.push(String(target))
  const res = await runGit(cwd, args)
  return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
}

/** 回退：hard 会丢工作区改动，UI 必须二次确认 */
export async function gitReset(cwd, { commit = 'HEAD', mode = 'soft' } = {}) {
  const m = ['soft', 'mixed', 'hard'].includes(mode) ? mode : 'soft'
  const hash = String(commit || 'HEAD').trim()
  if (!/^[\w.~^/]{1,120}$/.test(hash)) return { ok: false, error: '提交引用不合法' }
  const res = await runGit(cwd, ['reset', '--' + m, hash])
  return { ok: res.ok, out: res.out, error: res.ok ? '' : (res.err || res.error) }
}

export async function gitInit(cwd, { branch = 'main' } = {}) {
  if (await isRepo(cwd)) return { ok: true, existed: true }
  const res = await runGit(cwd, ['init', '-b', branch])
  /* 老版本 git 没有 -b */
  if (!res.ok) {
    const legacy = await runGit(cwd, ['init'])
    return { ok: legacy.ok, existed: false, error: legacy.ok ? '' : (legacy.err || legacy.error) }
  }
  return { ok: true, existed: false }
}

export async function gitSetRemote(cwd, { name = 'origin', url = '' } = {}) {
  const target = String(url || '').trim()
  if (!target) return { ok: false, error: '请填写仓库地址' }
  const has = await runGit(cwd, ['remote'])
  const names = has.ok ? has.out.split('\n').map((s) => s.trim()).filter(Boolean) : []
  const args = names.includes(name) ? ['remote', 'set-url', name, target] : ['remote', 'add', name, target]
  const res = await runGit(cwd, args)
  return { ok: res.ok, error: res.ok ? '' : (res.err || res.error) }
}

/* ============================ 克隆 ============================ */

const CLONE_PROGRESS = /(Cloning into|remote:|Receiving objects|Resolving deltas|Updating files|Checking out|Submodule)/i

/** 校验仓库地址：https / ssh / 本地路径，挡掉 `--upload-pack` 之类的参数注入 */
export function normalizeCloneUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return { ok: false, error: '请填写仓库地址' }
  if (url.startsWith('-')) return { ok: false, error: '地址不合法' }
  if (/^https?:\/\/[^\s]+$/i.test(url)) return { ok: true, url }
  if (/^git@[\w.-]+:[^\s]+$/i.test(url)) return { ok: true, url }
  if (/^ssh:\/\/[^\s]+$/i.test(url)) return { ok: true, url }
  /* 本地路径要先判，否则 `./x` 会被当成 owner/repo */
  if (process.platform === 'win32' && /^[a-zA-Z]:[\\/]/.test(url)) return { ok: true, url }
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('.\\') || url.startsWith('..\\')) {
    return { ok: true, url }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    /* 只写 `owner/repo` 时补成 GitHub 全地址，省得用户手打协议 */
    return { ok: true, url: 'https://github.com/' + url + '.git' }
  }
  return { ok: false, error: '认不出这个地址，请用 https://… 或 git@… 或 owner/repo' }
}

/**
 * 克隆（流式进度）。
 * @param {{url:string, dest:string, token?:string, depth?:number, branch?:string}} opts
 * @param {(event:{t:string, line?:string, ok?:boolean, error?:string, path?:string})=>void} onEvent
 */
export function cloneRepo(opts, onEvent) {
  const check = normalizeCloneUrl(opts?.url)
  if (!check.ok) {
    onEvent({ t: 'end', ok: false, error: check.error })
    return
  }
  const dest = String(opts?.dest || '').trim()
  if (!dest) {
    onEvent({ t: 'end', ok: false, error: '请选择克隆到哪个目录' })
    return
  }
  const args = ['clone', '--progress']
  if (Number(opts?.depth) > 0) args.push('--depth', String(Number(opts.depth)))
  if (opts?.branch) args.push('--branch', String(opts.branch))
  args.push('--', check.url, dest)
  const token = typeof opts?.token === 'string' ? opts.token : ''
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
  if (token) env.WT_GH_TOKEN = token
  const spawnOnce = (argv, onFail) => {
    const child = execFile('git', argv, {
      timeout: 10 * 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env,
    }, (err, stdout, stderr) => {
      const tail = String(stderr || stdout || '').split('\n').filter(Boolean).slice(-3).join('\n')
      if (err) {
        onFail(tail || String(err.message || err))
        return
      }
      onEvent({ t: 'end', ok: true, path: dest })
    })
    let buffer = ''
    const push = (chunk, isErr) => {
      buffer += chunk
      let at
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at).replace(/\r$/, '').trim()
        buffer = buffer.slice(at + 1)
        if (!line) continue
        if (CLONE_PROGRESS.test(line) || isErr) onEvent({ t: 'out', line: line.slice(0, 300) })
      }
      if (buffer.length > 4096) buffer = ''
    }
    child.stdout?.on('data', (d) => push(String(d), false))
    /* 进度走 stderr，这是 git 的常规行为 */
    child.stderr?.on('data', (d) => push(String(d), true))
    child.on('error', (err) => onEvent({ t: 'end', ok: false, error: String(err?.message ?? err) }))
  }

  const base = token ? AUTH_ARGS : []
  const steps = [[], ['-c', 'http.schannelCheckRevoke=false']]
  if (opts?.insecure) steps.push(['-c', 'http.sslVerify=false'])
  const next = (i, lastError) => {
    if (i >= steps.length) {
      onEvent({ t: 'end', ok: false, error: lastError })
      return
    }
    if (i > 0) onEvent({ t: 'out', line: '证书校验重试（' + steps[i].join(' ') + '）…' })
    spawnOnce(steps[i].concat(base, args), (error) => {
      if (!isTlsError(error)) {
        onEvent({ t: 'end', ok: false, error })
        return
      }
      /* 已经试过「关吊销检查」还不行时，提示可以打开「跳过证书校验」 */
      const hint = (i === 1 && !opts?.insecure)
        ? '\n提示：这是本机 git 的证书吊销检查连不上。可以在克隆窗口勾选「跳过证书校验」再试。'
        : ''
      next(i + 1, error + hint)
    })
  }
  next(0, '')
}

/* ============================ GitHub 账号 ============================ */

const API = 'https://api.github.com'
const UA = 'trae-usage-worktable'
let statusCache = { at: 0, value: null }

function readStore() {
  try {
    const raw = readFileSync(tokenFile(), 'utf8')
    const obj = JSON.parse(raw)
    if (obj && typeof obj.token === 'string' && obj.token) return obj
  } catch { /* 没登录过 */ }
  return null
}

function writeStore(obj) {
  const file = tokenFile()
  writeFileSync(file, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* Windows 上没意义 */ }
}

export function clearStore() {
  try {
    if (existsSync(tokenFile())) writeStore({ token: '' })
  } catch { /* 忽略 */ }
  statusCache = { at: 0, value: null }
}

/** gh CLI 的令牌（装了并登录过就有） */
function ghCliToken() {
  return new Promise((done) => {
    execFile('gh', ['auth', 'token'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      const tok = String(stdout || '').trim()
      done(!err && /^[\w-]{20,}$/.test(tok) ? tok : '')
    })
  })
}

/**
 * 系统 git 里已存的 GitHub 凭据（Git Credential Manager / helper）。
 * 这一步能让「本来就在命令行登录过」的用户免登录。
 */
function credentialToken() {
  return new Promise((done) => {
    let p
    try {
      p = execFile('git', ['credential', 'fill'], {
        timeout: 8000, windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
      }, (err, stdout) => {
        const text = String(stdout || '')
        const m = /password=(.+)/.exec(text)
        const tok = m ? m[1].trim() : ''
        done(!err && tok ? tok : '')
      })
    } catch { done(''); return }
    try {
      p.stdin.write('protocol=https\nhost=github.com\n\n')
      p.stdin.end()
    } catch { done('') }
  })
}

/**
 * 找出可用的令牌，按「界面登录的 → 环境变量 → gh CLI → 系统凭据」顺序。
 * @returns {Promise<{token:string, source:string}>}
 */
export async function resolveToken() {
  const stored = readStore()
  if (stored?.token) return { token: stored.token, source: 'stored' }
  for (const key of ['WT_GH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const v = String(process.env[key] || '').trim()
    if (v) return { token: v, source: 'env:' + key }
  }
  const cli = await ghCliToken()
  if (cli) return { token: cli, source: 'gh-cli' }
  const cred = await credentialToken()
  if (cred) return { token: cred, source: 'git-credential' }
  return { token: '', source: '' }
}

async function ghApi(path, { token, method = 'GET', body, timeout = 20_000 } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0
  try {
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/vnd.github+json',
        'user-agent': UA,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    })
    const scopes = res.headers.get('x-oauth-scopes') || ''
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data, scopes }
  } catch (err) {
    const name = String(err?.name || '')
    return {
      ok: false, status: 0, data: null, scopes: '',
      error: name === 'AbortError' ? '请求 GitHub 超时' : String(err?.message ?? err),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 账号状态。不返回令牌本身 —— 前端只需要知道「是谁、从哪来的」。
 * @param {{fresh?:boolean}} opts
 */
export async function ghStatus(opts = {}) {
  if (!opts.fresh && statusCache.value && Date.now() - statusCache.at < 15_000) return statusCache.value
  const { token, source } = await resolveToken()
  if (!token) {
    const value = { loggedIn: false, source: '', login: '', name: '', avatar: '', scopes: '', profile: '', hint: '' }
    statusCache = { at: Date.now(), value }
    return value
  }
  const res = await ghApi('/user', { token })
  if (!res.ok) {
    const value = {
      loggedIn: false, source, login: '', name: '', avatar: '', scopes: '',
      error: res.status === 401 ? '令牌无效或已过期' : (res.error || 'GitHub 返回 ' + res.status),
    }
    statusCache = { at: Date.now(), value }
    return value
  }
  const value = {
    loggedIn: true,
    source,
    login: String(res.data?.login || ''),
    name: String(res.data?.name || res.data?.login || ''),
    avatar: String(res.data?.avatar_url || ''),
    scopes: res.scopes,
    profile: String(res.data?.html_url || ''),
    repoScope: !res.scopes || /(^|,)\s*repo\s*(,|$)/.test(res.scopes) || /(^|,)\s*public_repo\s*(,|$)/.test(res.scopes),
    error: '',
  }
  statusCache = { at: Date.now(), value }
  return value
}

/** 登录：校验令牌 → 存盘（0600）。remember=false 时只放在内存里 */
export async function ghLogin(tokenRaw, { remember = true, writeCredential = false, token = '' } = {}) {
  const tok = String(tokenRaw || token || '').trim()
  if (!/^[\w-]{20,}$/.test(tok)) return { ok: false, error: '令牌格式不对：应以 ghp_ / github_pat_ / gho_ 开头' }
  const res = await ghApi('/user', { token: tok })
  if (!res.ok) {
    return { ok: false, error: res.status === 401 ? '令牌无效或已过期（GitHub 返回 401）' : (res.error || 'GitHub 返回 ' + res.status) }
  }
  const scopes = res.scopes || ''
  const login = String(res.data?.login || '')
  if (remember) {
    writeStore({
      token: tok,
      login,
      scopes,
      at: Date.now(),
      user: { login, name: res.data?.name || '', avatar: res.data?.avatar_url || '' },
    })
  }
  if (writeCredential) await approveCredential(tok)
  statusCache = { at: 0, value: null }
  return {
    ok: true, login, scopes,
    name: String(res.data?.name || login),
    avatar: String(res.data?.avatar_url || ''),
    wallet: writeCredential,
    repoScope: !scopes || /(^|,)\s*repo\s*(,|$)/.test(scopes) || /(^|,)\s*public_repo\s*(,|$)/.test(scopes),
  }
}

/** 把令牌交给系统凭据管理器（可选）：供内置终端里的 git 也能免密 */
function approveCredential(tok) {
  return new Promise((done) => {
    let p
    try {
      p = execFile('git', ['credential', 'approve'], { timeout: 8000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        () => done(true))
    } catch { done(false); return }
    try {
      p.stdin.write('protocol=https\nhost=github.com\nusername=x-access-token\npassword=' + tok + '\n\n')
      p.stdin.end()
    } catch { done(false) }
  })
}

export async function ghRepos({ q = '', page = 1, perPage = 60 } = {}) {
  const status = await ghStatus()
  if (!status.loggedIn) return { ok: false, error: status.error || '还没登录 GitHub', repos: [] }
  const { token } = await resolveToken()
  const path = '/user/repos?sort=updated&per_page=' + Math.min(100, Math.max(1, Number(perPage) || 60)) + '&page=' + Math.max(1, Number(page) || 1)
  const res = await ghApi(path, { token })
  if (!res.ok) {
    return { ok: false, error: res.status === 403 ? '令牌权限不足（需要 repo 或 public_repo）' : (res.error || '读取仓库列表失败'), repos: [] }
  }
  const all = Array.isArray(res.data) ? res.data : []
  const key = String(q || '').trim().toLowerCase()
  const repos = all
    .filter((r) => !key || String(r.full_name || '').toLowerCase().includes(key))
    .map((r) => ({
      name: String(r.name || ''),
      fullName: String(r.full_name || ''),
      private: !!r.private,
      description: String(r.description || ''),
      cloneUrl: String(r.clone_url || ''),
      sshUrl: String(r.ssh_url || ''),
      branch: String(r.default_branch || ''),
      updatedAt: String(r.updated_at || ''),
      size: Number(r.size) || 0,
      owner: String(r.owner?.login || ''),
    }))
  return { ok: true, repos, hasMore: all.length >= Number(perPage || 60) }
}

export async function ghCreateRepo({ name = '', private: isPrivate = true, description = '', org = '' } = {}) {
  const status = await ghStatus()
  if (!status.loggedIn) return { ok: false, error: status.error || '还没登录 GitHub' }
  const repo = String(name || '').trim().replace(/[^\w.-]/g, '-').replace(/^-+|-+$/g, '')
  if (!repo) return { ok: false, error: '请填写仓库名（只能字母数字 . _ -）' }
  const { token } = await resolveToken()
  const path = org ? '/orgs/' + encodeURIComponent(org) + '/repos' : '/user/repos'
  const res = await ghApi(path, {
    token, method: 'POST',
    body: { name: repo, private: !!isPrivate, description: String(description || ''), auto_init: false },
  })
  if (!res.ok) {
    const msg = res.data?.errors?.[0]?.message || res.data?.message || res.error || ('GitHub 返回 ' + res.status)
    return { ok: false, error: res.status === 422 ? '仓库已存在或名字不合法：' + msg : msg }
  }
  return {
    ok: true,
    name: String(res.data?.name || repo),
    fullName: String(res.data?.full_name || ''),
    cloneUrl: String(res.data?.clone_url || ''),
    sshUrl: String(res.data?.ssh_url || ''),
    htmlUrl: String(res.data?.html_url || ''),
    private: !!res.data?.private,
    owner: String(res.data?.owner?.login || ''),
  }
}

/**
 * 上传本地仓库：没有仓库就 init、没有提交就提交一次、没有 origin 就建远程仓库，然后 push。
 * @param {{path:string, name:string, private?:boolean, description?:string, branch?:string, commitMessage?:string}} opts
 */
export async function ghUpload(opts) {
  const cwd = String(opts?.path || '')
  if (!cwd) return { ok: false, error: '缺少项目目录' }
  const status = await ghStatus()
  if (!status.loggedIn) return { ok: false, error: status.error || '还没登录 GitHub' }
  const { token } = await resolveToken()
  const steps = []

  const init = await gitInit(cwd, { branch: String(opts?.branch || 'main') })
  if (!init.ok) return { ok: false, error: '初始化仓库失败：' + init.error, steps }
  steps.push(init.existed ? '已存在仓库' : '新建仓库')

  const head = await runGit(cwd, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) {
    await gitStage(cwd, [])
    const msg = String(opts?.commitMessage || '初始提交').trim() || '初始提交'
    const commit = await gitCommit(cwd, { message: msg })
    if (!commit.ok) return { ok: false, error: '首次提交失败：' + commit.error, steps }
    steps.push('已提交初始版本')
  }

  let branch = String(opts?.branch || '').trim()
  if (!branch) {
    const br = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    branch = br.ok ? br.out.trim() : 'main'
  }

  let remoteUrl = ''
  let repoInfo = null
  const url = await runGit(cwd, ['remote', 'get-url', 'origin'])
  if (url.ok && url.out.trim()) {
    remoteUrl = url.out.trim()
    steps.push('沿用已有 origin')
  } else {
    repoInfo = await ghCreateRepo({
      name: opts?.name || '',
      private: opts?.private !== false,
      description: opts?.description || '',
    })
    if (!repoInfo.ok) return { ok: false, error: '创建远程仓库失败：' + repoInfo.error, steps }
    remoteUrl = repoInfo.cloneUrl
    const set = await gitSetRemote(cwd, { name: 'origin', url: remoteUrl })
    if (!set.ok) return { ok: false, error: '设置 origin 失败：' + set.error, steps }
    steps.push('已建远程仓库 ' + repoInfo.fullName)
  }

  const push = await gitPush(cwd, { token, remote: 'origin', branch, insecure: !!opts?.insecure })
  if (!push.ok) return { ok: false, error: '推送失败：' + push.error, steps, remote: remoteUrl }
  steps.push('已推送 ' + branch)
  return { ok: true, steps, remote: remoteUrl, branch, repo: repoInfo }
}

/* ============================ 汇总入口 ============================ */

/**
 * `POST /git` 的唯一分发点。客户端只传 op，不拼命令行。
 * @param {string} cwd 已通过沙箱校验的目录
 * @param {Record<string,any>} body
 */
export async function gitDispatch(cwd, body) {
  const op = String(body?.op || 'status')
  const tokenInfo = op === 'fetch' || op === 'pull' || op === 'push' ? await resolveToken() : { token: '' }
  switch (op) {
    case 'status': {
      const st = await gitStatus(cwd)
      /* 顺便把远程地址和提交历史带上，少一次往返 */
      if (!st.repo) return st
      const [log, branches, tags, remotes] = await Promise.all([
        gitLog(cwd, 20),
        gitBranches(cwd),
        gitTags(cwd),
        gitRemotes(cwd),
      ])
      return {
        ...st,
        log: log.commits || [],
        branches: branches.branches || [],
        remoteBranches: branches.remotes || [],
        tags: tags.tags || [],
        remotes: remotes.remotes || [],
      }
    }
    case 'log': return gitLog(cwd, Number(body?.limit) || 20, String(body?.ref || ''))
    case 'branches': return gitBranches(cwd)
    case 'tags': return gitTags(cwd)
    case 'remotes': return gitRemotes(cwd)
    case 'diff': return gitDiff(cwd, {
      file: String(body?.file || ''),
      staged: !!body?.staged,
      commit: String(body?.commit || ''),
    })
    case 'stage': return gitStage(cwd, body?.files)
    case 'unstage': return gitUnstage(cwd, body?.files)
    case 'discard': return gitDiscard(cwd, body?.files)
    case 'commit': return gitCommit(cwd, {
      message: String(body?.message || ''),
      all: !!body?.all,
      amend: !!body?.amend,
    })
    case 'fetch': return gitFetch(cwd, { token: tokenInfo.token, remote: String(body?.remote || ''), prune: !!body?.prune, insecure: !!body?.insecure })
    case 'pull': return gitPull(cwd, {
      token: tokenInfo.token,
      remote: String(body?.remote || ''),
      branch: String(body?.branch || ''),
      rebase: !!body?.rebase,
      insecure: !!body?.insecure,
    })
    case 'push': return gitPush(cwd, {
      token: tokenInfo.token,
      remote: String(body?.remote || 'origin'),
      branch: String(body?.branch || ''),
      tags: !!body?.tags,
      insecure: !!body?.insecure,
    })
    case 'checkout': return gitCheckout(cwd, {
      target: String(body?.target || ''),
      create: !!body?.create,
      startPoint: String(body?.startPoint || ''),
    })
    case 'branch': return gitBranchOp(cwd, {
      action: String(body?.action || 'list'),
      name: String(body?.name || ''),
      force: !!body?.force,
      renameTo: String(body?.renameTo || ''),
    })
    case 'tag': return gitTagOp(cwd, {
      action: String(body?.action || 'create'),
      name: String(body?.name || ''),
      message: String(body?.message || ''),
      target: String(body?.target || ''),
    })
    case 'reset': return gitReset(cwd, { commit: String(body?.commit || 'HEAD'), mode: String(body?.mode || 'soft') })
    case 'init': return gitInit(cwd, { branch: String(body?.branch || 'main') })
    case 'remote': return gitSetRemote(cwd, { name: String(body?.name || 'origin'), url: String(body?.url || '') })
    default:
      return { ok: false, error: '未知 op：' + op }
  }
}
