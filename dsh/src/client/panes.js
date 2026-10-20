/**
 * 窗格：文件浏览 / 项目信息 / 终端 / 浏览器 / 自定义 / 媒体 / 笔记。
 * 0.10.6 起不再自带编辑器：文本交给系统默认程序，网页交给自定义窗口。
 * 全部是工作区里的标签页，没有独立左栏；对话也不在这里 —— 右栏就是宿主自己的会话区（见 hostdock.js）。
 * 每个窗格只读 store 的对应切片，动作全部来自 core。
 */
import { useState, useEffect, useRef } from 'react'
import XTERM_CSS from '@xterm/xterm/css/xterm.css'
import { el, Icon, Light } from './ui.js'
import {
  viewKindOf, kindEmoji,
} from './render.js'
import {
  API, store, useStore, STATES, normState, fmtSize, fmtDuration, relTime, shortPath, projEmoji,
  loadTree, openFile, rawUrl, htmlUrl, isHtmlFile, openHtmlWindow,
  termExec, termKill, termClear, loadGit,
  workspaceDirOf, revealPath, openExternal,
  visibleEntries, setFsSort, setFsQuery, selectEntry, fsMkdir, fsRename, fsDelete, fsReveal,
  openFsMenu, closeFsMenu,
  joinPath, crumbsOf,
  sessionsOf, primarySession, stateOf, jumpToSession, runProject, stopProject, openRunPort,
  ARTIFACT_FILE, loadArtifacts, openArtifact, sendArtifactToChat,
  openModal, siteUrlOf, cycleStatus, updateProject, projectOf, toast, listMediaDir, openTab,
  dragFilePayload, dragUrlPayload, sendPathToChat, sendUrlToChat, sendToChat,
  webSync, webGoto, webGotoSmart, webSearch, webSetEngine, SEARCH_ENGINES, webHome, webCloseHome,
  webBack, webForward, webReload, webLoaded, webProbe,
  webSetViewport, webOpenExternal, webSetMore,
  loadCustom, openCustom, newCustomDraft, editCustom, setCustomView, saveCustom,
  deleteCustom, buildCustomPrompt, fillHostInput, setCustomPrompt, setCustomRequirement,
  /* 源代码管理 / GitHub */
  scmOf, loadScm, scmStage, scmUnstage, scmDiscard, scmSetMessage, scmCommit,
  scmFetch, scmPull, scmPush, scmCheckout, scmBranchOp, scmTagOp, scmReset, scmInit, scmUninit,
  scmDiff, scmShowCommit, scmClearDiff, scmSetView, setScmInsecure,
  loadGh, loadGhRepos, ghUploadRepo,
} from './core.js'

/* ============================ 文件 / 项目信息（标签页） ============================ */

export function InfoPane({ project }) {
  useStore()
  const st = stateOf(project.id)
  const bound = sessionsOf(project)
  const git = store.git
  const art = store.artifacts

  return el('div', { className: 'pane-body info-body' },
    el('div', { className: 'info-head' },
      el('span', { className: 'info-ico', 'aria-hidden': 'true' }, projEmoji(project)),
      el('div', { className: 'info-title' },
        el('b', null, project.alias || project.name),
        el('span', { className: 'mono' }, shortPath(project.path || '未设置目录', 40)),
      ),
      el(Light, { pid: project.id }),
    ),

    el('div', { className: 'info-rows' },
      el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '状态'), el('span', { className: 'v' }, STATES[st].label)),
      el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '绑定对话'), el('span', { className: 'v' }, bound.length ? String(bound.length) + ' 个' : '未绑定')),
      project.note ? el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '备注'), el('span', { className: 'v' }, project.note)) : null,
    ),

    bound.length ? el('div', { className: 'info-sessions' },
      bound.map((s, i) => el('button', {
        key: s.id, type: 'button', className: 'mini-session',
        title: '打开宿主对话：' + (s.title || s.id),
        onClick: () => { if (!jumpToSession(s.id)) toast('没找到宿主打开对话的入口', 'warn') },
      },
        el('span', { className: 'light ' + normState(s.state), 'aria-hidden': 'true' }),
        el('span', { className: 'ms-title' }, s.title || s.id),
        i === 0 ? el('small', null, '主') : null,
      )),
    ) : null,

    el('div', { className: 'dc-row' },
      el('span', { className: 'k' }, '运行'),
      el('span', { className: 'v' },
        project.run && project.run.cmd
          ? el('span', { className: 'run-cmd mono', title: project.run.cmd }, project.run.cmd)
          : el('span', { className: 'wt-mute' }, '未配置（编辑项目 → 运行命令）'),
        project.run && project.run.cmd
          ? el('button', {
            type: 'button', className: 'mini-btn',
            onClick: () => runProject(project.id),
          }, '▶ 运行')
          : null,
        project.run && project.run.cmd
          ? el('button', {
            type: 'button', className: 'mini-btn',
            onClick: () => stopProject(project.id),
          }, '■ 停止')
          : null,
        project.run && project.run.port
          ? el('button', {
            type: 'button', className: 'mini-btn',
            title: '打开 http://localhost:' + project.run.port,
            onClick: () => openRunPort(project.id),
          }, ':' + project.run.port + ' ↗')
          : null,
      ),
    ),

    el('div', { className: 'info-actions' },
      el('button', { type: 'button', className: 'btn small', onClick: () => openModal('edit', project.id) }, '编辑信息'),
      el('button', { type: 'button', className: 'btn small', onClick: () => openModal('bind', project.id) }, '对话绑定'),
      el('button', { type: 'button', className: 'btn small', onClick: () => cycleStatus(project.id) }, '切换状态'),
    ),

    el('div', { className: 'sec-head' },
      el('span', null, '产物'),
      el('button', {
        type: 'button', className: 'mini-btn',
        title: '重新读取 ' + ARTIFACT_FILE,
        onClick: () => loadArtifacts(project.id),
      }, '刷新'),
    ),
    art.error
      ? el('p', { className: 'wt-mute' }, '读取出错：' + art.error)
      : art.items.length
        ? el('div', { className: 'art-list' },
          art.items.map((it, i) => el('div', { key: i, className: 'art-row' },
            el('span', { className: 'art-ico', 'aria-hidden': 'true' }, it.kind === 'url' ? '◍' : (it.kind === 'file' ? '🖼' : '◆')),
            el('span', { className: 'art-title', title: it.kind === 'url' ? it.url : it.path }, it.title),
            el('button', {
              type: 'button', className: 'mini-btn', title: '在工作台里打开',
              onClick: () => openArtifact(it),
            }, '打开'),
            el('button', {
              type: 'button', className: 'mini-btn', title: '把路径/网址填到对话输入框',
              onClick: () => sendArtifactToChat(it),
            }, '发到对话'),
          )),
        )
        : el('p', { className: 'wt-mute' },
          '还没有产物。在项目目录放一个 ' + ARTIFACT_FILE + '，例如：',
          el('code', { className: 'mono art-hint' }, '{"artifacts":[{"title":"站点","kind":"url","url":"http://localhost:5173"},{"title":"图","kind":"file","path":"docs/a.png"}]}'),
        ),

    el('div', { className: 'sec-head' },
      el('span', null, 'Git'),
      el('button', { type: 'button', className: 'mini-btn', title: '打开源代码管理窗（暂存 / 提交 / 推送 / 分支）', onClick: () => openTab(project.id, 'scm') }, '⑂ 管理'),
      el('button', { type: 'button', className: 'mini-btn', onClick: () => loadGit(project.id) }, git.state === 'loading' ? '读取中…' : '刷新'),
    ),
    git.state === 'error'
      ? el('p', { className: 'wt-mute' }, git.error || '读取失败')
      : !git.repo
        ? el('p', { className: 'wt-mute' }, git.state === 'loading' ? '读取中…' : '不是 git 仓库')
        : el('div', { className: 'git-box' },
          el('div', { className: 'git-branch' },
            el('span', { className: 'tag gold' }, git.branch || '—'),
            el('span', { className: 'mono' }, (git.counts?.total || 0) + ' 项改动'),
          ),
          el('div', { className: 'git-stats' },
            el('span', null, '暂存 ' + (git.counts?.staged || 0)),
            el('span', null, '未暂存 ' + (git.counts?.unstaged || 0)),
            el('span', null, '未跟踪 ' + (git.counts?.untracked || 0)),
          ),
          git.changes.length
            ? el('div', { className: 'git-changes' },
              git.changes.slice(0, 40).map((c, i) => el('div', { key: i, className: 'git-change' },
                el('span', { className: 'gc-code' }, c.code),
                el('span', { className: 'gc-file', title: c.file }, c.file),
              )),
            )
            : el('p', { className: 'wt-mute' }, '工作区干净'),
          git.log.length
            ? el('div', { className: 'git-log' },
              git.log.slice(0, 6).map((c) => el('div', { key: c.hash, className: 'git-commit', title: c.subject },
                el('span', { className: 'gc-hash mono' }, c.hash),
                el('span', { className: 'gc-sub' }, c.subject),
                el('span', { className: 'gc-date mono' }, c.date),
              )),
            )
            : null,
        ),
  )
}

/* ============================ 源代码管理（0.10.0） ============================ */

const SCM_VIEWS = [
  { id: 'changes', label: '改动' },
  { id: 'history', label: '历史' },
  { id: 'branches', label: '分支' },
]

/** 状态码 → 语义（暂存 / 未暂存 / 未跟踪 / 冲突） */
function codeKind(code) {
  const c = String(code || '')
  if (c === '??') return 'new'
  if (c[0] === 'U' || c[1] === 'U' || c === 'AA' || c === 'DD') return 'conflict'
  return 'tracked'
}

function splitChanges(changes) {
  const staged = []
  const unstaged = []
  const untracked = []
  for (const c of changes || []) {
    if (c.code === '??') untracked.push(c)
    else {
      if (c.code[0] !== ' ') staged.push(c)
      if (c.code[1] !== ' ') unstaged.push(c)
    }
  }
  return { staged, unstaged, untracked }
}

/**
 * 源代码管理窗。
 *
 * 和上游「源代码管理」窗的取舍差别：这里**不做工作区多根 / 索引勾选树**，
 * 只做单个仓库的一条直线 —— 看改动 → 暂存 → 写说明 → 提交 → 推。
 * 每一步都能失败并原样显示 git 的 stderr，不吞错。
 */
