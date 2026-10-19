/**
 * 小窗：新建项目 / 编辑项目 / 管理对话绑定。
 * 全部只写 localStorage（项目元数据），不动磁盘。
 */
import { useState, useEffect, useRef } from 'react'
import { el, Modal, Light } from './ui.js'
import {
  store, useStore, STATES, normState,
  EMOJI_CHOICES, shortPath, addProject, updateProject, closeModal,
  bindSession, unbindSession, setPrimarySession, sessionsOf, loadSessions, projectOf,
  createSessionInDir, jumpToSession, toast, ACCENTS, BACKDROPS, setTheme, resetTheme, store as coreStore,
  enterProject, projEmoji, switchHostSession, PROJECT_TEMPLATES, templateOf, applyTemplate,
  exportSnapshotText, importSnapshot, setSideProject,
  joinPath, baseName,
  ghLogin, ghLogout, loadGh, loadGhRepos, ghUploadRepo, cloneRepo, loadScm, scmOf, setScmInsecure,
} from './core.js'
import { dockAspect } from './hostdock.js'

/** 新建项目弹窗里「绑定对话」下拉的特殊值：用项目目录现开一个对话 */
const NEW_SESSION = '__new__'

export function ModalHost() {
  useStore()
  const modal = store.modal
  if (!modal) return null
  if (modal.kind === 'add') return el(AddProjectModal)
  if (modal.kind === 'edit') return el(EditProjectModal, { pid: modal.pid })
  if (modal.kind === 'bind') return el(BindModal, { pid: modal.pid })
  if (modal.kind === 'theme') return el(ThemeModal)
  if (modal.kind === 'search') return el(SearchModal)
  if (modal.kind === 'data') return el(DataModal)
  if (modal.kind === 'side') return el(SideModal)
  if (modal.kind === 'ghlogin') return el(GhLoginModal)
  if (modal.kind === 'ghupload') return el(GhUploadModal, { pid: modal.pid })
  if (modal.kind === 'clone') return el(CloneModal)
  return null
}

/* ---------- 新建 ---------- */

function AddProjectModal() {
  useStore()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [emoji, setEmoji] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [tplId, setTplId] = useState('blank')
  const [busy, setBusy] = useState(false)
  const rows = store.sessions.rows
  const wantNew = sessionId === NEW_SESSION

  const submit = async () => {
    if (busy) return
    const pid = addProject({ name, path, emoji, sessionId: wantNew ? '' : sessionId })
    if (!pid) return
    /* 模板：只改这个项目的标签页/布局，不碰磁盘 */
    if (tplId !== 'blank') applyTemplate(pid, tplId)
    if (wantNew) {
      setBusy(true)
      /* 项目先建好，再去宿主要一个新对话；拿不到 id 就只留项目，不影响创建 */
      const sid = await createSessionInDir(path)
      if (sid) {
        bindSession(pid, sid)
        /* 建完直接切到这条新对话：右侧立刻就是可以打字的空对话 */
        jumpToSession(sid)
      }
      setBusy(false)
    }
    closeModal()
  }
  const onKey = (e) => { if (e.key === 'Enter') submit() }

  return el(Modal, {
    title: '新建项目',
    subtitle: '项目元数据只写本机浏览器 localStorage（wt.projects），不动磁盘文件。',
    foot: [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
      el('button', {
        key: 's', type: 'button', className: 'btn primary', disabled: busy ? 'disabled' : undefined, onClick: submit,
      }, busy ? '创建对话…' : '创建项目'),
    ],
  },
    el('div', { className: 'field' },
      el('label', null, '项目名称'),
      el('input', { value: name, placeholder: '例如：智能小车固件', autoComplete: 'off', onChange: (e) => setName(e.target.value), onKeyDown: onKey }),
    ),
    el('div', { className: 'field' },
      el('label', null, '图标'),
      el('div', { className: 'emoji-row' },
        el('button', {
          type: 'button', className: 'emoji' + (emoji === '' ? ' on' : ''), title: '按目录名 / 语言自动',
          onClick: (e) => { e.preventDefault(); setEmoji('') },
        }, '自动'),
        EMOJI_CHOICES.map((c) => el('button', {
          key: c, type: 'button', className: 'emoji' + (emoji === c ? ' on' : ''),
          'aria-label': c,
          onClick: (e) => { e.preventDefault(); setEmoji(c) },
        }, c)),
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '预设模板'),
      el('div', { className: 'tpl-row' },
        PROJECT_TEMPLATES.map((t) => el('button', {
          key: t.id, type: 'button',
          className: 'tpl' + (tplId === t.id ? ' on' : ''),
          title: t.hint,
          onClick: (e) => { e.preventDefault(); setTplId(t.id) },
        }, el('b', null, t.icon + ' ' + t.label), el('small', null, t.hint))),
      ),
      el('div', { className: 'field-hint' }, '模板只决定打开哪些窗格和布局，不会创建文件；之后可随时用「＋ 窗口」和 ▭◫⬓ 调整。'),
    ),
    el('div', { className: 'field' },
      el('label', null, '项目目录'),
      el('input', {
        className: 'mono', value: path, autoComplete: 'off',
        placeholder: 'C:////projects////demo',
        onChange: (e) => setPath(e.target.value), onKeyDown: onKey,
      }),
      el('div', { className: 'field-hint' }, '手填绝对路径（需在用户目录 / DSH 授权目录内）；也可以直接绑一个已有对话，目录会跟着它走'),
    ),
    el('div', { className: 'field' },
      el('label', null, '绑定 DSH 对话'),
      el('select', {
        className: 'wt-select', value: sessionId, onChange: (e) => setSessionId(e.target.value),
      },
        el('option', { value: '' }, '不绑定（稍后可绑）'),
        el('option', { value: NEW_SESSION }, '＋ 新建对话（用项目目录）'),
        rows.slice(0, 50).map((s) => el('option', { key: s.id, value: s.id },
          (s.title || s.id) + ' · ' + STATES[normState(s.state)].label)),
      ),
      el('div', { className: 'field-hint' }, wantNew
        ? '创建时会在项目目录里新建一个 DSH 对话并绑定（宿主不提供入口时先建项目，稍后手动绑）'
        : rows.length
          ? '共 ' + rows.length + ' 个宿主对话可选'
          : (store.sessions.state === 'pending' ? '正在读取宿主对话…' : '宿主暂无对话，可以选「新建对话」')),
    ),
  )
}

