/**
 * 小窗：新建项目 / 编辑项目 / 管理对话绑定。
 * 全部只写 localStorage（项目元数据），不动磁盘。
 */
import { useState } from 'react'
import { el, Modal, LayoutSketch, Light } from './ui.js'
import {
  store, useStore, STATES, normState, LAYOUTS, DEFAULT_LAYOUT,
  EMOJI_CHOICES, shortPath, relTime, addProject, updateProject, closeModal,
  bindSession, unbindSession, sessionsOf, openModal, loadSessions, projectOf,
} from './core.js'

export function ModalHost() {
  useStore()
  const modal = store.modal
  if (!modal) return null
  if (modal.kind === 'add') return el(AddProjectModal)
  if (modal.kind === 'edit') return el(EditProjectModal, { pid: modal.pid })
  if (modal.kind === 'bind') return el(BindModal, { pid: modal.pid })
  return null
}

/* ---------- 新建 ---------- */

function AddProjectModal() {
  useStore()
  const defaults = store.defaults
  const [name, setName] = useState('')
  const [path, setPath] = useState(defaults.workspace || '')
  const [emoji, setEmoji] = useState('')
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  const [sessionId, setSessionId] = useState('')
  const rows = store.sessions.rows

  const submit = () => {
    const pid = addProject({ name, path, emoji, layout, sessionId })
    if (pid) closeModal()
  }
  const onKey = (e) => { if (e.key === 'Enter') submit() }

  return el(Modal, {
    title: '新建项目',
    subtitle: '项目元数据只写本机浏览器 localStorage（wt.projects），不动磁盘文件。',
    foot: [
      el('button', { key: 'c', type: 'button', className: 'btn', onClick: closeModal }, '取消'),
      el('button', { key: 's', type: 'button', className: 'btn primary', onClick: submit }, '创建项目'),
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
          key: c, type: 'button', className: 'emoji' + (emoji === c ? ' on' : ''), 'aria-label': c,
          onClick: (e) => { e.preventDefault(); setEmoji(c) },
        }, c)),
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '项目目录',
        defaults.loaded && defaults.workspace
          ? el('button', {
            type: 'button', className: 'field-reset', title: '填入 DSH 默认工作区',
            onClick: (e) => { e.preventDefault(); setPath(defaults.workspace) },
          }, '默认工作区')
          : null,
      ),
      el('input', {
        className: 'mono', value: path, autoComplete: 'off',
        placeholder: defaults.loaded ? (defaults.workspace || 'C:\\projects\\demo') : '正在读取默认工作区…',
        onChange: (e) => setPath(e.target.value), onKeyDown: onKey,
      }),
      el('div', { className: 'field-hint' }, defaults.workspace
        ? 'DSH 默认工作区：' + shortPath(defaults.workspace, 48)
        : '可手填绝对路径（需在用户目录 / DSH 工作区内）'),
    ),
    el('div', { className: 'field' },
      el('label', null, '界面布局'),
      el('div', { className: 'layout-row' },
        LAYOUTS.map((item) => el('button', {
          key: item.id, type: 'button', className: 'layout-card' + (item.id === layout ? ' on' : ''), title: item.hint,
          onClick: (e) => { e.preventDefault(); setLayout(item.id) },
        },
          el(LayoutSketch, { layout: item.id }),
          el('span', { className: 'lc-label' }, item.label),
          el('small', { className: 'lc-k' }, item.hint),
        )),
      ),
    ),
    el('div', { className: 'field' },
      el('label', null, '绑定 DSH 对话'),
      el('select', {
        className: 'wt-select', value: sessionId, onChange: (e) => setSessionId(e.target.value),
      },
        el('option', { value: '' }, '不绑定（稍后可绑）'),
        rows.slice(0, 50).map((s) => el('option', { key: s.id, value: s.id },
          (s.title || s.id) + ' · ' + STATES[normState(s.state)].label)),
      ),
      el('div', { className: 'field-hint' }, rows.length
        ? '共 ' + rows.length + ' 个宿主对话可选'
        : (store.sessions.state === 'pending' ? '正在读取宿主对话…' : '宿主暂无对话')),
    ),
  )
}

/* ---------- 编辑 ---------- */

function EditProjectModal({ pid }) {
  useStore()
  const project = projectOf(pid)
  if (!project) return null
  const [name, setName] = useState(project.alias || project.name)
  const [path, setPath] = useState(project.path || '')
  const [icon, setIcon] = useState(project.icon || '')
  const [note, setNote] = useState(project.note || '')
  const [folder, setFolder] = useState(project.folder || '')

  const save = () => {
    if (!String(name).trim()) return
    updateProject(pid, { name, alias: name, path, icon, note, folder })
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
        i === 0 ? el('small', null, '主') : null,
        el('button', {
          type: 'button', className: 'bc-x', title: '解除绑定',
          onClick: () => unbindSession(pid, s.id),
        }, '✕'),
      )),
    ) : el('div', { className: 'modal-note' }, '还没有绑定任何对话'),
    state === 'error' ? el('div', { className: 'modal-note err' }, '读取会话失败：' + (store.sessions.error || '未知原因')) : null,
    state === 'pending' ? el('div', { className: 'modal-note' }, '正在读取会话…') : null,
    el('div', { className: 'session-list' },
      rows.length
        ? rows.slice(0, 80).map((s) => {
          const on = project.sessions.includes(s.id)
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
            el('span', { className: 'sr-act' }, on ? '已绑定' : '绑定'),
          )
        })
        : el('div', { className: 'empty' }, state === 'pending' ? '读取中…' : '宿主没有返回任何会话'),
    ),
  )
}