export function ScmPane({ project }) {
  useStore()
  const scm = scmOf(project.id)
  const gh = store.gh
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [newTag, setNewTag] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  /* 进窗格就拉一次；切项目也跟着换 */
  useEffect(() => { loadScm(project.id) }, [project.id])
  useEffect(() => { if (store.gh.state === 'idle') loadGh() }, [])

  const busy = !!scm.busy
  const view = scm.view || 'changes'
  const groups = splitChanges(scm.changes)
  const counts = scm.counts || { staged: 0, unstaged: 0, untracked: 0, total: 0, conflicts: 0 }
  const pid = project.id

  const doCommit = (push) => {
    const text = draft.trim()
    if (!text) { toast('先写提交说明', 'warn'); return }
    scmCommit(pid, { message: text, push }).then((out) => { if (out) setDraft('') })
  }

  /* 两步确认：第一次点把按钮变成「确认?」，3 秒后自动撤销 */
  const ask = (key) => {
    setConfirm(key)
    setTimeout(() => setConfirm((cur) => (cur === key ? '' : cur)), 4000)
  }

  const head = el('div', { className: 'scm-head' },
    el('button', {
      type: 'button', className: 'mini-btn scm-branch',
      title: '分支：' + (scm.branch || '—') + (scm.upstream ? '（跟踪 ' + scm.upstream + '）' : '（无上游）'),
      onClick: () => scmSetView(pid, view === 'branches' ? 'changes' : 'branches'),
    }, '⑂ ' + (scm.branch || '—')),
    (scm.ahead || scm.behind)
      ? el('span', { className: 'scm-sync mono', title: '与上游的差距' },
        (scm.ahead ? '↑' + scm.ahead : ''), (scm.behind ? '↓' + scm.behind : ''))
      : null,
    el('span', { className: 'scm-spacer' }),
    el('button', { type: 'button', className: 'mini-btn', disabled: busy, title: '从远程取回新提交（不改工作区）', onClick: () => scmFetch(pid) }, '取回'),
    el('button', { type: 'button', className: 'mini-btn', disabled: busy, title: '拉取（pull）', onClick: () => scmPull(pid) }, '拉取'),
    el('button', { type: 'button', className: 'mini-btn primary', disabled: busy, title: '推送（push）—— 第一次会自动建上游', onClick: () => scmPush(pid) }, scm.ahead ? '推送 ↑' + scm.ahead : '推送'),
    el('button', { type: 'button', className: 'mini-btn', disabled: busy, title: '重新读取状态', onClick: () => loadScm(pid) }, '↻'),
  )

  const tabs = el('div', { className: 'scm-tabs' },
    SCM_VIEWS.map((v) => el('button', {
      key: v.id, type: 'button',
      className: 'scm-tab' + (view === v.id ? ' on' : ''),
      onClick: () => scmSetView(pid, v.id),
    }, v.label,
      v.id === 'changes' && counts.total ? el('span', { className: 'scm-badge' }, String(counts.total)) : null,
      v.id === 'history' && scm.log.length ? el('span', { className: 'scm-badge' }, String(scm.log.length)) : null,
    )),
  )

  /* ---------- 未登录 / 未初始化 ---------- */

  if (scm.state === 'loading' && !scm.repo) {
    return el('div', { className: 'pane-body scm-body' }, head,
      el('div', { className: 'pane-empty' }, el('span', { className: 'pe-ico' }, '⑂'), el('p', null, '正在读取仓库状态…')))
  }

  if (!scm.repo) {
    return el('div', { className: 'pane-body scm-body' }, head,
      el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '⑂'),
        el('p', null, '这个目录还不是 git 仓库'),
        scm.error ? el('p', { className: 'hint' }, scm.error) : null,
        el('div', { className: 'pe-actions' },
          el('button', { type: 'button', className: 'btn small primary', disabled: busy, onClick: () => scmInit(pid) }, '在这里初始化仓库'),
          el('button', { type: 'button', className: 'btn small', onClick: () => openModal('clone') }, '克隆一个仓库'),
        ),
        el('p', { className: 'hint' }, '初始化后用「上传仓库」可以把整个项目推到 GitHub。'),
      ),
    )
  }

  /* ---------- 主体 ---------- */

  const ghBar = el('div', { className: 'scm-gh' },
    gh.loggedIn
      ? [
        el('span', { className: 'scm-gh-ico', 'aria-hidden': 'true' }, '●'),
        el('b', null, gh.login || 'GitHub'),
        el('span', { className: 'wt-mute' }, gh.source === 'git-credential' ? '（用本机 git 已登录的账号）' : (gh.source === 'stored' ? '' : '（来自 ' + gh.source + '）')),
        el('span', { className: 'scm-spacer' }),
        el('button', { type: 'button', className: 'mini-btn', onClick: () => setUploadOpen((v) => !v) }, uploadOpen ? '收起' : '上传仓库'),
        el('button', { type: 'button', className: 'mini-btn', onClick: () => openModal('clone') }, '克隆'),
      ]
      : [
        el('span', { className: 'scm-gh-ico off', 'aria-hidden': 'true' }, '○'),
        el('span', null, gh.state === 'loading' ? '正在识别 GitHub 账号…' : '未登录 GitHub'),
        el('span', { className: 'wt-mute' }, '本地提交推送照常可用，登录后才能建仓 / 列仓库'),
        el('span', { className: 'scm-spacer' }),
        el('button', { type: 'button', className: 'mini-btn primary', onClick: () => openModal('ghlogin') }, '登录 GitHub'),
      ],
  )

  const uploadPanel = uploadOpen && gh.loggedIn
    ? el('div', { className: 'scm-upload' },
      el('p', { className: 'wt-mute' }, '把当前项目推到 GitHub：没仓库就 init、没提交就提交一次、没 origin 就建远程仓库。'),
      el('button', { type: 'button', className: 'btn small primary', disabled: busy, onClick: () => openModal('ghupload', pid) }, '开始上传…'),
      scm.remote ? el('p', { className: 'mono wt-mute' }, '当前 origin：' + scm.remote) : null,
    )
    : null

  const diff = scm.diff && (scm.diff.state !== 'idle')
    ? el('div', { className: 'scm-diff' },
      el('div', { className: 'scm-diff-head' },
        el('span', { className: 'mono' }, scm.diff.file || ''),
        el('span', { className: 'scm-spacer' }),
        scm.diff.file && !scm.diff.file.startsWith('commit:') && scm.selStaged
          ? el('button', { type: 'button', className: 'mini-btn', onClick: () => scmUnstage(pid, [scm.diff.file]) }, '取消暂存')
          : null,
        scm.diff.file && scm.sel
          ? el('button', { type: 'button', className: 'mini-btn', onClick: () => scmClearDiff(pid) }, '✕')
          : null,
      ),
      scm.diff.state === 'loading'
        ? el('p', { className: 'wt-mute' }, '读取中…')
        : scm.diff.state === 'error'
          ? el('p', { className: 'wt-bad' }, scm.diff.error || '读取失败')
          : scm.diff.binary
            ? el('p', { className: 'wt-mute' }, '二进制文件，不做文本预览')
            : scm.diff.text
              ? el('div', { className: 'scm-diff-body mono' }, diffLines(scm.diff.text))
              : el('p', { className: 'wt-mute' }, '没有差异'),
    )
    : null

  return el('div', { className: 'pane-body scm-body' },
    head,
    ghBar,
    uploadPanel,
    scm.error ? el('p', { className: 'scm-error' }, scm.error) : null,
    tabs,

    view === 'changes' ? el('div', { className: 'scm-scroll' },
      el('div', { className: 'scm-commit' },
        el('textarea', {
          className: 'scm-msg',
          placeholder: '提交说明（第一行是标题）',
          rows: 2,
          value: draft,
          onChange: (e) => setDraft(e.target.value),
        }),
        el('div', { className: 'scm-commit-actions' },
          el('button', {
            type: 'button', className: 'btn small primary',
            disabled: busy || !counts.staged,
            title: counts.staged ? '提交暂存的 ' + counts.staged + ' 项' : '先暂存一些改动',
            onClick: () => doCommit(false),
          }, busy === 'commit' ? '提交中…' : '提交'),
          el('button', { type: 'button', className: 'btn small', disabled: busy || !counts.staged, onClick: () => doCommit(true) }, '提交并推送'),
          el('span', { className: 'scm-spacer' }),
          counts.unstaged || counts.untracked
            ? el('button', { type: 'button', className: 'mini-btn', disabled: busy, onClick: () => scmStage(pid, []) }, '全部暂存')
            : null,
        ),
      ),

      groups.staged.length ? scmSection('暂存的改动', groups.staged, {
        key: 'staged', pid, staged: true, scm,
        action: { label: '全部取消暂存', run: () => scmUnstage(pid, []) },
      }) : null,
      groups.unstaged.length ? scmSection('未暂存的改动', groups.unstaged, {
        key: 'unstaged', pid, staged: false, scm, confirm, ask,
      }) : null,
      groups.untracked.length ? scmSection('未跟踪的文件', groups.untracked, {
        key: 'untracked', pid, staged: false, scm, confirm, ask,
      }) : null,

      !counts.total
        ? el('div', { className: 'pane-empty', style: { padding: '18px 12px' } },
          el('span', { className: 'pe-ico' }, '✓'),
          el('p', null, '工作区干净，没有待提交的改动'),
          scm.upstream ? el('p', { className: 'hint mono' }, scm.branch + ' → ' + scm.upstream) : null,
        )
        : null,

      scm.log.length
        ? el('div', { className: 'scm-recent' },
          el('div', { className: 'scm-sec-head' },
            el('span', null, '最近提交'),
            el('button', { type: 'button', className: 'mini-btn', onClick: () => scmSetView(pid, 'history') }, '全部 ›'),
          ),
          scm.log.slice(0, 4).map((c) => el('div', { key: c.hash, className: 'scm-commit-row', title: c.subject, onClick: () => scmShowCommit(pid, c.hash) },
            el('span', { className: 'gc-hash mono' }, c.hash),
            el('span', { className: 'gc-sub' }, c.subject),
            el('span', { className: 'gc-date mono' }, c.date),
          )),
        )
        : null,
    ) : null,

    view === 'history' ? el('div', { className: 'scm-scroll' },
      scm.log.length
        ? scm.log.map((c) => el('div', { key: c.hash, className: 'scm-commit-row', title: c.subject, onClick: () => scmShowCommit(pid, c.hash) },
          el('span', { className: 'gc-hash mono' }, c.hash),
          el('span', { className: 'gc-sub' }, c.subject),
          el('span', { className: 'gc-date mono' }, c.date),
          el('button', {
            type: 'button',
            className: 'mini-btn scm-ghost',
            title: '把当前分支回退到这个提交（--soft，改动会回到工作区）',
            onClick: (e) => {
              e.stopPropagation()
              if (confirm === 'reset:' + c.hash) { scmReset(pid, c.hash, 'soft'); setConfirm('') }
              else ask('reset:' + c.hash)
            },
          }, confirm === 'reset:' + c.hash ? '确认回退?' : '回退'),
        ))
        : el('p', { className: 'wt-mute' }, '还没有提交'),
    ) : null,

    view === 'branches' ? el('div', { className: 'scm-scroll' },
      el('div', { className: 'scm-sec-head' }, el('span', null, '本地分支'), el('span', { className: 'scm-count' }, String(scm.branches.length))),
      scm.branches.map((b) => el('div', { key: b.name, className: 'scm-branch-row' + (b.current ? ' on' : '') },
        el('span', { className: 'mono' }, (b.current ? '● ' : '○ ') + b.name),
        el('span', { className: 'gc-hash mono' }, b.hash),
        el('span', { className: 'scm-spacer' }),
        b.current ? null : el('button', { type: 'button', className: 'mini-btn', disabled: busy, onClick: () => scmCheckout(pid, b.name) }, '切换'),
        b.current ? null : el('button', {
          type: 'button', className: 'mini-btn',
          disabled: busy,
          onClick: () => (confirm === 'delbr:' + b.name ? (scmBranchOp(pid, 'delete', b.name), setConfirm('')) : ask('delbr:' + b.name)),
        }, confirm === 'delbr:' + b.name ? '确认删除?' : '删除'),
      )),
      el('div', { className: 'scm-newline' },
        el('input', {
          className: 'scm-input mono', placeholder: '新分支名', value: newBranch,
          onChange: (e) => setNewBranch(e.target.value),
        }),
        el('button', {
          type: 'button', className: 'mini-btn', disabled: busy || !newBranch.trim(),
          onClick: () => { scmCheckout(pid, newBranch.trim(), { create: true }); setNewBranch('') },
        }, '新建并切换'),
      ),

      scm.remoteBranches.length ? el('div', { className: 'scm-sec-head' }, el('span', null, '远程分支'), el('span', { className: 'scm-count' }, String(scm.remoteBranches.length))) : null,
      scm.remoteBranches.map((b) => el('div', { key: b.name, className: 'scm-branch-row' },
        el('span', { className: 'mono wt-mute' }, b.name),
        el('span', { className: 'scm-spacer' }),
        el('button', { type: 'button', className: 'mini-btn', disabled: busy, onClick: () => scmCheckout(pid, b.name) }, '检出'),
      )),

      el('div', { className: 'scm-sec-head' }, el('span', null, '标签'), el('span', { className: 'scm-count' }, String(scm.tags.length))),
      scm.tags.length
        ? scm.tags.map((t) => el('div', { key: t.name, className: 'scm-branch-row' },
          el('span', { className: 'tag gold' }, t.name),
          el('span', { className: 'gc-hash mono' }, t.hash),
          el('span', { className: 'scm-spacer' }),
          el('button', {
            type: 'button', className: 'mini-btn',
            disabled: busy,
            onClick: () => (confirm === 'deltag:' + t.name ? (scmTagOp(pid, 'delete', t.name), setConfirm('')) : ask('deltag:' + t.name)),
          }, confirm === 'deltag:' + t.name ? '确认删除?' : '删除'),
        ))
        : el('p', { className: 'wt-mute' }, '还没有标签'),
      el('div', { className: 'scm-newline' },
        el('input', {
          className: 'scm-input mono', placeholder: '新标签名，例如 v1.0.0', value: newTag,
          onChange: (e) => setNewTag(e.target.value),
        }),
        el('button', {
          type: 'button', className: 'mini-btn', disabled: busy || !newTag.trim(),
          onClick: () => { scmTagOp(pid, 'create', newTag.trim()); setNewTag('') },
        }, '打标签'),
      ),

      el('div', { className: 'scm-sec-head' }, el('span', null, '远程')),
      scm.remotes.length
        ? scm.remotes.map((r) => el('div', { key: r.name, className: 'scm-branch-row' },
          el('span', { className: 'mono' }, r.name),
          el('span', { className: 'mono wt-mute scm-remote-url', title: r.url }, r.url),
        ))
        : el('p', { className: 'wt-mute' }, '还没配置远程仓库'),
      el('label', { className: 'chk' },
        el('input', {
          type: 'checkbox', checked: store.scm.insecure === true,
          onChange: (e) => setScmInsecure(e.target.checked),
        }),
        el('span', null, '跳过证书校验（本机吊销检查连不上时用）'),
      ),

      el('div', { className: 'scm-sec-head' }, el('span', null, '取消初始化')),
      el('div', { className: 'scm-danger' },
        el('button', {
          type: 'button',
          className: 'mini-btn danger',
          disabled: !!scm.busy,
          title: '等价于在仓库根执行 rm -rf .git',
          onClick: () => {
            if (confirm === 'uninit') {
              setConfirm('')
              scmUninit(pid)
            } else ask('uninit')
          },
        }, confirm === 'uninit' ? '再点一次确认删除 .git' : '删除 .git（取消初始化）'),
        el('p', { className: 'hint' },
          '项目文件一个都不动，只删 .git 目录 —— 等于把「仓库」变回「普通文件夹」。' +
          '提交历史、分支、标签会一起没掉；如果已经推到 GitHub，远端那份不受影响，随时能重新克隆回来。'),
      ),
    ) : null,

    diff,
  )
}

