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
  workspaceDirOf, revealPath, openExternal,
  visibleEntries, setFsSort, setFsQuery, selectEntry, fsMkdir, fsRename, fsDelete, fsReveal,
  openFsMenu, closeFsMenu,
  joinPath, crumbsOf,
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

/* ============================ 文件管理器（面板内自绘） ============================ */

/**
 * 文件管理器。
 *
 * 为什么自绘：系统资源管理器是要 HWND 的原生窗口，HTML 面板里没有能承载它的句柄，
 * SetParent 只能盖在整个窗口上、跟不了面板布局。所以列表自己画，但保留
 * 「⧉ 在系统窗口中显示」这个出口 —— 复制粘贴、拖拽、预览这些原生能力还是它强。
 *
 * 交互：单击选中 · 双击进目录 / 开文件（文件进编辑器）· 右键菜单（显示 / 重命名 / 回收站）
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
          title: joinPath(dirPath, e.name),
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
            : el('button', { type: 'button', onClick: () => { const m = menu; closeFsMenu(); openFile(joinPath(m.dir, m.name), project.id) } }, '◆ 在编辑器中打开'),
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
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(name)) return '🖼️'
  if (/\.(html|htm|css|scss)$/i.test(name)) return '🎨'
  return '·'
}

/* ============================ 主区：编辑器 ============================ */

export function EditorPane({ project }) {
  useStore()
  const ed = store.editor
  /* partial / truncated 都代表「你看到的不是完整文件」—— 一律只读，绝不写回 */
  const readonly = ed.state === 'ok' && (ed.partial || ed.truncated)
  const dirty = ed.state === 'ok' && !readonly && ed.text !== ed.saved
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

  /* 看结尾（大日志）时直接滚到最底 */
  useEffect(() => {
    if (ed.tail && area.current) area.current.scrollTop = area.current.scrollHeight
  }, [ed.tail, ed.path, ed.state])

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

  const previewSize = ed.previewBytes ? fmtSize(ed.previewBytes) : ''
  const limitSize = ed.limit ? fmtSize(ed.limit) : '4.0 MB'

  return el('div', { className: 'pane-body editor-body' },
    el('div', { className: 'ed-bar' },
      el('span', { className: 'ed-name mono', title: ed.path }, ed.name + (dirty ? ' ●' : '')),
      ed.size ? el('span', { className: 'ed-meta mono' }, fmtSize(ed.size)) : null,
      readonly
        ? el('span', { className: 'tag warn', title: '只读预览：文件太大，编辑器只读了一段' }, ed.tail ? '只读 · 结尾' : '只读 · 开头')
        : ed.truncated ? el('span', { className: 'tag' }, '已截断') : null,
      ed.state === 'ok'
        ? el('button', {
          type: 'button', className: 'mini-btn' + (dirty ? ' on' : ''),
          disabled: readonly,
          title: readonly ? '只读预览不能保存（会把文件截断写回）' : '保存到磁盘 (Ctrl+S)',
          onClick: () => saveFile(),
        }, ed.saving ? '保存中…' : '保存')
        : null,
      el('button', { type: 'button', className: 'mini-btn', title: '重新载入', onClick: () => openFile(ed.path, project?.id) }, '重载'),
    ),

    /* 大文件：说清楚「你只看到一段」，并给出三条正当出路 */
    readonly
      ? el('div', { className: 'ed-note' },
        el('span', { className: 'ed-note-txt' },
          '文件 ' + fmtSize(ed.size) + '，超过编辑器上限 ' + limitSize + '，'
          + (ed.tail ? '这里只显示结尾 ' : '这里只显示开头 ') + (previewSize || '一段')
          + '（只读，改了也不会写回）。看全文请用系统程序。'),
        el('div', { className: 'ed-note-acts' },
          el('button', { type: 'button', className: 'mini-btn', onClick: () => openFile(ed.path, project?.id, { mode: 'head' }) }, '看开头'),
          el('button', { type: 'button', className: 'mini-btn', onClick: () => openFile(ed.path, project?.id, { mode: 'tail' }) }, '看结尾'),
          el('button', { type: 'button', className: 'mini-btn on', onClick: () => openExternal(ed.path) }, '🚀 用系统程序打开'),
        ),
      )
      : null,

    ed.state === 'loading'
      ? el('p', { className: 'wt-mute' }, '读取中…')
      : ed.state === 'error'
        ? el('div', { className: 'pane-error' },
          el('p', null, ed.error),
          el('p', { className: 'hint' }, ed.errorCode === 413
            ? '编辑器只处理 ' + limitSize + ' 以内的文本；再大就该交给系统程序，或者只看开头 / 结尾。'
            : (ed.errorCode === 415 || ed.binary)
              ? '二进制文件没法当文本编辑 —— 用系统默认程序打开才看得到内容。'
              : '路径或权限可能不对；也可以直接用系统程序打开它。'),
          el('div', { className: 'ed-note-acts' },
            ed.errorCode === 413 || ed.errorCode === 415
              ? el('button', {
                type: 'button', className: 'mini-btn',
                onClick: () => openFile(ed.path, project?.id, { mode: 'head', bytes: ed.previewBytes || 262144 }),
              }, '只读预览前 ' + (previewSize || '256 KB'))
              : null,
            el('button', { type: 'button', className: 'mini-btn on', onClick: () => openExternal(ed.path) }, '🚀 用系统默认程序打开'),
            el('button', { type: 'button', className: 'mini-btn', onClick: () => revealPath(ed.path, { select: true }) }, '⧉ 在文件管理器中显示'),
            el('button', { type: 'button', className: 'btn small', onClick: () => openFile(ed.path, project?.id) }, '重试'),
          ),
        )
        : el('textarea', {
          ref: area,
          className: 'ed-area mono',
          spellCheck: false,
          readOnly: readonly,
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