/* ---------- 并排选择 ---------- */

function SideModal({ pid }) {
  useStore()
  const others = (store.projects || []).filter((p) => !p.hidden && p.id !== pid)
  return el(Modal, {
    title: '并排放一个项目',
    subtitle: '把另一个项目的工作区放到右边，两块各有自己的标签页；中间拖动条可调比例。右侧对话仍只有一块。',
    foot: [el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消')],
  },
    others.length
      ? el('div', { className: 'side-list' },
        others.map((p) => el('button', {
          key: p.id, type: 'button', className: 'side-row',
          onClick: () => { setSideProject(p.id); closeModal() },
        }, el('span', { className: 'art-ico' }, projEmoji(p)), el('span', { className: 'side-name' }, p.alias || p.name), el('span', { className: 'mono side-path' }, shortPath(p.path || '', 30)))),
      )
      : el('p', { className: 'wt-mute' }, '还没有别的项目；先建一个再来并排'),
  )
}

/* ---------- 导出 / 导入 ---------- */

function DataModal() {
  useStore()
  const [text, setText] = useState(() => exportSnapshotText())
  const [msg, setMsg] = useState('')

  const doImport = () => {
    const res = importSnapshot(text)
    setMsg(res.ok ? '导入完成：新增 ' + res.added + ' · 更新 ' + res.updated + ' · 共 ' + res.total + ' 个项目' : '导入失败，检查 JSON')
  }

  const doDownload = () => {
    try {
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'worktable-projects-' + new Date().toISOString().slice(0, 10) + '.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setMsg('已下载 .json（也可以直接复制上面的内容备份）')
    } catch (err) {
      setMsg('下载失败：' + String((err && err.message) || err) + '，请手动复制')
    }
  }

  return el(Modal, {
    title: '项目数据',
    wide: true,
    subtitle: '导出备份 / 换机迁移：只含项目元数据、每个项目的布局与主题；会话 id 会保留，但换机后未必能连回原对话。',
    foot: [
      el('button', { key: 'r', type: 'button', className: 'btn', onClick: () => { setText(exportSnapshotText()); setMsg('已重新生成当前数据') } }, '重新生成'),
      el('button', { key: 'd', type: 'button', className: 'btn', onClick: doDownload }, '下载 .json'),
      el('button', { key: 'i', type: 'button', className: 'btn primary', onClick: doImport }, '导入这份数据'),
    ],
  },
    el('div', { className: 'field' },
      el('label', null, 'JSON（可直接改，再点「导入这份数据」）'),
      el('textarea', {
        className: 'data-area mono',
        value: text,
        spellCheck: false,
        onChange: (e) => { setText(e.target.value); setMsg('') },
      }),
      el('div', { className: 'field-hint' }, '导入按 id（其次 目录+名称）判重：重复的会更新，新项目追加，不会清空现有项目。'),
    ),
    msg ? el('div', { className: 'data-msg' }, msg) : null,
  )
}

/* ---------- ⌘K 全局搜索 ---------- */

function SearchModal() {
  useStore()
  const [q, setQ] = useState('')
  const [hit, setHit] = useState(0)
  const needle = q.trim().toLowerCase()

  const projects = (store.projects || [])
    .filter((p) => !p.hidden)
    .filter((p) => !needle
      || String(p.alias || p.name || '').toLowerCase().includes(needle)
      || String(p.path || '').toLowerCase().includes(needle)
      || String(p.folder || '').toLowerCase().includes(needle))
    .slice(0, 8)
    .map((p) => ({
      key: 'p:' + p.id,
      icon: projEmoji(p),
      title: p.alias || p.name,
      sub: p.path || '',
      act: () => { closeModal(); enterProject(p.id) },
    }))

  const sessions = (store.sessions.rows || [])
    .filter((s) => !needle
      || String(s.title || '').toLowerCase().includes(needle)
      || String(s.cwd || '').toLowerCase().includes(needle)
      || String(s.id || '').toLowerCase().includes(needle))
    .slice(0, 8)
    .map((s) => ({
      key: 's:' + s.id,
      icon: '◉',
      title: s.title || s.id,
      sub: s.cwd || s.id,
      act: () => { closeModal(); switchHostSession(s.id).then((r) => { if (!r.ok) toast('切对话失败：' + r.error, 'warn') }) },
    }))

  const rows = projects.concat(sessions)
  const at = Math.min(hit, Math.max(0, rows.length - 1))

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHit((n) => Math.min(n + 1, rows.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHit((n) => Math.max(n - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); const r = rows[at]; if (r) r.act() }
  }

  return el(Modal, {
    title: '搜索',
    wide: true,
    subtitle: '⌘K / Ctrl+K 打开 · ↑↓ 选择 · Enter 进入 · Esc 关闭',
    foot: [el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '关闭')],
  },
    el('div', { className: 'field' },
      el('input', {
        className: 'search-input', value: q, autoComplete: 'off', autoFocus: true,
        placeholder: '项目名 / 目录 / 对话标题…',
        onChange: (e) => { setQ(e.target.value); setHit(0) },
        onKeyDown: onKey,
      }),
    ),
    rows.length
      ? el('div', { className: 'search-list' },
        rows.map((r, i) => el('button', {
          key: r.key, type: 'button',
          className: 'search-row' + (i === at ? ' on' : ''),
          onMouseEnter: () => setHit(i),
          onClick: r.act,
        },
          el('span', { className: 'search-ico' }, r.icon),
          el('span', { className: 'search-main' },
            el('span', { className: 'search-title' }, r.title),
            el('span', { className: 'search-sub mono' }, shortPath(r.sub, 52)),
          ),
        )),
      )
      : el('div', { className: 'empty' }, needle ? '没有匹配的项目或对话' : '输入关键字开始搜索'),
  )
}

/* ---------- 主题与背景 ---------- */

/**
 * 把用户拖进来的图片缩到 1920px 以内、转成 JPEG data URL 再存。
 * localStorage 只有 ~5MB，原图直接塞进去必爆；缩完典型 150–400KB。
 */
function shrinkImage(file, maxSide = 1920, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function' || typeof document === 'undefined') { reject(new Error('当前环境不支持本地图片')); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('这张图解析不了'))
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch (err) { reject(err) }
      }
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

function ThemeModal() {
  useStore()
  const theme = coreStore.theme || { accent: 'amber', bg: 'glass', image: '', brightness: 100, crop: { x: 0, y: 0, w: 100, h: 100 } }
  const [dropOver, setDropOver] = useState(false)
  const fileRef = useRef(null)
  const cropRef = useRef(null)
  const crop = theme.crop || { x: 0, y: 0, w: 100, h: 100 }
  const ratio = dockAspect()

  /* 图片不动、框动：move = 拖框本身，size = 拖右下角改大小 */
  const startCut = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const stage = e.currentTarget.closest && e.currentTarget.closest('.theme-stage')
    const rect = stage && stage.getBoundingClientRect ? stage.getBoundingClientRect() : { width: 1, height: 1 }
    cropRef.current = { mode, sx: e.clientX, sy: e.clientY, base: { ...crop }, rect }
  }
  const onCutMove = (e) => {
    const d = cropRef.current
    if (!d) return
    const dx = ((e.clientX - d.sx) / Math.max(1, d.rect.width)) * 100
    const dy = ((e.clientY - d.sy) / Math.max(1, d.rect.height)) * 100
    if (d.mode === 'size') {
      /* 等比例缩放：百分比相等 → 与外框（主区）同比例，不会变形 */
      const size = d.base.w + Math.max(dx, dy)
      setTheme({ crop: { x: d.base.x, y: d.base.y, w: size, h: size } })
    }
    else setTheme({ crop: { x: d.base.x + dx, y: d.base.y + dy, w: d.base.w, h: d.base.h } })
  }
  const onCutUp = () => { cropRef.current = null }

  const applyImageFile = async (file) => {
    if (!file || !/^image\//i.test(file.type || '')) { toast('只能放图片文件', 'warn'); return }
    try {
      const dataUrl = await shrinkImage(file)
      setTheme({ bg: 'image', image: dataUrl, crop: { x: 0, y: 0, w: 100, h: 100 } })
      toast('背景图已换（已缩到 1920px 内）', 'ok')
    } catch (err) {
      toast('换背景图失败：' + String(err?.message ?? err), 'warn')
    }
  }

  return el(Modal, {
    title: '主题与背景',
    wide: true,
    subtitle: '只改工作台自己的配色与底，不动宿主主题；选择立刻生效，记在 wt.theme。',
    foot: [
      el('button', { key: 'r', type: 'button', className: 'btn', onClick: () => resetTheme() }, '恢复默认'),
      el('button', { key: 'c', type: 'button', className: 'btn primary', onClick: closeModal }, '完成'),
    ],
  },
    el('div', { className: 'field' },
      el('label', null, '强调色'),
      el('div', { className: 'theme-grid' },
        ACCENTS.map((a) => el('button', {
          key: a.id, type: 'button',
          className: 'theme-dot' + (theme.accent === a.id ? ' on' : ''),
          title: a.label,
          style: { background: 'rgb(' + a.rgb + ')' },
          onClick: (e) => { e.preventDefault(); setTheme({ accent: a.id }) },
        })),
      ),
    ),

    el('div', { className: 'field' },
      el('label', null, '背景'),
      el('div', { className: 'theme-bgs' },
        BACKDROPS.map((b) => el('button', {
          key: b.id, type: 'button',
          className: 'theme-bg' + (theme.bg === b.id ? ' on' : ''),
          onClick: (e) => { e.preventDefault(); setTheme({ bg: b.id }) },
        }, b.label, el('small', null, b.hint))),
      ),
    ),

    theme.bg === 'image'
      ? el('div', { className: 'field' },
        el('label', null, '背景图片'),
        el('div', {
          className: 'theme-drop' + (dropOver ? ' over' : ''),
          role: 'button',
          tabIndex: 0,
          title: '把图片拖进来，或点这里选文件',
          onClick: (e) => {
            /* 框/台子上的点击不该再弹一次选文件窗口 */
            if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('.theme-stage')) return
            if (fileRef.current) fileRef.current.click()
          },
          onDragOver: (e) => { e.preventDefault(); setDropOver(true) },
          onDragLeave: () => setDropOver(false),
          onDrop: async (e) => {
            e.preventDefault()
            setDropOver(false)
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
            if (f) await applyImageFile(f)
          },
        },
          theme.image
            ? el('div', {
              className: 'theme-stage',
              title: '图片不动：拖框选区域，拖右下角改大小',
              style: { aspectRatio: String(ratio) },
              onPointerMove: onCutMove,
              onPointerUp: onCutUp,
              onPointerLeave: onCutUp,
              onClick: (e) => e.stopPropagation(),
              onPointerDown: (e) => e.stopPropagation(),
            },
              el('div', {
                className: 'theme-stage-img',
                style: { backgroundImage: 'url("' + String(theme.image || '').replace(/"/g, '%22') + '")' },
              }),
              el('div', {
                className: 'theme-cut',
                style: { left: crop.x + '%', top: crop.y + '%', width: crop.w + '%', height: crop.h + '%' },
                onPointerDown: startCut('move'),
                onClick: (e) => e.stopPropagation(),
              },
                el('span', { className: 'theme-cut-handle', onPointerDown: startCut('size') }),
              ),
            )
            : el('span', null, '拖图片到这里，或点一下选文件'),
          el('small', { className: 'hint' }, theme.image ? '拖框选区 · 拖右下角改大小' : '本地图片会缩到 1920px 内再存'),
        ),
        el('input', {
          ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' },
          onChange: async (e) => {
            const f = e.target.files && e.target.files[0]
            if (f) await applyImageFile(f)
          },
        }),
        theme.image
          ? el('div', { className: 'theme-pos' },
            el('span', { className: 'mono' }, '取景 ' + crop.w + '% × ' + crop.h + '% · 位置 ' + crop.x + '% / ' + crop.y + '% · 比例 ' + ratio.toFixed(2) + ':1'),
            el('button', {
              type: 'button', className: 'mini-btn', title: '整图居中',
              onClick: (e) => { e.preventDefault(); setTheme({ crop: { x: 0, y: 0, w: 100, h: 100 } }) },
            }, '居中'),
          )
          : null,
        el('div', { className: 'field' },
          el('label', null, '或用图片地址'),
          el('input', {
            className: 'mono',
            value: String(theme.image || '').startsWith('data:') ? '' : String(theme.image || ''),
            placeholder: 'https://…/wallpaper.jpg',
            onChange: (e) => setTheme({ image: e.target.value, crop: { x: 0, y: 0, w: 100, h: 100 } }),
          }),
        ),
      )
      : null,

    el('div', { className: 'field' },
      el('label', null, '亮度'),
      el('div', { className: 'theme-bright' },
        el('input', {
          type: 'range', min: 50, max: 150, step: 5,
          value: theme.brightness || 100,
          onChange: (e) => setTheme({ brightness: Number(e.target.value) }),
        }),
        el('b', null, String(theme.brightness || 100) + '%'),
      ),
      el('div', { className: 'field-hint' }, '只调工作台自己的背景亮度，文字对比度不变'),
    ),
  )
}


/* ---------- 编辑 ---------- */

function EditProjectModal({ pid }) {
  useStore()
  const project = projectOf(pid)
  /* hooks 必须在任何 early return 之前：项目被删时仍要保持调用顺序一致 */
  const [name, setName] = useState(project ? (project.alias || project.name) : '')
  const [path, setPath] = useState(project ? (project.path || '') : '')
  const [icon, setIcon] = useState(project ? (project.icon || '') : '')
  const [note, setNote] = useState(project ? (project.note || '') : '')
  const [folder, setFolder] = useState(project ? (project.folder || '') : '')
  const [runCmd, setRunCmd] = useState(project && project.run ? (project.run.cmd || '') : '')
  const [runPort, setRunPort] = useState(project && project.run && project.run.port ? String(project.run.port) : '')
  if (!project) return null

  const save = () => {
    if (!String(name).trim()) return
    updateProject(pid, { name, alias: name, path, icon, note, folder, run: { cmd: runCmd, port: Number(runPort) || 0, cwd: '' } })
    closeModal()
  }

  return el(Modal, {
    title: '编辑项目',
    subtitle: '名称 / 图标 / 目录 / 备注 / 分组',
    foot: [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
      el('button', { key: 's', type: 'button', className: 'btn primary', onClick: save }, '保存'),
    ],
  },
    el('div', { className: 'field' },
      el('label', null, '名称'),
      el('input', { value: name, onChange: (e) => setName(e.target.value) }),
    ),
    el('div', { className: 'field' },
      el('label', null, '目录'),
      el('input', { className: 'mono', value: path, onChange: (e) => setPath(e.target.value) }),
    ),
    el('div', { className: 'field' },
      el('label', null, '分组（侧边栏按此归组，可留空）'),
      el('input', { value: folder, placeholder: '例如：嵌入式', onChange: (e) => setFolder(e.target.value) }),
    ),
    el('div', { className: 'field' },
      el('label', null, '图标'),
      el('div', { className: 'emoji-row' },
        el('button', {
          type: 'button', className: 'emoji' + (icon === '' ? ' on' : ''),
          onClick: (e) => { e.preventDefault(); setIcon('') },
        }, '自动'),
        EMOJI_CHOICES.map((c) => el('button', {
          key: c, type: 'button', className: 'emoji' + (icon === c ? ' on' : ''), 'aria-label': c,
          onClick: (e) => { e.preventDefault(); setIcon(c) },
        }, c)),
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '备注'),
      el('input', { value: note, placeholder: '一句话说明这个项目', onChange: (e) => setNote(e.target.value) }),
    ),
  )
}

/* ---------- 绑定 ---------- */

function BindModal({ pid }) {
  useStore()
  const project = projectOf(pid)
  if (!project) return null
  const rows = store.sessions.rows
  const bound = sessionsOf(project)
  const state = store.sessions.state

  return el(Modal, {
    title: '对话绑定',
    subtitle: (project.alias || project.name) + ' · 第一个为「主对话」，对话预览与状态灯以它为准',
    wide: true,
    foot: [
      el('button', { key: 'r', type: 'button', className: 'btn', onClick: () => loadSessions() }, '刷新列表'),
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '关闭'),
    ],
  },
    bound.length ? el('div', { className: 'bound-row' },
      bound.map((s, i) => el('span', { key: s.id, className: 'bound-chip' + (i === 0 ? ' main' : '') },
        el('span', { className: 'light ' + normState(s.state), 'aria-hidden': 'true' }),
        el('span', { className: 'bc-title' }, s.title || s.id),
        i === 0
          ? el('small', null, '主')
          : el('button', {
            type: 'button', className: 'bc-main', title: '设为主对话',
            onClick: () => setPrimarySession(pid, s.id),
          }, '设为主'),
        el('button', {
          type: 'button', className: 'bc-x', title: '解除绑定',
          onClick: () => unbindSession(pid, s.id),
        }, '✕'),
      )),
    ) : el('div', { className: 'modal-note' }, '还没有绑定任何对话，点下面的会话即可绑定'),
    state === 'error' ? el('div', { className: 'modal-note err' }, '读取会话失败：' + (store.sessions.error || '未知原因')) : null,
    state === 'pending' ? el('div', { className: 'modal-note' }, '正在读取会话…') : null,
    el('div', { className: 'session-list' },
      rows.length
        ? rows.slice(0, 80).map((s) => {
          const on = project.sessions.includes(s.id)
          const isPrimary = project.sessions[0] === s.id
          return el('button', {
            key: s.id, type: 'button',
            className: 'session-row' + (on ? ' active' : ''),
            onClick: () => (on ? unbindSession(pid, s.id) : bindSession(pid, s.id)),
          },
            el('span', { className: 'light ' + normState(s.state), 'aria-hidden': 'true' }),
            el('span', { className: 'sr-main' },
              el('span', { className: 'sr-title' }, s.title || s.id),
              el('span', { className: 'sr-sub' }, shortPath(s.cwd || s.id, 46)),
            ),
            el('span', { className: 'tag' }, STATES[normState(s.state)].label),
            el('span', { className: 'sr-act' }, isPrimary ? '主对话' : (on ? '已绑定' : '绑定')),
          )
        })
        : el('div', { className: 'empty' }, state === 'pending' ? '读取中…' : '宿主没有返回任何会话'),
    ),
  )
}