/** 一段改动列表。staged 决定行内按钮是「暂存」还是「取消暂存」 */
function scmSection(title, items, opts) {
  const { pid, staged, scm, confirm, ask } = opts
  const action = opts.action || null
  return el('div', { className: 'scm-sec' },
    el('div', { className: 'scm-sec-head' },
      el('span', null, title),
      el('span', { className: 'scm-count' }, String(items.length)),
      el('span', { className: 'scm-spacer' }),
      action ? el('button', { type: 'button', className: 'mini-btn', disabled: !items.length, onClick: action.run }, action.label) : null,
      !staged && !action
        ? el('button', { type: 'button', className: 'mini-btn', onClick: () => scmStage(pid, items.map((c) => c.file)) }, '全部暂存')
        : null,
    ),
    items.map((c) => {
      const active = scm.sel === c.file && (staged ? scm.selStaged : !scm.selStaged)
      const key = 'dis:' + c.file
      return el('div', {
        key: c.file,
        className: 'scm-file' + (active ? ' on' : ''),
        title: c.from ? c.from + ' → ' + c.file : c.file,
        onClick: () => scmDiff(pid, c.file, { staged }),
      },
        el('span', { className: 'scm-code mono ' + codeKind(c.code) }, c.code.trim() || '·'),
        el('span', { className: 'scm-file-name' }, c.file),
        el('span', { className: 'scm-file-actions' },
          staged
            ? el('button', { type: 'button', className: 'mini-btn', title: '取消暂存', onClick: (e) => { e.stopPropagation(); scmUnstage(pid, [c.file]) } }, '－')
            : el('button', { type: 'button', className: 'mini-btn', title: '暂存', onClick: (e) => { e.stopPropagation(); scmStage(pid, [c.file]) } }, '＋'),
          el('button', {
            type: 'button',
            className: 'mini-btn',
            title: '丢弃这个文件的改动（不可恢复）',
            onClick: (e) => {
              e.stopPropagation()
              if (confirm === key) { scmDiscard(pid, [c.file]); ask(''); }
              else if (ask) ask(key)
            },
          }, confirm === key ? '确认?' : '↺'),
        ),
      )
    }),
  )
}

/** diff 上色：只看行首，不做行内 diff（够用且不会误判） */
function diffLines(text) {
  const lines = String(text || '').split('\n').slice(0, 3000)
  return lines.map((line, i) => {
    const cls = line.startsWith('+++') || line.startsWith('---')
      ? 'dl-meta'
      : line.startsWith('@@')
        ? 'dl-hunk'
        : line.startsWith('+')
          ? 'dl-add'
          : line.startsWith('-')
            ? 'dl-del'
            : line.startsWith('diff ') || line.startsWith('index ')
              ? 'dl-meta'
              : ''
    return el('div', { key: i, className: 'dl ' + cls }, line || ' ')
  })
}

/* ============================ 文件管理器（面板内自绘） ============================ */

/**
 * 文件管理器。
 *
 * 为什么自绘：系统资源管理器是要 HWND 的原生窗口，HTML 面板里没有能承载它的句柄，
 * SetParent 只能盖在整个窗口上、跟不了面板布局。所以列表自己画，但保留
 * 「⧉ 在系统窗口中显示」这个出口 —— 复制粘贴、拖拽、预览这些原生能力还是它强。
 *
 * 交互：单击选中 · 双击进目录 / 开文件（媒体进媒体窗、网页进自定义窗口、其余交给系统程序）· 右键菜单（显示 / 重命名 / 回收站）
 *      · ＋ 新建文件夹 · 搜索过滤 · 表头点排序 · 删除走系统回收站，不做硬删。
 */
