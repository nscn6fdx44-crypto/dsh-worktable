/**
 * 小窗：新建项目 / 编辑项目 / 管理对话绑定。
 * 全部只写 localStorage（项目元数据），不动磁盘。
 */
import { useState, useRef } from 'react'
import { el, Modal, Light } from './ui.js'
import {
  store, useStore, STATES, normState,
  EMOJI_CHOICES, shortPath, addProject, updateProject, closeModal,
  bindSession, unbindSession, setPrimarySession, sessionsOf, loadSessions, projectOf,
  createSessionInDir, jumpToSession, toast, ACCENTS, BACKDROPS, setTheme, resetTheme, store as coreStore,
  enterProject, projEmoji, switchHostSession, PROJECT_TEMPLATES, templateOf, applyTemplate,
  exportSnapshotText, importSnapshot, setSideProject,
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