/* ---------- GitHub ---------- */

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=trae-usage-worktable'

/**
 * 登录 GitHub。
 *
 * 只支持「粘贴令牌」一种方式：device flow 需要一个第三方 OAuth App 的 client_id，
 * 借用别家的不合适，自己申请一个又得每个用户去注册。令牌这条路最稳、离线可用，
 * 而且本机已经登录过 git 的用户根本不用走这一步（/gh/status 会自动识别）。
 */
function GhLoginModal() {
  useStore()
  const gh = store.gh
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [writeCredential, setWriteCredential] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy || !token.trim()) return
    setBusy(true)
    const out = await ghLogin(token.trim(), { remember, writeCredential })
    setBusy(false)
    if (out) { setToken(''); closeModal() }
  }

  const foot = gh.loggedIn
    ? [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '关闭'),
      el('button', {
        key: 'o', type: 'button', className: 'btn',
        onClick: async () => { await ghLogout(); closeModal() },
      }, '退出登录'),
    ]
    : [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
      el('button', {
        key: 's', type: 'button', className: 'btn primary',
        disabled: busy || !token.trim(), onClick: submit,
      }, busy ? '校验中…' : '登录'),
    ]

  if (gh.loggedIn) {
    return el(Modal, {
      title: 'GitHub 账号',
      subtitle: '当前已登录。令牌只存在本机，界面上不会再显示它。',
      foot,
    },
      el('div', { className: 'gh-me' },
        gh.avatar ? el('img', { className: 'gh-avatar', src: gh.avatar, alt: '' }) : el('span', { className: 'gh-avatar ph' }, '●'),
        el('div', null,
          el('b', null, gh.login || ''),
          el('p', { className: 'wt-mute' }, '来源：' + (gh.source === 'stored' ? '本插件保存的令牌' : gh.source === 'git-credential' ? '本机 git 已登录的凭据' : gh.source || '—')),
          el('p', { className: 'wt-mute mono' }, '权限：' + (gh.scopes || '未知（细粒度令牌不返回 scopes）')),
        ),
      ),
      el('p', { className: 'field-hint' }, '退出登录只会清掉本插件保存的令牌，不会动本机 git / 凭据管理器里的账号。'),
    )
  }

  return el(Modal, {
    title: '登录 GitHub',
    subtitle: '登录后才能建仓库、列仓库、上传项目。纯本地提交推送不需要登录。',
    foot,
  },
    el('div', { className: 'field' },
      el('label', null, 'Personal Access Token'),
      el('input', {
        className: 'mono', value: token, autoComplete: 'off', type: 'password',
        placeholder: 'ghp_… / github_pat_…',
        onChange: (e) => setToken(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') submit() },
      }),
      el('div', { className: 'field-hint' },
        '到 ',
        el('a', { href: TOKEN_URL, target: '_blank', rel: 'noreferrer' }, 'github.com/settings/tokens'),
        ' 新建一个令牌，勾 ',
        el('code', null, 'repo'),
        '（要推 Actions 工作流再加 ',
        el('code', null, 'workflow'),
        '）。它只会存进本机的 DSH 配置目录（权限 0600）。',
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '选项'),
      el('label', { className: 'chk' },
        el('input', { type: 'checkbox', checked: remember, onChange: (e) => setRemember(e.target.checked) }),
        el('span', null, '记住令牌（下次启动自动登录）'),
      ),
      el('label', { className: 'chk' },
        el('input', { type: 'checkbox', checked: writeCredential, onChange: (e) => setWriteCredential(e.target.checked) }),
        el('span', null, '同时写进系统凭据管理器（内置终端里敲 git push 也不用再输密码）'),
      ),
    ),
    gh.error ? el('p', { className: 'wt-bad' }, gh.error) : null,
    el('p', { className: 'field-hint' }, '提示：如果本机 git 已经登录过 GitHub，打开这个窗格时会自动识别，不用再粘令牌。'),
  )
}