export function FilesPane({ project }) {
  useStore()
  const tree = store.tree
  const view = store.fs
  const rv = store.reveal || {}
  const workDir = workspaceDirOf(project)
  const projDir = String(project.path || '')

  const [pathInput, setPathInput] = useState('')
  const [renaming, setRenaming] = useState('')
  const [renameText, setRenameText] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const menu = view.menu || null

  /* 第一次进面板落到对话的工作目录；切项目（树不属于它）也跟着换 */
  useEffect(() => {
    if (!workDir) return
    if (store.tree.pid !== project.id || !store.tree.path) loadTree(workDir, { pid: project.id })
  }, [workDir, project.id])

  const rows = visibleEntries(tree, view)
  const dirPath = String(tree.path || '')
  const busy = tree.state === 'loading'

  const go = (dir) => {
    const t = String(dir || '').trim()
    if (!t) return
    selectEntry('')
    loadTree(t)
  }
  const activate = (row) => {
    const full = joinPath(dirPath, row.name)
    if (row.dir) go(full)
    else openFile(full, project.id)
  }
  const jump = () => { const p = pathInput.trim(); if (p) { go(p); setPathInput('') } }

  /* ---------- 面包屑 ---------- */
  const crumbNodes = []
  const crumbs = crumbsOf(dirPath)
  crumbs.forEach((c, i) => {
    if (i) crumbNodes.push(el('span', { key: 'sep-' + i, className: 'fx-sep', 'aria-hidden': 'true' }, '›'))
    crumbNodes.push(el('button', {
      key: c.path, type: 'button', className: 'fx-crumb' + (i === crumbs.length - 1 ? ' on' : ''),
      title: c.path, onClick: () => go(c.path),
    }, c.label))
  })

  /* ---------- 新建 / 重命名（内联输入） ---------- */
  const startCreate = () => { setCreating(true); setNewName('新建文件夹'); setRenaming('') }
  const commitCreate = () => {
    const nm = newName.trim()
    setCreating(false)
    if (nm) fsMkdir(dirPath, nm)
  }
  const startRename = (row) => { setRenaming(row.name); setRenameText(row.name); setCreating(false); closeFsMenu() }
  const commitRename = () => {
    const nm = renameText.trim()
    const from = renaming
    setRenaming('')
    if (nm && nm !== from) fsRename(dirPath, from, nm)
  }

  const sortMark = (f) => (view.sort === f ? (view.dir > 0 ? '↑' : '↓') : '')

  const rowKey = (e, ev) => {
    ev.preventDefault()
    selectEntry(e.name)
    openFsMenu(dirPath, e, ev.clientX || 0, ev.clientY || 0)
  }

  return el('div', { className: 'pane-body files-body fx-body' },

    /* 工具条：上一级 + 面包屑 + 刷新 + 新建 + 系统窗口 */
    el('div', { className: 'fx-bar' },
      el('button', {
        type: 'button', className: 'fx-nav', title: '上一级',
        disabled: !tree.parent, onClick: () => go(tree.parent),
      }, '↑'),
      el('div', { className: 'fx-crumbs' }, ...crumbNodes),
      el('button', { type: 'button', className: 'mini-btn', title: '刷新', onClick: () => loadTree(dirPath, { force: true }) },
        busy ? '…' : '⟳'),
      el('button', {
        type: 'button', className: 'mini-btn', disabled: tree.writable === false,
        title: tree.writable === false ? '新建只允许在工作目录 / 用户目录 / 已注册项目内' : '新建文件夹',
        onClick: startCreate,
      }, '＋ 新建'),
      el('button', {
        type: 'button', className: 'mini-btn', title: '把选中的文件 / 当前目录发到对话输入框',
        onClick: () => {
          const sel = rows.find((r) => r.name === view.sel)
          if (sel && !sel.dir) { sendPathToChat(joinPath(dirPath, sel.name)); return }
          sendPathToChat(dirPath)
        },
      }, '→ 对话'),
      el('button', { type: 'button', className: 'mini-btn', title: '在系统资源管理器中打开这个目录', onClick: () => revealPath(dirPath) }, '⧉ 系统窗口'),
    ),

    /* 地址栏 + 搜索 */
    el('div', { className: 'fx-search' },
      el('input', {
        className: 'mono fx-path', value: pathInput, autoComplete: 'off',
        placeholder: dirPath || '输入绝对路径，回车跳转（例：D:\\work\\demo）',
        onChange: (e) => setPathInput(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') jump() },
      }),
      el('input', {
        className: 'fx-query', value: view.query, autoComplete: 'off',
        placeholder: '过滤…',
        onChange: (e) => setFsQuery(e.target.value),
      }),
    ),

    /* 表头 */
    el('div', { className: 'fx-head' },
      el('button', { type: 'button', className: 'fx-th name' + (view.sort === 'name' ? ' on' : ''), onClick: () => setFsSort('name') },
        '名称 ' + sortMark('name')),
      el('button', { type: 'button', className: 'fx-th size' + (view.sort === 'size' ? ' on' : ''), onClick: () => setFsSort('size') },
        '大小 ' + sortMark('size')),
      el('button', { type: 'button', className: 'fx-th time' + (view.sort === 'mtime' ? ' on' : ''), onClick: () => setFsSort('mtime') },
        '修改 ' + sortMark('mtime')),
    ),

    /* 列表 */
    el('div', { className: 'fx-list' },
      creating
        ? el('div', { className: 'fx-row editing' },
          el('span', { className: 'fx-name' },
            el('span', { className: 'fx-ico', 'aria-hidden': 'true' }, '📁'),
            el('input', {
              className: 'fx-edit', value: newName, autoFocus: true,
              onChange: (e) => setNewName(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') commitCreate()
                if (e.key === 'Escape') setCreating(false)
              },
              onBlur: commitCreate,
            }),
          ),
          el('span', { className: 'fx-size mono' }, '—'),
          el('span', { className: 'fx-time mono' }, '新建中'),
        )
        : null,

      rows.length
        ? rows.map((e) => el('div', {
          key: e.name,
          className: 'fx-row' + (view.sel === e.name ? ' on' : ''),
          role: 'button',
          draggable: 'true',
          onDragStart: (ev) => { dragFilePayload(ev, joinPath(dirPath, e.name)) },
          title: '拖动可发给对话 · ' + joinPath(dirPath, e.name),
          onClick: () => selectEntry(e.name),
          onDoubleClick: () => activate(e),
          onContextMenu: (ev) => rowKey(e, ev),
        },
          el('span', { className: 'fx-name' },
            el('span', { className: 'fx-ico', 'aria-hidden': 'true' }, e.dir ? '📁' : fileEmoji(e.name)),
            renaming === e.name
              ? el('input', {
                className: 'fx-edit', value: renameText, autoFocus: true,
                onClick: (ev) => ev.stopPropagation(),
                onChange: (ev) => setRenameText(ev.target.value),
                onKeyDown: (ev) => {
                  ev.stopPropagation()
                  if (ev.key === 'Enter') commitRename()
                  if (ev.key === 'Escape') setRenaming('')
                },
                onBlur: commitRename,
              })
              : el('span', { className: 'fx-label' }, e.name),
            e.link ? el('small', { className: 'fx-tag' }, '链接') : null,
          ),
          el('span', { className: 'fx-size mono' }, e.dir ? '—' : fmtSize(e.size)),
          el('span', { className: 'fx-time mono' }, e.mtime ? relTime(e.mtime) : '—'),
        ))
        : el('div', { className: 'fx-empty' },
          tree.state === 'error'
            ? el('p', null, tree.error || '读不了这个目录')
            : busy
              ? el('p', null, '读取中…')
              : el('p', null, view.query ? '没有匹配「' + view.query + '」的条目' : '这个目录是空的'),
          tree.state === 'error'
            ? el('button', { type: 'button', className: 'btn small', onClick: () => revealPath(dirPath || projDir) }, '用系统窗口打开')
            : null,
        ),
    ),

    /* 状态栏 */
    el('div', { className: 'fx-foot' },
      el('span', null, (view.query ? rows.length + ' / ' + (tree.total || 0) : (tree.total || 0)) + ' 项'),
      tree.truncated ? el('span', { className: 'fx-warn' }, '只显示前 800 项') : null,
      view.sel ? el('span', { className: 'fx-sel mono', title: view.sel }, '已选 ' + view.sel) : null,
      tree.writable === false
        ? el('span', { className: 'fx-warn', title: '新建 / 重命名只允许在工作目录 / 用户目录 / 已注册项目内' }, '只读')
        : null,
      rv.state === 'error'
        ? el('span', { className: 'fx-warn', title: rv.error }, '上次系统窗口打开失败')
        : null,
    ),

    /* 右键菜单 */
    menu
      ? el('div', {
        className: 'fx-mask',
        onClick: () => closeFsMenu(),
        onContextMenu: (ev) => { ev.preventDefault(); closeFsMenu() },
      },
        el('div', {
          className: 'fx-menu',
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onClick: (ev) => ev.stopPropagation(),
        },
          menu.isDir
            ? el('button', { type: 'button', onClick: () => { const m = menu; closeFsMenu(); go(joinPath(m.dir, m.name)) } }, '📂 进入目录')
            : !isHtmlFile(menu.name)
              ? null
              : el('button', { type: 'button', onClick: () => { const m = menu; closeFsMenu(); openHtmlWindow(joinPath(m.dir, m.name), project.id) } }, '❖ 在自定义窗口里打开'),
          menu.isDir
            ? null
            : el('button', { type: 'button', onClick: () => { const m = menu; closeFsMenu(); openExternal(joinPath(m.dir, m.name)) } }, '🚀 用系统程序打开'),
          el('button', { type: 'button', onClick: () => { const m = menu; closeFsMenu(); fsReveal(m.dir, m.name) } }, '⧉ 在系统窗口中显示'),
          el('button', {
            type: 'button', disabled: tree.writable === false,
            title: tree.writable === false ? '重命名只允许在工作目录 / 用户目录 / 已注册项目内' : '',
            onClick: () => startRename({ name: menu.name, dir: menu.dir }),
          }, '✎ 重命名'),
          el('button', {
            type: 'button', className: 'danger', disabled: !!menu.block,
            title: menu.block || '移到系统回收站（可以还原）',
            onClick: () => {
              if (menu.block) return
              const m = menu
              closeFsMenu()
              fsDelete(m.dir, m.name)
            },
          }, '🗑 移到回收站'),
          menu.block ? el('p', { className: 'fx-menu-note' }, menu.block) : null,
        ),
      )
      : null,
  )
}


function fileEmoji(name) {
  if (/\.(md|markdown|txt)$/i.test(name)) return '📄'
  if (/\.(js|mjs|cjs|ts|jsx|tsx|vue|svelte)$/i.test(name)) return '🟨'
  if (/\.(py)$/i.test(name)) return '🐍'
  if (/\.(json|yml|yaml|toml|ini)$/i.test(name)) return '⚙️'
  if (/\.pdf$/i.test(name)) return '📕'
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(name)) return '🖼️'
  if (/\.(mp4|webm|mov)$/i.test(name)) return '🎬'
  if (/\.(mp3|wav|m4a|flac)$/i.test(name)) return '🎵'
  if (/\.(html|htm|css|scss)$/i.test(name)) return '🎨'
  return '·'
}

/* ============================ 主区：终端 ============================ */

/*
 * 两种模式，优先真 PTY：
 *   pty  — 走 node-pty（借宿主自带的那份），能跑 vim / top / ssh / 交互式提示符，
 *          Ctrl+C 真的进到前台进程；宿主里借不到原生模块就自动降级。
 *   exec — 一条命令起一个进程 + NDJSON 流（0.8.53 之前的行为），没有交互能力。
 */

let xtermCssReady = false
/** xterm 自带几十条 .xterm 规则，只注入一次 */
function ensureXtermCss() {
  if (xtermCssReady || typeof document === 'undefined') return
  xtermCssReady = true
  try {
    const node = document.createElement('style')
    node.setAttribute('data-wt', 'xterm')
    node.textContent = XTERM_CSS
    document.head.appendChild(node)
  } catch { /* 注入失败只是不好看，不影响功能 */ }
}

async function ptyPost(path, body, signal) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
  return data || {}
}

export function TermPane({ project }) {
  /* 先按「命令模式」渲染，PTY 一旦握手成功立刻切过去（通常 <100ms）。
     这样即使宿主里没有 node-pty，界面也不会先闪一个空白等待页。 */
  const [mode, setMode] = useState('exec')
  const [reason, setReason] = useState('')
  const [info, setInfo] = useState({ shell: '', cwd: '' })
  const [tryN, setTryN] = useState(0)
  const sessionId = 'wt-pty-' + project.id

  useEffect(() => {
    let alive = true
    ptyPost('/term/open', { id: sessionId, cwd: workspaceDirOf(project) || project.path || '' })
      .then((r) => {
        if (!alive) return
        if (r && r.ok && r.mode === 'pty') {
          setInfo({ shell: r.shell || '', cwd: r.cwd || '' })
          setMode('pty')
        } else {
          setReason((r && r.error) || '当前环境里没有可用的 node-pty')
          setMode('exec')
        }
      })
      .catch((err) => {
        if (!alive) return
        setReason(String((err && err.message) || err))
        setMode('exec')
      })
    return () => { alive = false }
  }, [project.id, tryN])

  if (mode === 'exec') return el(ExecTerm, { project, reason, onRetryPty: () => setTryN((n) => n + 1) })
  return el(PtyTerm, { project, sessionId, info })
}

/** 一条命令一个进程（PTY 不可用时的降级模式，行为与 0.8.53 之前一致） */
function ExecTerm({ project, reason, onRetryPty }) {
  useStore()
  const term = store.terms[project.id] || { lines: [], busy: false, cwd: '', history: [] }
  const [input, setInput] = useState('')
  const [hidx, setHidx] = useState(-1)
  const [showHist, setShowHist] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [term.lines.length])

  const submit = () => {
    const cmd = input.trim()
    if (!cmd) return
    termExec(project.id, cmd)
    setInput('')
    setHidx(-1)
  }

  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const hist = term.history || []
      if (!hist.length) return
      const next = hidx < 0 ? hist.length - 1 : Math.max(0, hidx - 1)
      setHidx(next)
      setInput(hist[next] || '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const hist = term.history || []
      if (hidx < 0) return
      const next = hidx + 1
      if (next >= hist.length) { setHidx(-1); setInput(''); return }
      setHidx(next)
      setInput(hist[next] || '')
      return
    }
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); termClear(project.id) }
  }

  return el('div', { className: 'pane-body term-body' },
    el('div', { className: 'term-bar' },
      el('span', { className: 'term-cwd mono', title: term.cwd || project.path }, shortPath(term.cwd || project.path || '—', 40)),
      term.busy ? el('span', { className: 'term-busy' }, '运行中…') : null,
      el('button', {
        type: 'button',
        className: 'mini-btn' + (showHist ? ' on' : ''),
        title: '历史命令（点一条填进输入框）',
        onClick: () => setShowHist(!showHist),
      }, '⏱ 历史' + (term.history && term.history.length ? ' ' + term.history.length : '')),
      el('button', { type: 'button', className: 'mini-btn', onClick: () => termClear(project.id) }, '清屏'),
      term.busy ? el('button', { type: 'button', className: 'mini-btn danger', onClick: () => termKill(project.id) }, '中断') : null,
    ),
    el('div', { className: 'term-out mono', ref: box },
      term.lines.length
        ? term.lines.map((line, i) => el('div', { key: i, className: 'tline ' + line.kind },
          line.kind === 'cmd' ? el('span', { className: 'tprompt' }, '❯ ') : null,
          el('span', { className: 'ttext' }, line.text),
        ))
        : el('div', { className: 'term-hint' },
          el('p', null, '这个终端直接把命令交给宿主所在机器执行。'),
          el('p', { className: 'mono' }, '试：dir / git status / npm run build'),
          el('p', null, 'cd 会改变后续命令的工作目录；↑↓ 翻历史，Ctrl+L 清屏。'),
          reason
            ? el('p', { className: 'term-fallback' },
              '当前是「命令模式」：' + reason,
              onRetryPty
                ? el('button', {
                  type: 'button', className: 'mini-btn', style: { marginLeft: '6px' },
                  onClick: onRetryPty,
                }, '再试一次 PTY')
                : null)
            : null,
        ),
    ),
    showHist
      ? el('div', { className: 'term-hist' },
        term.history && term.history.length
          ? [...term.history].reverse().slice(0, 30).map((cmd, i) => el('button', {
            key: i, type: 'button', className: 'th-row mono',
            title: '点一下填进输入框',
            onClick: () => { setInput(cmd); setShowHist(false) },
          }, el('span', { className: 'th-ico' }, '❯'), el('span', { className: 'th-cmd' }, cmd)))
          : el('div', { className: 'th-empty' }, '还没有历史命令；执行过的命令会自动记在这里'),
      )
      : null,
    el('div', { className: 'term-in' },
      el('span', { className: 'tprompt' }, '❯'),
      el('input', {
        className: 'mono', value: input, spellCheck: false, autoComplete: 'off',
        placeholder: term.busy ? '等待上一条命令结束…' : '输入命令，回车执行',
        onChange: (e) => setInput(e.target.value),
        onKeyDown: onKey,
      }),
    ),
  )
}

