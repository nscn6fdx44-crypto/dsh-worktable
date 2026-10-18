/**
 * 窗格：文件浏览 / 项目信息 / 编辑器 / 终端 / 浏览器 / 自定义。
 * 全部是工作区里的标签页，没有独立左栏；对话也不在这里 —— 右栏就是宿主自己的会话区（见 hostdock.js）。
 * 每个窗格只读 store 的对应切片，动作全部来自 core。
 */
import { useState, useEffect, useRef } from 'react'
import { el, Icon, Light } from './ui.js'
import {
  store, useStore, STATES, normState, fmtSize, fmtDuration, relTime, shortPath, projEmoji,
  loadTree, openFile, editText, saveFile, termExec, termKill, termClear, loadGit,
  workspaceDirOf, samePath, revealPath,
  sessionsOf, primarySession, stateOf, jumpToSession,
  openModal, siteUrlOf, setWebUrl, setCustomHtml, cycleStatus, updateProject, projectOf, toast,
} from './core.js'

/* ============================ 文件 / 项目信息（标签页） ============================ */

export function InfoPane({ project }) {
  useStore()
  const st = stateOf(project.id)
  const bound = sessionsOf(project)
  const git = store.git

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

    el('div', { className: 'info-actions' },
      el('button', { type: 'button', className: 'btn small', onClick: () => openModal('edit', project.id) }, '编辑信息'),
      el('button', { type: 'button', className: 'btn small', onClick: () => openModal('bind', project.id) }, '对话绑定'),
      el('button', { type: 'button', className: 'btn small', onClick: () => cycleStatus(project.id) }, '切换状态'),
    ),

    el('div', { className: 'sec-head' },
      el('span', null, 'Git'),
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

/* ============================ 文件管理器（系统窗口） ============================ */

/**
 * 文件管理器：**不再自己画目录树**，直接交给系统的文件管理器（Windows 资源管理器）。
 * 点「🗂 文件管理器」标签页时 core.openTab 已经弹过一次；这里只留路径、
 * 说明和「再打开一次」的按钮，外加一个任意路径的入口。
 */
export function FilesPane({ project }) {
  useStore()
  const [pathInput, setPathInput] = useState('')
  const [opening, setOpening] = useState('')

  const workDir = workspaceDirOf(project)
  const projDir = String(project.path || '')
  const primary = primarySession(project)
  const cur = opening || workDir

  const open = async (dir) => {
    const target = String(dir || '').trim()
    if (!target) return
    setOpening(target)
    const ok = await revealPath(target)
    if (!ok) setOpening('')
  }
  const enter = () => { const p = pathInput.trim(); if (p) { open(p); setPathInput('') } }

  return el('div', { className: 'pane-body files-body files-sys' },
    el('div', { className: 'sfc' },
      el('div', { className: 'sfc-ico', 'aria-hidden': 'true' }, '📂'),
      el('h3', { className: 'sfc-title' }, '文件浏览在系统窗口里'),
      el('p', { className: 'sfc-path mono', title: cur }, cur || '（没有可打开的目录）'),
      el('p', { className: 'sfc-hint' }, primary && primary.cwd
        ? '跟随对话：' + (primary.title || primary.id) + ' · ' + primary.cwd
        : '这个项目还没绑定对话，用项目目录'),
      el('div', { className: 'sfc-actions' },
        el('button', { type: 'button', className: 'btn primary', onClick: () => open(workDir) }, '📂 在系统文件管理器中打开'),
        projDir && !samePath(projDir, workDir)
          ? el('button', { type: 'button', className: 'btn', onClick: () => open(projDir) }, '📁 打开项目目录')
          : null,
      ),
      el('div', { className: 'sfc-jump' },
        el('input', {
          className: 'mono', value: pathInput, autoComplete: 'off',
          placeholder: '也可以输入任意绝对路径，回车用系统窗口打开…',
          onChange: (e) => setPathInput(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') enter() },
        }),
      ),
      el('p', { className: 'sfc-note' }, '再点一次「🗂 文件管理器」标签页会重新打开系统窗口；这个标签页不再自己画目录树。'),
    ),
  )
}

function fileEmoji(name) {
  if (/\.(md|markdown|txt)$/i.test(name)) return '📄'
  if (/\.(js|mjs|cjs|ts|jsx|tsx|vue|svelte)$/i.test(name)) return '🟨'
  if (/\.(py)$/i.test(name)) return '🐍'
  if (/\.(json|yml|yaml|toml|ini)$/i.test(name)) return '⚙️'
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(name)) return '🖼️'
  if (/\.(html|htm|css|scss)$/i.test(name)) return '🎨'
  return '·'
}

function joinPath(base, name) {
  const b = String(base || '')
  if (!b) return name
  const sep = b.includes('\\') ? '\\' : '/'
  return b.replace(/[\\/]+$/, '') + sep + name
}

/* ============================ 主区：编辑器 ============================ */

export function EditorPane({ project }) {
  useStore()
  const ed = store.editor
  const dirty = ed.state === 'ok' && ed.text !== ed.saved
  const area = useRef(null)
  const [openPath, setOpenPath] = useState('')
  const doOpen = () => {
    const p = openPath.trim()
    if (!p) return
    openFile(p, project?.id)
    setOpenPath('')
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) saveFile()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dirty])

  if (ed.state === 'idle') {
    return el('div', { className: 'pane-body' },
      el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '◆'),
        el('p', null, '还没有打开文件'),
        el('p', { className: 'hint' }, '填一个文件绝对路径直接打开（文件管理器现在走系统窗口）；Ctrl+S 保存到磁盘。'),
        el('div', { className: 'ed-open' },
          el('input', {
            className: 'mono', value: openPath, autoComplete: 'off',
            placeholder: 'C:\\projects\\demo\\README.md',
            onChange: (e) => setOpenPath(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') doOpen() },
          }),
          el('button', { type: 'button', className: 'btn small', onClick: doOpen }, '打开'),
        ),
      ),
    )
  }

  return el('div', { className: 'pane-body editor-body' },
    el('div', { className: 'ed-bar' },
      el('span', { className: 'ed-name mono', title: ed.path }, ed.name + (dirty ? ' ●' : '')),
      ed.size ? el('span', { className: 'ed-meta mono' }, fmtSize(ed.size)) : null,
      ed.truncated ? el('span', { className: 'tag' }, '已截断') : null,
      ed.state === 'ok'
        ? el('button', {
          type: 'button', className: 'mini-btn' + (dirty ? ' on' : ''),
          title: '保存到磁盘 (Ctrl+S)', onClick: () => saveFile(),
        }, ed.saving ? '保存中…' : '保存')
        : null,
      el('button', { type: 'button', className: 'mini-btn', title: '重新载入', onClick: () => openFile(ed.path, project?.id) }, '重载'),
    ),
    ed.state === 'loading'
      ? el('p', { className: 'wt-mute' }, '读取中…')
      : ed.state === 'error'
        ? el('div', { className: 'pane-error' },
          el('p', null, ed.error),
          el('button', { type: 'button', className: 'btn small', onClick: () => openFile(ed.path, project?.id) }, '重试'),
        )
        : el('textarea', {
          ref: area,
          className: 'ed-area mono',
          spellCheck: false,
          value: ed.text,
          onChange: (e) => editText(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.target
              const at = t.selectionStart
              editText(ed.text.slice(0, at) + '  ' + ed.text.slice(t.selectionEnd))
            }
          },
        }),
  )
}