/** 上传仓库：建远程 + 首推 */
function GhUploadModal({ pid }) {
  useStore()
  const project = pid ? projectOf(pid) : null
  const scm = pid ? scmOf(pid) : null
  const gh = store.gh
  const [name, setName] = useState(project ? String(project.name || '').replace(/\s+/g, '-').toLowerCase() : '')
  const [isPrivate, setPrivate] = useState(true)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const submit = async () => {
    if (busy || !pid) return
    setBusy(true)
    const out = await ghUploadRepo(pid, { name, private: isPrivate, description })
    setBusy(false)
    if (out) {
      setResult(out)
      loadScm(pid)
    }
  }

  const foot = result
    ? [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '关闭'),
      result.repo?.htmlUrl
        ? el('a', { key: 'o', className: 'btn primary', href: result.repo.htmlUrl, target: '_blank', rel: 'noreferrer' }, '在 GitHub 打开')
        : null,
    ]
    : [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
      el('button', {
        key: 's', type: 'button', className: 'btn primary',
        disabled: busy || !name.trim(), onClick: submit,
      }, busy ? '上传中…（首次推送可能较慢）' : '建仓并上传'),
    ]

  if (result) {
    return el(Modal, { title: '已上传', subtitle: result.remote || '', foot },
      el('div', { className: 'gh-steps' },
        (result.steps || []).map((s, i) => el('div', { key: i, className: 'gh-step' }, el('span', null, '✓'), el('span', null, s))),
      ),
      el('p', { className: 'mono wt-mute' }, '分支：' + (result.branch || '—')),
      el('p', { className: 'field-hint' }, '以后在这里改完，点「提交并推送」就能同步。'),
    )
  }

  return el(Modal, {
    title: '上传项目到 GitHub',
    subtitle: project ? (project.alias || project.name) + ' · ' + shortPath(project.path || '', 60) : '',
    foot,
  },
    gh.loggedIn
      ? el('p', { className: 'wt-mute' }, '将以 ' + gh.login + ' 的身份新建一个仓库，并把当前分支推上去。')
      : el('p', { className: 'wt-bad' }, '还没登录 GitHub —— 先关掉这个窗，点「登录 GitHub」。'),
    el('div', { className: 'field' },
      el('label', null, '仓库名'),
      el('input', {
        className: 'mono', value: name, autoComplete: 'off',
        onChange: (e) => setName(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') submit() },
      }),
      el('div', { className: 'field-hint' }, '如果本地已经配了 origin，会沿用那个远程仓库，不会重复建。'),
    ),
    el('div', { className: 'field' },
      el('label', null, '描述（可选）'),
      el('input', { value: description, autoComplete: 'off', onChange: (e) => setDescription(e.target.value) }),
    ),
    el('div', { className: 'field' },
      el('label', null, '可见性'),
      el('div', { className: 'tpl-row' },
        el('button', { type: 'button', className: 'tpl' + (isPrivate ? ' on' : ''), onClick: (e) => { e.preventDefault(); setPrivate(true) } }, el('b', null, '🔒 私有')),
        el('button', { type: 'button', className: 'tpl' + (!isPrivate ? ' on' : ''), onClick: (e) => { e.preventDefault(); setPrivate(false) } }, el('b', null, '🌐 公开')),
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '会做这几件事'),
      el('div', { className: 'gh-steps' },
        ['git init（已有仓库就跳过）', '没有提交就提交一次「初始提交」', '在 GitHub 建同名仓库，设为 origin', 'push -u origin ' + ((scm && scm.branch) || '当前分支')]
          .map((s, i) => el('div', { key: i, className: 'gh-step' }, el('span', null, String(i + 1) + '.'), el('span', null, s))),
      ),
      el('div', { className: 'field-hint' }, '不会改动你的 .gitignore；如果项目里有 node_modules 之类的大目录，先自己加进去再上传。'),
    ),
  )
}