/**
 * 真 PTY 终端（xterm.js）。
 *
 * 连接方式：宿主开一个 pty 会话（id 按项目固定）→ 这里挂一条 NDJSON 长连接收输出，
 * 键盘输入攒 10ms 批量 POST 回去，容器尺寸变化 140ms 防抖后报 cols/rows。
 * 切标签页只是卸载 xterm 组件，**进程留在宿主里**；切回来重新挂上会先回放 backlog，
 * 屏幕基本能接上。要彻底收掉就点「重启」（kill + 重开）。
 */
function PtyTerm({ project, sessionId, info }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const inputRef = useRef(null)
  const [state, setState] = useState('connecting')
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let disposed = false
    let term = null
    let fit = null
    let ro = null
    let ctrl = null
    let inputBuf = ''
    let inputTimer = 0
    let fitTimer = 0

    const sendInput = (d) => {
      inputBuf += d
      if (!inputTimer) {
        inputTimer = setTimeout(() => {
          inputTimer = 0
          const data = inputBuf
          inputBuf = ''
          if (data) ptyPost('/term/input', { id: sessionId, data }).catch(() => { /* 进程已退出 */ })
        }, 10)
      }
    }
    inputRef.current = sendInput

    ;(async () => {
      ensureXtermCss()
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      if (disposed || !hostRef.current) return
      term = new Terminal({
        fontSize: 12.5,
        fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei Mono", monospace',
        cursorBlink: true,
        scrollback: 4000,
        theme: {
          background: '#0b0e12',
          foreground: '#dfe4ea',
          cursor: '#f0b429',
          selectionBackground: 'rgba(240,180,41,.28)',
          black: '#0b0e12',
          brightBlack: '#5a6270',
          red: '#e06c75',
          brightRed: '#ff8b93',
          green: '#98c379',
          brightGreen: '#b6e08a',
          yellow: '#e5c07b',
          brightYellow: '#ffd68a',
          blue: '#61afef',
          brightBlue: '#82c4ff',
          magenta: '#c678dd',
          brightMagenta: '#e0a0f0',
          cyan: '#56b6c2',
          brightCyan: '#7fd6e0',
          white: '#dfe4ea',
          brightWhite: '#ffffff',
        },
      })
      termRef.current = term
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      term.onData(sendInput)

      const doFit = () => {
        if (disposed || !term) return
        try { fit.fit() } catch { /* 容器还没量出尺寸 */ }
        ptyPost('/term/resize', { id: sessionId, cols: term.cols, rows: term.rows }).catch(() => {})
      }
      setTimeout(doFit, 30)
      try { term.focus() } catch { /* 不在前台 */ }

      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          clearTimeout(fitTimer)
          fitTimer = setTimeout(doFit, 140)
        })
        ro.observe(hostRef.current)
      }

      ctrl = new AbortController()
      const res = await fetch(API + '/term/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error('连接终端失败：HTTP ' + res.status)
      if (disposed) return
      setState('live')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let exited = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let at
        while ((at = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, at)
          buf = buf.slice(at + 1)
          if (!line.trim()) continue
          let ev
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.t === 'out') {
            try { term.write(String(ev.d ?? '')) } catch { /* 组件已卸载 */ }
          } else if (ev.t === 'exit') {
            exited = true
            try {
              term.write('\r\n\x1b[38;5;244m[进程已退出' + (ev.code != null ? '（' + ev.code + '）' : '') + ']\x1b[0m\r\n')
            } catch { /* ignore */ }
            setState('exited')
          }
        }
      }
      if (!disposed && !exited) setState('detached')
    })().catch((err) => {
      if (disposed) return
      setState('error')
      setError(String((err && err.message) || err))
    })

    return () => {
      disposed = true
      clearTimeout(inputTimer)
      clearTimeout(fitTimer)
      if (ctrl) { try { ctrl.abort() } catch { /* 已结束 */ } }
      if (ro) { try { ro.disconnect() } catch { /* ignore */ } }
      try { if (term) term.dispose() } catch { /* ignore */ }
      termRef.current = null
      inputRef.current = null
    }
  }, [sessionId, nonce])

  const restart = () => {
    ptyPost('/term/kill', { id: sessionId }).catch(() => {})
    setState('connecting')
    setNonce((n) => n + 1)
  }

  const label = {
    connecting: '连接中…', live: 'PTY', exited: '已退出', detached: '已断开', error: '连接失败',
  }[state] || 'PTY'

  return el('div', { className: 'pane-body term-body pty-body' },
    el('div', { className: 'term-bar' },
      el('span', { className: 'term-badge' + (state === 'live' ? ' on' : '') }, label),
      el('span', { className: 'term-cwd mono', title: info.cwd || project.path }, shortPath(info.cwd || project.path || '—', 34)),
      info.shell ? el('span', { className: 'term-shell mono', title: info.shell }, String(info.shell).split(/[\\/]/).pop()) : null,
      el('button', {
        type: 'button', className: 'mini-btn', title: '清屏（只清显示，进程还在）',
        onClick: () => { try { if (termRef.current) termRef.current.clear() } catch { /* ignore */ } },
      }, '清屏'),
      el('button', {
        type: 'button', className: 'mini-btn', title: '给前台进程发 Ctrl+C',
        onClick: () => { if (inputRef.current) inputRef.current('\u0003') },
      }, '中断 ^C'),
      el('button', {
        type: 'button', className: 'mini-btn', title: '关掉这个 shell，重新开一个',
        onClick: restart,
      }, '重启'),
    ),
    el('div', {
      className: 'xterm-host',
      ref: hostRef,
      onClick: () => { try { if (termRef.current) termRef.current.focus() } catch { /* ignore */ } },
    }),
    state === 'error'
      ? el('div', { className: 'term-hint' },
        el('p', null, '终端连不上：' + error),
        el('p', null, '点「重启」再试一次；如果一直失败，说明宿主进程里没有可用的 node-pty。'))
      : null,
  )
}

/* ============================ 主区：浏览器 ============================ */

const VIEWPORTS = [
  { id: 'auto', label: '自适应', width: 0 },
  { id: 'tablet', label: '平板 768', width: 768 },
  { id: 'mobile', label: '手机 375', width: 375 },
]

function copyText(text) {
  const run = async () => {
    try {
      await navigator.clipboard.writeText(String(text || ''))
      toast('已复制到剪贴板', 'ok')
    } catch {
      toast('复制失败：浏览器没给剪贴板权限', 'warn')
    }
  }
  run()
}

function webStateText(web) {
  if (web.state === 'loading') return '加载中…'
  if (web.state === 'blocked') return '嵌入被拒绝 / 无响应'
  if (web.state === 'ok') return '已加载' + (web.ms ? ' · ' + web.ms + 'ms' : '')
  if (web.state === 'error') return '加载失败'
  return '未加载'
}

/* 开发时真正会用到的几个端口：一键换，不用手打 */
const LOCAL_PORTS = [3000, 5173, 8080, 4173]

function localPortUrl(current, port) {
  try {
    const u = new URL(current || '/', 'http://localhost')
    return u.protocol + '//' + u.hostname + ':' + port + '/'
  } catch {
    return 'http://localhost:' + port + '/'
  }
}