/* ============================ 主区：终端 ============================ */

export function TermPane({ project }) {
  useStore()
  const term = store.terms[project.id] || { lines: [], busy: false, cwd: '', history: [] }
  const [input, setInput] = useState('')
  const [hidx, setHidx] = useState(-1)
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
        ),
    ),
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

/* ============================ 主区：浏览器 ============================ */

export function WebPane({ project }) {
  useStore()
  const web = store.web
  const defaultUrl = siteUrlOf(project)
  const [draft, setDraft] = useState('')
  const url = web.url || defaultUrl

  const go = (raw) => {
    let next = String(raw || '').trim()
    if (!next) return
    if (!/^https?:\/\//i.test(next) && !next.startsWith('/')) next = 'http://' + next
    setWebUrl(next)
  }
  const reload = () => setWebUrl(url)

  return el('div', { className: 'pane-body web-body' },
    el('div', { className: 'web-bar' },
      el('button', { type: 'button', className: 'mini-btn', title: '刷新', onClick: reload }, '⟳'),
      el('input', {
        className: 'mono', value: draft || url, spellCheck: false,
        placeholder: 'http://localhost:3000',
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') { go(draft || url); setDraft('') } },
      }),
      el('button', { type: 'button', className: 'mini-btn', onClick: () => go(draft || url) }, '打开'),
      el('button', { type: 'button', className: 'mini-btn', title: '恢复项目静态站点', onClick: () => { setDraft(''); setWebUrl('') } }, '项目页'),
    ),
    el('div', { className: 'web-frame' },
      url
        ? el('iframe', { src: url, title: '浏览器', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' })
        : el('div', { className: 'pane-empty' },
          el('span', { className: 'pe-ico' }, '◍'),
          el('p', null, '浏览器窗格'),
          el('p', { className: 'hint' }, '默认打开项目的静态托管地址（宿主 /api/trae-worktable/site/<项目>/）。也可以填本地开发服务器地址，例如 http://localhost:5173。'),
        ),
    ),
    el('p', { className: 'web-note' }, '提示：本地开发服务器页面在 iframe 里可能因 X-Frame-Options 拒绝加载，此时请用系统浏览器打开。'),
  )
}

/* ============================ 主区：自定义窗口 ============================ */

export function CustomPane() {
  useStore()
  const html = store.custom.html
  const [draft, setDraft] = useState(html)
  const [applied, setApplied] = useState(html)

  const apply = () => { setCustomHtml(draft); setApplied(draft) }

  return el('div', { className: 'pane-body custom-body' },
    el('div', { className: 'custom-split' },
      el('div', { className: 'custom-editor' },
        el('div', { className: 'ed-bar' },
          el('span', { className: 'ed-name' }, '自定义 HTML'),
          el('button', { type: 'button', className: 'mini-btn on', onClick: apply }, '运行'),
          el('button', { type: 'button', className: 'mini-btn', onClick: () => { setDraft(''); apply() } }, '清空'),
        ),
        el('textarea', {
          className: 'ed-area mono', spellCheck: false, value: draft,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); apply() } },
        }),
      ),
      el('div', { className: 'custom-preview' },
        el('iframe', { title: '自定义预览', sandbox: 'allow-scripts allow-forms', srcDoc: applied }),
      ),
    ),
  )
}