/* ---------- 克隆 ---------- */

function repoNameOf(url) {
  const s = String(url || '').trim().replace(/[\\/]+$/, '')
  const tail = s.split(/[\\/:]+/).filter(Boolean).pop() || 'repo'
  return tail.replace(/\.git$/i, '')
}

function CloneModal() {
  useStore()
  const gh = store.gh
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(String(store.defaults.workspace || ''))
  const [branch, setBranch] = useState('')
  const [shallow, setShallow] = useState(false)
  const [insecure, setInsecure] = useState(store.scm.insecure === true)
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState([])
  const [error, setError] = useState('')
  const [showList, setShowList] = useState(false)
  const [q, setQ] = useState('')

  const name = repoNameOf(url)
  const dest = parent ? joinPath(parent, name) : ''

  useEffect(() => { if (gh.state === 'idle') loadGh() }, [])
  useEffect(() => {
    if (showList && gh.reposState === 'idle') loadGhRepos({ q: gh.q || '' })
  }, [showList])

  const start = async () => {
    if (busy) return
    if (!url.trim()) { setError('请填写仓库地址'); return }
    if (!dest) { setError('请填写克隆到哪个目录'); return }
    setBusy(true); setError(''); setLines([])
    try {
      const out = await cloneRepo(
        { url: url.trim(), dest, depth: shallow ? 1 : 0, branch: branch.trim(), insecure },
        (line) => setLines((cur) => cur.concat([line]).slice(-40)),
      )
      const pid = addProject({ name: name, path: out.path || dest })
      toast('已克隆到 ' + (out.path || dest), 'ok')
      closeModal()
      if (pid) enterProject(pid)
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const foot = [
    el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
    el('button', {
      key: 's', type: 'button', className: 'btn primary',
      disabled: busy || !url.trim(), onClick: start,
    }, busy ? '克隆中…' : '克隆'),
  ]

  return el(Modal, {
    title: '克隆 GitHub 仓库',
    subtitle: '克隆完成后会自动建成一个项目并打开。私有仓库需要先登录。',
    wide: true,
    foot,
  },
    el('div', { className: 'field' },
      el('label', null, '仓库地址'),
      el('input', {
        className: 'mono', value: url, autoComplete: 'off',
        placeholder: 'https://github.com/owner/repo.git 或 owner/repo',
        onChange: (e) => setUrl(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') start() },
      }),
      gh.loggedIn
        ? el('div', { className: 'field-hint' },
          el('button', {
            type: 'button', className: 'mini-btn',
            onClick: (e) => { e.preventDefault(); setShowList((v) => !v) },
          }, showList ? '收起我的仓库' : '从我的仓库里选（' + gh.login + '）'),
        )
        : el('div', { className: 'field-hint' }, '未登录也能克隆公开仓库；私有仓库要先登录。'),
    ),
    showList
      ? el('div', { className: 'gh-repos' },
        el('div', { className: 'gh-repos-head' },
          el('input', {
            className: 'scm-input mono', placeholder: '搜仓库名…', value: q,
            onChange: (e) => { setQ(e.target.value); loadGhRepos({ q: e.target.value }) },
          }),
          el('button', { type: 'button', className: 'mini-btn', onClick: () => loadGhRepos({ q }) }, '↻'),
        ),
        gh.reposState === 'loading'
          ? el('p', { className: 'wt-mute' }, '读取中…')
          : gh.reposState === 'error'
            ? el('p', { className: 'wt-bad' }, gh.reposError || '读取失败')
            : gh.repos.length
              ? gh.repos.slice(0, 40).map((r) => el('button', {
                key: r.fullName, type: 'button', className: 'gh-repo',
                onClick: (e) => { e.preventDefault(); setUrl(r.cloneUrl); setShowList(false) },
              },
                el('span', { className: 'mono' }, r.fullName),
                r.private ? el('span', { className: 'tag' }, '私有') : null,
                el('span', { className: 'gc-date mono' }, (r.updatedAt || '').slice(0, 10)),
              ))
              : el('p', { className: 'wt-mute' }, '没有匹配的仓库'),
      )
      : null,
    el('div', { className: 'field' },
      el('label', null, '克隆到'),
      el('input', {
        className: 'mono', value: parent, autoComplete: 'off',
        placeholder: 'C://Users//你的用户名//projects',
        onChange: (e) => setParent(e.target.value),
      }),
      dest ? el('div', { className: 'field-hint mono' }, '将创建：' + dest) : null,
    ),
    el('div', { className: 'field' },
      el('label', null, '选项'),
      el('label', { className: 'chk' },
        el('input', { type: 'checkbox', checked: shallow, onChange: (e) => setShallow(e.target.checked) }),
        el('span', null, '浅克隆（--depth 1，只取最新一个提交，大仓库快很多）'),
      ),
      el('input', {
        className: 'scm-input mono', value: branch, placeholder: '只克隆某个分支（可留空）',
        onChange: (e) => setBranch(e.target.value),
      }),
      el('label', { className: 'chk' },
        el('input', {
          type: 'checkbox', checked: insecure,
          onChange: (e) => { setInsecure(e.target.checked); setScmInsecure(e.target.checked) },
        }),
        el('span', null, '跳过证书校验（本机报 CRYPT_E_NO_REVOCATION_CHECK 时才用）'),
      ),
      el('div', { className: 'field-hint' }, '默认先只关吊销检查；仍失败才用「跳过证书校验」。这个开关会记住，推送 / 拉取也一起生效。'),
    ),
    lines.length ? el('pre', { className: 'gh-log mono' }, lines.join('\n')) : null,
    error ? el('p', { className: 'wt-bad' }, error) : null,
  )
}