export function WebPane({ project }) {
  useStore()
  const web = store.web
  const [draft, setDraft] = useState('')
  const more = !!web.more
  const menuRef = useRef(null)

  /* 切项目时把地址 / 历史 / 探测结果都换到那个项目上 */
  useEffect(() => { webSync(project) }, [project?.id])

  /* 点面板别处收起「更多」—— 否则它会一直盖在页面上 */
  useEffect(() => {
    if (!more) return undefined
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) webSetMore(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [more])

  const url = web.url
  const shown = draft || url
  const probe = web.probe
  const vp = VIEWPORTS.find((v) => v.id === web.viewport) || VIEWPORTS[0]
  const atStart = web.index <= 0
  const atEnd = web.index >= web.history.length - 1
  const extUrl = draft || url

  /* 像地址当地址开，不像地址（中文 / 带空格）就丢给搜索引擎 */
  const go = (raw) => { if (webGotoSmart(raw)) setDraft('') }
  /* 下拉里的动作点完就收起，别挡着页面 */
  const pick = (fn) => () => { webSetMore(false); fn() }

  const probeText = probe.state === 'loading' ? '探测中…'
    : probe.state === 'error' ? '探测失败：' + probe.error
      : probe.ok
        ? '✅ HTTP ' + (probe.status || '?') + ' · ' + probe.ms + 'ms'
          + (probe.title ? ' · ' + probe.title : '')
          + (probe.frameable ? ' · 可以嵌入' : ' · 不能嵌入（' + probe.reason + '）')
        : '❌ 连不上：' + (probe.error || '没有响应')

  return el('div', { className: 'pane-body web-body' },
    /*
     * 只有一条工具条：面板一窄，两行控件会折成三行，把 iframe 挤没。
     * 低频操作（探测 / 项目页 / 端口 / 视口 / 系统浏览器）全收进右边的「⋯」，
     * 主行永远只有 ← → ⟳ 地址 打开 状态点 ⋯。
     */
    el('div', { className: 'wb-bar' },
      el('button', {
        type: 'button',
        className: 'mini-btn' + (web.home ? ' on' : ''),
        title: '首页 / 搜索（不离开默认站点页也能搜）',
        onClick: () => (web.home ? webCloseHome() : webHome()),
      }, '🔍'),
      el('button', { type: 'button', className: 'mini-btn', title: '后退', disabled: atStart, onClick: () => webBack() }, '←'),
      el('button', { type: 'button', className: 'mini-btn', title: '前进', disabled: atEnd, onClick: () => webForward() }, '→'),
      el('button', {
        type: 'button', className: 'mini-btn' + (web.state === 'loading' ? ' on' : ''),
        title: '重新加载', onClick: () => webReload(),
      }, '⟳'),
      el('input', {
        className: 'mono wb-url', value: shown, spellCheck: false, autoComplete: 'off',
        placeholder: 'localhost:5173',
        draggable: 'true',
        title: '可把这个网址拖到顶栏「对话」区；也可以点右边的 💬',
        onDragStart: (ev) => { dragUrlPayload(ev, shown || url, web.title) },
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') go(draft || url)
          if (e.key === 'Escape') setDraft('')
        },
      }),
      el('button', { type: 'button', className: 'mini-btn wb-go', onClick: () => go(draft || url) }, '打开'),
      el('button', {
        type: 'button', className: 'mini-btn wb-to-chat', title: '把这个网页发到对话输入框',
        onClick: () => sendUrlToChat(draft || url || shown, web.title),
      }, '💬'),
      el('span', { className: 'wb-dot ' + web.state, title: webStateText(web), 'aria-hidden': 'true' }),
      el('button', {
        type: 'button',
        className: 'mini-btn wb-more-btn' + (more ? ' on' : ''),
        title: '更多：探测 / 项目页 / 端口 / 视口 / 系统浏览器',
        'aria-expanded': more ? 'true' : 'false',
        onClick: () => webSetMore(!more),
      }, '⋯'),
    ),

    el('div', { ref: menuRef, className: 'wb-more' + (more ? ' open' : '') },
      el('div', { className: 'wb-more-state ' + web.state }, webStateText(web)),
      el('div', { className: 'wb-more-row' },
        el('button', {
          type: 'button', className: 'mini-btn',
          title: '探测：服务在不在、能不能被 iframe 嵌',
          onClick: pick(() => webProbe(extUrl)),
        }, probe.state === 'loading' ? '探测中…' : '探测'),
        el('button', {
          type: 'button', className: 'mini-btn',
          title: '项目静态托管页（宿主 /site/<项目>/）',
          onClick: () => { setDraft(''); go(siteUrlOf(project)) },
        }, '项目页'),
        el('button', { type: 'button', className: 'mini-btn', title: '复制地址', onClick: () => copyText(url) }, '⧉ 复制'),
        el('button', {
          type: 'button', className: 'mini-btn',
          title: '用系统浏览器打开（iframe 被拒时唯一出路）',
          onClick: pick(() => webOpenExternal(extUrl)),
        }, '🚀 系统浏览器'),
      ),
      el('div', { className: 'wb-more-row' },
        el('span', { className: 'wb-more-label' }, '端口'),
        LOCAL_PORTS.map((p) => el('button', {
          key: p, type: 'button', className: 'mini-btn',
          title: '切到 ' + localPortUrl(url, p),
          onClick: () => { setDraft(''); go(localPortUrl(url, p)) },
        }, ':' + p)),
      ),
      el('div', { className: 'wb-more-row' },
        el('span', { className: 'wb-more-label' }, '视口'),
        VIEWPORTS.map((v) => el('button', {
          key: v.id, type: 'button',
          className: 'mini-btn' + (web.viewport === v.id ? ' on' : ''),
          title: '视口宽度：' + v.label,
          onClick: pick(() => webSetViewport(v.id)),
        }, v.label)),
      ),
    ),

    el('div', { className: 'wb-stage' },
      el('div', {
        className: 'wb-view' + (vp.width ? ' fixed' : ''),
        style: vp.width ? { width: vp.width + 'px' } : null,
      },
        web.state === 'blocked'
          ? el('div', { className: 'wb-fail' },
            el('span', { className: 'wb-fail-ico', 'aria-hidden': 'true' }, '⚠'),
            el('p', { className: 'wb-fail-title' }, '这个页面没能嵌进来'),
            el('p', { className: 'wb-fail-text' }, web.error || 'iframe 没有加载完成。'),
            el('p', { className: 'wb-fail-url mono' }, url),
            el('div', { className: 'wb-fail-acts' },
              el('button', { type: 'button', className: 'mini-btn', onClick: () => webReload() }, '重试'),
              el('button', { type: 'button', className: 'mini-btn', onClick: () => webProbe(url) }, '探测原因'),
              el('button', { type: 'button', className: 'mini-btn', onClick: () => copyText(url) }, '复制地址'),
              el('button', { type: 'button', className: 'mini-btn on', onClick: () => webOpenExternal(url) }, '🚀 系统浏览器打开'),
            ),
          )
          : web.home
            ? el('div', { className: 'wb-home-panel' },
              el('span', { className: 'pe-ico' }, '🔍'),
              el('p', { className: 'wb-home-title' }, '搜索，或直接输地址'),
              el('div', { className: 'wb-search' },
                el('input', {
                  className: 'wb-search-input', value: draft, spellCheck: false, autoComplete: 'off',
                  placeholder: '搜索点什么，或输 localhost:5173',
                  onChange: (e) => setDraft(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') { go(draft); webCloseHome() }
                    if (e.key === 'Escape') setDraft('')
                  },
                }),
                el('button', {
                  type: 'button', className: 'mini-btn wb-search-go',
                  title: '搜索（不像地址时交给搜索引擎）',
                  onClick: () => { go(draft); webCloseHome() },
                }, '搜索'),
              ),
              el('div', { className: 'wb-engines' },
                SEARCH_ENGINES.map((en) => el('button', {
                  key: en.id, type: 'button',
                  className: 'mini-btn' + ((store.web.engine || 'bing') === en.id ? ' on' : ''),
                  title: '用 ' + en.label + ' 搜索',
                  onClick: (e) => { e.preventDefault(); webSetEngine(en.id) },
                }, en.label)),
              ),
              url
                ? el('button', {
                  type: 'button', className: 'mini-btn', title: '回到当前页面',
                  onClick: () => webCloseHome(),
                }, '← 返回页面')
                : null,
            )
            : url
            ? el('iframe', {
              /* key 里带 at：点刷新时整个 iframe 重建，等于真刷新 */
              key: url + '|' + web.at,
              src: url,
              title: '浏览器',
              sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
              onLoad: () => webLoaded(),
            })
            : el('div', { className: 'pane-empty wb-home' },
              el('span', { className: 'pe-ico' }, '◍'),
              el('p', null, '浏览器窗格'),
              /* 首页搜索：回车即搜；下面一排是引擎切换 */
              el('div', { className: 'wb-search' },
                el('input', {
                  className: 'wb-search-input', value: draft, spellCheck: false, autoComplete: 'off',
                  placeholder: '搜索点什么，或直接输地址（localhost:5173）',
                  onChange: (e) => setDraft(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') go(draft)
                    if (e.key === 'Escape') setDraft('')
                  },
                }),
                el('button', {
                  type: 'button', className: 'mini-btn wb-search-go',
                  title: '搜索（不像地址时交给搜索引擎）',
                  onClick: () => go(draft),
                }, '搜索'),
              ),
              el('div', { className: 'wb-engines' },
                SEARCH_ENGINES.map((en) => el('button', {
                  key: en.id, type: 'button',
                  className: 'mini-btn' + ((store.web.engine || 'bing') === en.id ? ' on' : ''),
                  title: '用 ' + en.label + ' 搜索',
                  onClick: (e) => { e.preventDefault(); webSetEngine(en.id) },
                }, en.label)),
                el('span', { className: 'wb-engines-tip' }, '搜索页多半拒绝被嵌入，被拒时用「🚀 系统浏览器」'),
              ),
              el('ul', { className: 'wb-help' },
                el('li', null, '地址栏填端口（5173）、localhost:5173 或完整 http:// 地址都认，回车即开。'),
                el('li', null, '点右上「⋯」→ 探测：先确认服务活着、以及它允不允许被 iframe 嵌。'),
                el('li', null, '若被 X-Frame-Options / CSP 拒绝，会出一张说明卡，用「🚀 系统浏览器」打开。'),
              ),
            ),
        web.state === 'loading' ? el('div', { className: 'wb-loading', 'aria-hidden': 'true' }) : null,
      ),
    ),

    /* 探测结果才占一行；没探测过就不摆提示，把高度全留给页面 */
    probe.state !== 'idle'
      ? el('p', {
        className: 'wb-note ' + (probe.state === 'error' || !probe.ok ? 'warn' : (probe.frameable ? 'ok' : 'warn')),
        title: probeText,
      }, probeText)
      : null,
  )
}

/* ============================ 主区：自定义窗口 ============================ */

const CUSTOM_VIEWS = [
  { id: 'prompt', label: '✨ 生成' },
  { id: 'preview', label: '预览' },
  { id: 'edit', label: '编辑' },
]

/** 上一级目录（Windows / POSIX 都按最后一层截；盘符根保留成 C:） */
function parentDirOf(p) {
  const s = String(p || '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return i > 0 ? s.slice(0, i) : ''
}

/** 去掉扩展名的文件名，给「选文件后自动起名」用 */
function fileStemOf(p) {
  const s = String(p || '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return (i >= 0 ? s.slice(i + 1) : s).replace(/\.(html?|xhtml)$/i, '')
}

/** 目录列表里只留「目录 + 网页文件」：自定义窗口挑本地 html 用 */
export function webRowsOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r.dir || isHtmlFile(r.name))
}

/**
 * 挑一个本地网页。为什么自己画：<input type=file> 只给文件名，不给绝对路径，
 * 而宿主那边必须拿到绝对路径才能托管它（相对路径解析不了）。
 */
export function HtmlPick({ start, onPick, onClose }) {
  const [dir, setDir] = useState('')
  const [parent, setParent] = useState('')
  const [rows, setRows] = useState([])
  const [state, setState] = useState('idle')
  const [err, setErr] = useState('')

  const list = async (target) => {
    const t = String(target || '').trim()
    if (!t) { setState('empty'); return }
    setState('loading')
    setErr('')
    try {
      const data = await listMediaDir(t)
      setDir(data.path || t)
      setParent(data.parent || '')
      setRows(webRowsOf(data.entries))
      setState('ok')
    } catch (e) {
      setState('error')
      setErr(String((e && e.message) || e))
    }
  }

  useEffect(() => {
    if (String(start || '').trim()) list(start)
    else setState('empty')
  }, [])

  return el('div', { className: 'cu-pick' },
    el('div', { className: 'mb-head' },
      el('span', { className: 'mono mb-dir', title: dir || String(start || '') }, shortPath(dir || String(start || '') || '（先在上面填一个目录）', 44)),
      el('button', {
        type: 'button', className: 'mini-btn', title: '上一级',
        disabled: parent ? undefined : 'disabled', onClick: () => list(parent),
      }, '↑'),
      el('button', { type: 'button', className: 'mini-btn', title: '重新列一遍', onClick: () => list(dir || start) }, '↻'),
      el('button', { type: 'button', className: 'mini-btn', title: '收起', onClick: onClose }, '✕'),
    ),
    el('div', { className: 'mb-list' },
      state === 'empty'
        ? el('div', { className: 'th-empty' }, '先在上面填一个目录（默认是项目目录），再点「选文件」')
        : state === 'error'
          ? el('div', { className: 'th-empty' }, '列目录失败：' + err)
          : state === 'loading'
            ? el('div', { className: 'th-empty' }, '读取中…')
            : rows.length
              ? rows.slice(0, 200).map((r) => el('button', {
                key: r.name,
                type: 'button',
                className: 'mb-row' + (r.dir ? ' dir' : ''),
                title: r.dir ? '进入 ' + r.name : r.name,
                onClick: () => (r.dir ? list(joinPath(dir, r.name)) : onPick(joinPath(dir, r.name))),
              },
                el('span', { className: 'mb-ico' }, r.dir ? '📁' : '🌐'),
                el('span', { className: 'mb-name' }, r.name),
                el('span', { className: 'mb-size mono' }, r.dir ? '' : fmtSize(r.size || 0)),
              ))
              : el('div', { className: 'th-empty' }, '这个目录里没有 .html / .htm 文件'),
    ),
  )
}

export function CustomPane({ project }) {
  useStore()
  const cu = store.custom
  const draft = cu.draft
  const requirement = cu.requirement || ''
  const [targetPid, setTargetPid] = useState(project?.id || '')
  const [nonce, setNonce] = useState(0)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (store.custom.state === 'idle') loadCustom()
  }, [])

  useEffect(() => {
    if (project?.id) setTargetPid((cur) => cur || project.id)
  }, [project?.id])

  const projects = (store.projects || []).filter((p) => !p.hidden)
  const targetProject = projects.find((p) => p.id === targetPid) || project || null
  const body = draft ? String(draft.body || '') : ''
  const isUrl = draft?.kind === 'url'
  const isFile = draft?.kind === 'file'
  const isNew = !!draft && !draft.id
  const dirty = !!draft && !!cu.item && (draft.name !== cu.item.name || draft.body !== cu.item.body || draft.kind !== cu.item.kind)

  const makePrompt = () => {
    const text = buildCustomPrompt(targetProject, requirement, draft?.name || '')
    if (!text) { toast('先写一句需求', 'warn'); return }
    setCustomPrompt(text)
  }

  const sendToHost = () => {
    const text = cu.prompt || buildCustomPrompt(targetProject, requirement, draft?.name || '')
    if (!text) { toast('先写一句需求', 'warn'); return }
    if (fillHostInput(text)) toast('已填进右侧对话输入框，回车发送即可', 'ok')
    else {
      copyText(text)
      toast('没找到宿主输入框：提示词已复制，粘到右侧对话里即可', 'warn')
    }
  }

  const pasteResult = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) { toast('剪贴板是空的', 'warn'); return }
      /* AI 爱把 HTML 包在 ```html 围栏里，粘进来顺手剥掉 */
      const clean = String(text).replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n```\s*$/, '')
      editCustom({ body: clean })
      setCustomView('preview')
      setNonce((n) => n + 1)
      toast('已从剪贴板粘入，别忘了「保存」', 'ok')
    } catch {
      toast('读不到剪贴板，手动切到「编辑」粘贴吧', 'warn')
    }
  }

  /* 切走会丢未保存的改动：问一句，别默默吃掉 */
  const guardDirty = () => {
    if (!dirty) return true
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm('当前改动还没保存，继续就会丢掉。确定？')
    }
    return true
  }

  const openNew = (kind, view) => {
    if (!guardDirty()) return
    newCustomDraft(kind, view)
    /* 记一下是哪个项目里建的，方便以后按项目分组 */
    if (project?.id) editCustom({ pid: project.id })
    setNonce((n) => n + 1)
  }

  if (cu.state === 'loading' && !cu.items.length) {
    return el('div', { className: 'pane-body' }, el('p', { className: 'wt-mute' }, '读取自定义窗口…'))
  }

  if (cu.state === 'error' && !cu.items.length) {
    return el('div', { className: 'pane-body' },
      el('div', { className: 'pane-error' },
        el('p', null, '自定义窗口读不出来：' + cu.error),
        el('p', { className: 'hint' }, '这个功能把内容存在 DSH 主目录的 worktable-custom.json 里，读写失败通常是权限或磁盘问题。'),
        el('div', { className: 'ed-note-acts' },
          el('button', { type: 'button', className: 'btn small', onClick: () => loadCustom() }, '重试'),
          el('button', { type: 'button', className: 'mini-btn', onClick: () => openNew('html', 'edit') }, '不用库，直接写一个'),
        ),
      ),
    )
  }

  /* ---------- 主体内容（三种视图） ---------- */

  let stage
  if (!draft) {
    stage = el('div', { className: 'pane-empty' },
      el('span', { className: 'pe-ico' }, '❖'),
      el('p', null, '自定义窗口'),
      el('p', { className: 'hint' }, '把常用的小工具做成工作台里的一个窗格：一句话描述让 AI 写、自己贴一段 HTML，或者直接指向磁盘上的一个 .html 文件。内容存在本机 DSH 主目录，不写进项目仓库。'),
      el('div', { className: 'pe-actions' },
        el('button', { type: 'button', className: 'btn small', onClick: () => openNew('html') }, '✨ 新建一个'),
        el('button', { type: 'button', className: 'mini-btn', onClick: () => loadCustom() }, '⟳ 重新读取'),
      ),
      cu.items.length
        ? el('p', { className: 'hint' }, '左边有 ' + cu.items.length + ' 个已保存的窗口，点一下就能看。')
        : null,
    )
  } else if (cu.view === 'prompt') {
    stage = el('div', { className: 'cu-card' },
      el('span', { className: 'cu-card-title' }, '✨ 描述你想要的窗口'),
      el('p', { className: 'cu-hint' },
        '写一句需求 → 生成提示词 → 填进右侧对话输入框。AI 给出 HTML 后，切到「编辑」贴进来再保存，就成这个窗格了。'),
      el('textarea', {
        className: 'cu-input',
        value: requirement,
        autoFocus: true,
        placeholder: '例如：做一个读 package.json 的脚本速查卡，列出所有 npm run 命令，点一下复制',
        onChange: (e) => setCustomRequirement(e.target.value),
        onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'enter') makePrompt() },
      }),
      el('div', { className: 'cu-row' },
        el('span', { className: 'cu-label' }, '项目'),
        projects.length
          ? el('select', {
            className: 'cu-select', value: targetPid,
            onChange: (e) => setTargetPid(e.target.value),
          }, projects.map((p) => el('option', { key: p.id, value: p.id }, p.alias || p.name)))
          : el('span', { className: 'cu-label' }, '（还没有项目）'),
      ),
      el('div', { className: 'cu-acts' },
        el('button', { type: 'button', className: 'btn small', onClick: makePrompt }, '生成提示词'),
        el('button', { type: 'button', className: 'mini-btn', disabled: !cu.prompt, onClick: () => copyText(cu.prompt) }, '复制'),
        el('button', { type: 'button', className: 'mini-btn on', title: '写进右侧对话的输入框，不替你发送', onClick: sendToHost }, '✨ 填到对话输入框'),
        el('button', { type: 'button', className: 'mini-btn', title: '把剪贴板里的 HTML 贴进来', onClick: pasteResult }, '⤓ 粘贴结果'),
      ),
      cu.prompt
        ? el('textarea', { className: 'cu-prompt mono', readOnly: true, value: cu.prompt, spellCheck: false })
        : null,
    )
  } else if (cu.view === 'preview') {
    stage = body
      ? el('div', { className: 'cu-preview' },
        isFile
          ? el('iframe', {
            key: 'f' + nonce + ':' + body,
            src: htmlUrl(body),
            title: draft.name || '自定义窗口',
            sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-downloads',
          })
          : isUrl
            ? el('iframe', {
              key: 'u' + nonce,
              src: body,
              title: draft.name || '自定义窗口',
              sandbox: 'allow-scripts allow-forms allow-popups allow-same-origin',
            })
            : el('iframe', {
              key: 'h' + nonce + ':' + body.length,
              srcDoc: body,
              title: draft.name || '自定义窗口',
              sandbox: 'allow-scripts allow-forms allow-modals',
            }),
      )
      : el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '◇'),
        el('p', null, isFile ? '还没选网页文件' : isUrl ? '还没填地址' : '还没有内容'),
        el('p', { className: 'hint' },
          isFile
            ? '切到「编辑」点「选文件」，挑一个磁盘上的 .html。'
            : isUrl
              ? '切到「编辑」填一个 http/https 地址。'
              : '切到「编辑」写点 HTML，或者用「生成」让 AI 来做。'),
      )
  } else {
    stage = isFile
      ? el('div', { className: 'cu-urlbox' },
        el('p', { className: 'cu-hint' },
          '填一个本地网页的绝对路径，或点「选文件」挑。预览时由 /asset 托管：同目录下的 css / js / 图片会一起加载。'),
        el('div', { className: 'cu-filebar' },
          el('input', {
            className: 'mono cu-url', value: body, spellCheck: false,
            placeholder: 'C:\\projects\\demo\\index.html',
            onChange: (e) => editCustom({ body: e.target.value }),
          }),
          el('button', {
            type: 'button', className: 'mini-btn' + (picking ? ' on' : ''),
            title: '在本机挑一个 .html 文件',
            onClick: () => setPicking((v) => !v),
          }, '选文件…'),
          el('button', {
            type: 'button', className: 'mini-btn', disabled: !body, title: '刷新预览',
            onClick: () => { setCustomView('preview'); setNonce((n) => n + 1) },
          }, '预览'),
        ),
        picking
          ? el(HtmlPick, {
            start: body ? parentDirOf(body) : (workspaceDirOf(project) || ''),
            onPick: (picked) => {
              const patch = { body: picked }
              if (!String(draft.name || '').trim()) patch.name = fileStemOf(picked)
              editCustom(patch)
              setPicking(false)
              setCustomView('preview')
              setNonce((n) => n + 1)
            },
            onClose: () => setPicking(false),
          })
          : null,
        el('p', { className: 'cu-hint' },
          '页面在沙箱里跑：脚本能正常执行，但拿不到插件接口的同源身份（localStorage 会被禁用）。'),
      )
      : isUrl
        ? el('div', { className: 'cu-urlbox' },
          el('p', { className: 'cu-hint' }, '窗口内容就是这个网址（iframe 嵌入）。跨域页面若带 X-Frame-Options，同样会白屏 —— 可以先回「生成」页用浏览器窗格探测。'),
          el('input', {
            className: 'mono cu-url', value: body, spellCheck: false, placeholder: 'https://example.com/dashboard',
            onChange: (e) => editCustom({ body: e.target.value }),
          }),
        )
        : el('textarea', {
          className: 'cu-code mono',
          spellCheck: false,
          value: body,
          placeholder: '<!-- 一段自包含的 HTML：可以带 <style> / <script> -->',
          onChange: (e) => editCustom({ body: e.target.value }),
          onKeyDown: (e) => {
            if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); saveCustom() }
          },
        })
  }

  return el('div', { className: 'pane-body cu-body' },
    el('div', { className: 'cu-side' },
      el('div', { className: 'cu-side-head' },
        el('span', null, '窗口'),
        el('button', { type: 'button', className: 'mini-btn', title: '新建', onClick: () => openNew('html', 'edit') }, '＋'),
      ),
      el('div', { className: 'cu-list' },
        cu.items.length
          ? cu.items.map((it) => el('div', {
            key: it.id,
            className: 'cu-item' + (it.id === cu.active ? ' on' : ''),
            role: 'button',
            title: it.id,
            onClick: () => { if (guardDirty()) { openCustom(it.id); setNonce((n) => n + 1) } },
          },
            el('span', { className: 'cu-item-ico', 'aria-hidden': 'true' }, it.kind === 'url' ? '◍' : (it.kind === 'file' ? '❐' : '❖')),
            el('span', { className: 'cu-item-name' }, it.name),
          ))
          : el('p', { className: 'cu-empty' }, '还没有保存过'),
      ),
      el('div', { className: 'cu-side-foot' },
        el('button', { type: 'button', className: 'mini-btn', onClick: () => openNew('html', 'edit') }, '＋ 自己写'),
        el('button', { type: 'button', className: 'mini-btn', onClick: () => openNew('url', 'edit') }, '＋ 网址'),
        el('button', {
          type: 'button', className: 'mini-btn',
          title: '指向磁盘上的一个 .html 文件（相对路径的 css / js / 图片会一起加载）',
          onClick: () => openNew('file', 'edit'),
        }, '＋ 网页文件'),
      ),
    ),

    el('div', { className: 'cu-main' },
      el('div', { className: 'cu-bar' },
        el('input', {
          className: 'cu-name',
          value: draft ? String(draft.name || '') : '',
          placeholder: isNew ? '给这个窗口起个名字' : '窗口名',
          spellCheck: false,
          onChange: (e) => editCustom({ name: e.target.value }),
        }),
        dirty ? el('span', { className: 'tag warn' }, '未保存') : null,
        isNew && draft ? el('span', { className: 'tag' }, '新建') : null,
        el('div', { className: 'cu-views' },
          CUSTOM_VIEWS.map((v) => el('button', {
            key: v.id, type: 'button',
            className: 'mini-btn' + (cu.view === v.id ? ' on' : ''),
            onClick: () => { setCustomView(v.id); if (v.id === 'preview') setNonce((n) => n + 1) },
          }, v.label)),
        ),
        el('button', {
          type: 'button', className: 'mini-btn on',
          disabled: !draft || cu.busy === 'saving',
          title: '保存 (Ctrl+S)',
          onClick: () => saveCustom(),
        }, cu.busy === 'saving' ? '保存中…' : '保存'),
        el('button', {
          type: 'button', className: 'mini-btn danger',
          disabled: !cu.item || cu.busy === 'deleting',
          title: '从库里删掉这个窗口',
          onClick: () => deleteCustom(cu.active),
        }, cu.busy === 'deleting' ? '删除中…' : '删除'),
      ),

      el('div', { className: 'cu-stage' }, stage),

      el('div', { className: 'cu-foot' },
        cu.file ? el('span', { className: 'mono', title: cu.file }, '库：' + shortPath(cu.file, 46)) : null,
        cu.item
          ? el('span', { className: 'mono', title: cu.item.body },
            cu.item.id + ' · ' + (cu.item.kind === 'url' ? '网址' : (cu.item.kind === 'file' ? '网页文件' : 'HTML')) + ' · ' + fmtSize(body.length))
          : null,
        cu.error ? el('span', { className: 'cu-err' }, cu.error) : null,
      ),
    ),
  )
}

/* ============================ 媒体（图片 / PDF / 音视频） ============================ */

/** 按扩展名决定怎么渲染；不属于媒体就没有对应的标签 */
function mediaTagOf(kind) {
  if (kind === 'image') return 'img'
  if (kind === 'pdf') return 'frame'
  if (kind === 'video') return 'video'
  if (kind === 'audio') return 'audio'
  return ''
}

export function MediaPane({ project }) {
  useStore()
  const pushed = store.media && store.media.pid === project.id ? store.media.path : ''
  const startDir = pushed || workspaceDirOf(project) || ''
  const [path, setPath] = useState(pushed || '')
  const [draft, setDraft] = useState(pushed || '')
  const [failed, setFailed] = useState('')
  const [tip, setTip] = useState('')
  /* 选择文件：本地（object URL，不上传不写盘）或项目里浏览 */
  const [browse, setBrowse] = useState(false)
  const [dir, setDir] = useState('')
  const [rows, setRows] = useState([])
  const [dirState, setDirState] = useState('idle')
  const [dirErr, setDirErr] = useState('')
  const [objUrl, setObjUrl] = useState('')
  const [localName, setLocalName] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (pushed && pushed !== path) { setPath(pushed); setDraft(pushed); setFailed('') }
  }, [pushed])

  const kind = objUrl ? kindOfMediaPath(localName) : (path ? kindOfMediaPath(path) : '')
  const tag = mediaTagOf(kind)
  const src = objUrl || (path ? rawUrl(path) : '')

  const explain = async (u) => {
    try {
      const res = await fetch(u, { headers: { accept: '*/*' } })
      if (res.ok) {
        setFailed('资源拿到了（HTTP 200），但浏览器没能显示它；可以点下面「在新标签页打开」看看')
        return
      }
      const ct = String(res.headers.get('content-type') || '')
      let detail = ''
      if (ct.includes('json')) {
        const j = await res.json().catch(() => null)
        detail = (j && (j.error || j.code)) || ''
      }
      setFailed('HTTP ' + res.status + (detail ? '：' + detail : ''))
    } catch (err) {
      setFailed('取不到这个文件：' + String((err && err.message) || err))
    }
  }

  const listDir = async (target) => {
    const t = String(target || '').trim()
    if (!t) { setDirErr('没有可浏览的目录：给项目填个目录'); setDirState('error'); return }
    setDirState('loading')
    setDirErr('')
    try {
      const data = await listMediaDir(t)
      setDir(data.path || t)
      setRows(Array.isArray(data.entries) ? data.entries : [])
      setDirState('ok')
    } catch (err) {
      setDirState('error')
      setDirErr(String((err && err.message) || err))
    }
  }

  const toggleBrowse = () => {
    const next = !browse
    setBrowse(next)
    if (next && dirState !== 'ok') listDir(dir || startDir)
  }

  /* 本地文件：只用 object URL 预览，路径无从得知（浏览器不给） */
  const takeLocal = (file) => {
    if (!file) return
    const ok = /^(image|video|audio)\//i.test(String(file.type || '')) || /\.(pdf|svg)$/i.test(file.name)
    if (!ok) { setTip('只能选 图片 / PDF / 视频 / 音频'); return }
    setTip('')
    setFailed('')
    setPath('')
    setLocalName(file.name)
    try {
      setObjUrl(typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '')
    } catch { setObjUrl('') }
    setDraft(file.name)
  }

  const open = (v) => {
    const next = String(v || '').trim().replace(/^["']+|["']+$/g, '').trim()
    if (!next) { setTip('先填一个文件路径，或点「选择文件」'); return }
    setTip('')
    setFailed('')
    setObjUrl('')
    setLocalName('')
    setPath(next)
    setDraft(next)
  }

  const pickRow = (row) => {
    const full = joinPath(dir, row.name)
    if (row.dir) { listDir(full); return }
    setDirErr('')
    open(full)
  }

  const mediaRows = mediaRowsOf(rows)

  return el('div', {
    className: 'pane-body media-pane',
    onDragOver: (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault() },
    onDrop: (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (!f) return
      e.preventDefault()
      takeLocal(f)
    },
  },
    el('div', { className: 'media-bar' },
      el('input', {
        className: 'media-input mono',
        value: draft,
        placeholder: '绝对路径，或点「选择文件」/「浏览项目」',
        spellCheck: false,
        onChange: (e) => { setDraft(e.target.value); setTip('') },
        onKeyDown: (e) => { if (e.key === 'Enter') open(draft) },
      }),
      el('button', { type: 'button', className: 'mini-btn', title: '预览这个文件', onClick: () => open(draft) }, '预览'),
      el('button', {
        type: 'button', className: 'mini-btn', title: '从本机选一个图片 / PDF / 音视频（只在本页预览，不上传）',
        onClick: () => { if (fileRef.current) fileRef.current.click() },
      }, '选择文件'),
      el('button', {
        type: 'button', className: 'mini-btn' + (browse ? ' on' : ''),
        title: '在项目目录里挑文件（能预览缩略图）',
        onClick: toggleBrowse,
      }, '浏览项目'),
      path
        ? el('button', { type: 'button', className: 'mini-btn', title: '用系统程序打开', onClick: () => revealPath(path, { select: false }) }, '系统打开')
        : null,
      el('input', {
        ref: fileRef, type: 'file', accept: 'image/*,video/*,audio/*,.pdf,.svg', style: { display: 'none' },
        onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) takeLocal(f) },
      }),
    ),
    tip ? el('div', { className: 'media-tip' }, tip) : null,
    localName ? el('div', { className: 'media-tip' }, '本地文件：' + localName + '（只在当前页预览；要写进项目请用「浏览项目」选磁盘路径）') : null,

    browse
      ? el('div', { className: 'media-browse' },
        el('div', { className: 'mb-head' },
          el('span', { className: 'mono mb-dir', title: dir || startDir }, shortPath(dir || startDir || '（未设置目录）', 46)),
          el('button', { type: 'button', className: 'mini-btn', title: '上一级', onClick: () => listDir(parentOf(dir || startDir)) }, '↑'),
          el('button', { type: 'button', className: 'mini-btn', title: '重新列一遍', onClick: () => listDir(dir || startDir) }, '↻'),
          el('button', { type: 'button', className: 'mini-btn', title: '关闭浏览', onClick: () => setBrowse(false) }, '✕'),
        ),
        dirState === 'error'
          ? el('div', { className: 'th-empty' }, '列目录失败：' + dirErr)
          : dirState === 'loading'
            ? el('div', { className: 'th-empty' }, '读取中…')
            : mediaRows.length
              ? el('div', { className: 'mb-list' },
                mediaRows.slice(0, 200).map((r) => el('button', {
                  key: r.name, type: 'button',
                  className: 'mb-row' + (r.dir ? ' dir' : ''),
                  title: r.dir ? '进入 ' + r.name : r.name,
                  onClick: () => pickRow(r),
                },
                  el('span', { className: 'mb-ico' }, r.dir ? '📁' : kindEmoji(kindOfMediaPath(r.name))),
                  el('span', { className: 'mb-name' }, r.name),
                  el('span', { className: 'mb-size mono' }, r.dir ? '' : fmtSize(r.size || 0)),
                )),
              )
              : el('div', { className: 'th-empty' }, '这个目录里没有可预览的媒体文件（图片 / PDF / 音视频 / SVG）'),
      )
      : null,

    src && tag
      ? el('div', { className: 'media-stage' },
        tag === 'img'
          ? el('img', {
            key: src, className: 'media-img', src, alt: kind,
            onError: () => explain(src), onLoad: () => setFailed(''),
          })
          : tag === 'frame'
            ? el('iframe', { key: src, className: 'media-frame', src, title: 'PDF 预览' })
            : tag === 'video'
              ? el('video', { key: src, className: 'media-player', src, controls: true, preload: 'metadata', onError: () => explain(src) })
              : el('audio', { key: src, className: 'media-player', src, controls: true, preload: 'metadata', onError: () => explain(src) }),
        failed
          ? el('div', { className: 'media-err' },
            el('span', null, failed),
            el('a', { className: 'media-open', href: src, target: '_blank', rel: 'noreferrer' }, '在新标签页打开'),
          )
          : null,
      )
      : el('div', { className: 'media-empty' },
        el('span', { className: 'pe-ico' }, '🖼'),
        el('p', null, path ? '这个扩展名不支持内嵌预览' : '还没有选文件'),
        el('p', { className: 'hint' },
          path
            ? '这个类型没有内嵌预览：点「系统打开」交给系统程序，或把 .html 交给自定义窗口。'
            : '三种选法：点「选择文件」从本机挑、点「浏览项目」在项目目录里挑、或直接粘绝对路径。也可以把文件拖进来。'),
        el('div', { className: 'pe-actions' },
          el('button', { type: 'button', className: 'btn small', onClick: () => { if (fileRef.current) fileRef.current.click() } }, '选择文件'),
          el('button', { type: 'button', className: 'btn small', onClick: toggleBrowse }, '浏览项目'),
        ),
        path ? el('div', { className: 'media-url mono' }, src) : null,
      ),
  )
}

/** 目录列表里只留「目录 + 可内嵌预览的媒体文件」 */
export function mediaRowsOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r.dir || ['image', 'pdf', 'video', 'audio'].includes(kindOfMediaPath(r.name)))
}

/** 上一级目录（Windows / POSIX 都按最后一层截） */
function parentOf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return i > 0 ? s.slice(0, i) : ''
}

/** 媒体窗自己判类型：SVG 也算图片（编辑器把它归类成 code） */
export function kindOfMediaPath(p) {
  const name = String(p || '').split(/[\\/]/).pop() || ''
  if (/\.svg$/i.test(name)) return 'image'
  return viewKindOf(name)
}

export function NotesPane({ project }) {
  useStore()
  const saved = project ? (project.note || '') : ''
  const [draft, setDraft] = useState(saved)
  const [at, setAt] = useState(0)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setDraft(project ? (project.note || '') : '')
    setDirty(false)
    setAt(0)
  }, [project && project.id])

  if (!project) return null

  const save = () => {
    updateProject(project.id, { note: draft })
    setDirty(false)
    setAt(Date.now())
    toast('笔记已保存', 'ok')
  }

  const words = String(draft || '').trim().length

  return el('div', { className: 'pane-body notes-pane' },
    el('div', { className: 'notes-bar' },
      el('span', { className: 'notes-title' }, '✎ ' + (project.alias || project.name) + ' 的笔记'),
      el('span', { className: 'notes-stat mono' }, words + ' 字' + (dirty ? ' · 有未保存改动' : '') + (at ? ' · 已保存 ' + relTime(at) : '')),
      el('button', {
        type: 'button', className: 'mini-btn', title: '清空笔记',
        onClick: () => { setDraft(''); setDirty(true) },
      }, '清空'),
      el('button', {
        type: 'button', className: 'btn small primary', title: '保存到项目（Ctrl+S）',
        onClick: save,
      }, '保存'),
    ),
    el('textarea', {
      className: 'notes-area mono',
      value: draft,
      spellCheck: false,
      placeholder: '随手记：这个项目要做什么、卡在哪、下一步…（保存到项目的 note 字段，跟着项目走）',
      onChange: (e) => { setDraft(e.target.value); setDirty(true) },
      onBlur: () => { if (dirty) save() },
      onKeyDown: (e) => {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); save() }
      },
    }),
  )
}
