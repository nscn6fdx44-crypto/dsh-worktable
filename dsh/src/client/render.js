/**
 * 渲染层（零依赖）：Markdown → HTML、代码 → 高亮 HTML。
 *
 * 为什么不引 markdown-it / highlight.js：
 *   本插件对宿主是「装进去就能跑」的单个 bundle，没有运行时依赖；上游 dsh-worktable 的
 *   client.js 有 1.4 MB，很大一部分就是这两个库打进去的。我们只做「看文件」这一件事，
 *   够用的子集自己写，bundle 只多十几 KB，也不用担心离线装不上。
 *
 * 两条硬规矩：
 *   1. 所有用户文本先 escape 再拼标签 —— 文件内容是不可信输入，绝不能让 <script> 生效。
 *   2. 不生成任何可导航的 href（相对链接一律降级成纯文本），避免把面板导航到宿主页面去了。
 */

/* ============================ 类型判定 ============================ */

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd)$/i
const CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|json|jsonc|css|scss|less|html?|xml|vue|svelte|ya?ml|toml|ini|conf|sh|bash|zsh|ps1|bat|cmd|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|sql|graphql|lua|dart|swift)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i
const PDF_RE = /\.pdf$/i
const VIDEO_RE = /\.(mp4|webm|ogv|mov)$/i
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i
/* svg 是文本又是图片：按「代码高亮」看更实用（也能直接内嵌显示，见 imageKindOf） */
const SVG_RE = /\.svg$/i

/**
 * 一个文件该用哪种视图。
 * @returns {'markdown'|'code'|'image'|'pdf'|'video'|'audio'|'text'}
 */
export function viewKindOf(name) {
  const n = String(name || '')
  if (MARKDOWN_RE.test(n)) return 'markdown'
  if (PDF_RE.test(n)) return 'pdf'
  if (IMAGE_RE.test(n)) return 'image'
  if (VIDEO_RE.test(n)) return 'video'
  if (AUDIO_RE.test(n)) return 'audio'
  if (SVG_RE.test(n)) return 'code'
  if (CODE_RE.test(n)) return 'code'
  return 'text'
}

/** 媒体类（编辑器里没有「文本」可言，只能交给浏览器渲染） */
export function isMediaKind(kind) {
  return kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio'
}

/** 有「预览 / 编辑」两种看法：Markdown 与代码 */
export function hasPreview(kind) {
  return kind === 'markdown' || kind === 'code'
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

/** 高亮用的语言标签 */
export function langOf(name) {
  const ext = extOf(name)
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') return 'js'
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx' || ext === 'json' || ext === 'jsonc') return 'js'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css'
  if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'vue' || ext === 'svelte' || ext === 'svg') return 'html'
  return ''
}

/** 扩展名 → 图标（文件列表与标签页共用） */
export function kindEmoji(kind) {
  return {
    markdown: '📝', code: '⌨️', image: '🖼️', pdf: '📕', video: '🎬', audio: '🎵', text: '📄',
  }[kind] || '📄'
}

/* ============================ 公共工具 ============================ */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c])
}

/** 路径拼接：只处理「相对 + ../」，不做 IO */
export function joinFs(dir, rel) {
  const base = String(dir || '')
  if (!base) return String(rel || '')
  const win = base.includes('\\')
  const sep = win ? '\\' : '/'
  const abs = base.startsWith('/')
  const parts = (base + sep + rel).split(/[\\/]+/)
  const out = []
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      /* 不越过盘符 / 根：'C:' 或 out 为空时停住 */
      if (out.length > 1) out.pop()
      continue
    }
    out.push(seg)
  }
  if (win && /^[A-Za-z]:$/.test(out[0] || '')) return out[0] + sep + out.slice(1).join(sep)
  if (abs) return '/' + out.join(sep)
  return out.join(sep)
}

/* ============================ 代码高亮 ============================ */

const JS_KW = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'void', 'yield',
  'class', 'extends', 'super', 'this', 'static', 'get', 'set', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'import', 'export', 'from', 'as',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'debugger', 'with',
])
const JS_BUILTIN = new Set(['console', 'window', 'document', 'process', 'require', 'module', 'exports', 'globalThis', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Error', 'Map', 'Set', 'Date', 'RegExp'])

const HL = {
  c: 'hl-c',   // 注释
  s: 'hl-s',   // 字符串
  n: 'hl-n',   // 数字
  k: 'hl-k',   // 关键字
  f: 'hl-f',   // 函数调用
  t: 'hl-t',   // 标签
  a: 'hl-a',   // 属性
  p: 'hl-p',   // 属性名 / 内置对象
}

function span(cls, text) {
  return '<span class="' + cls + '">' + escapeHtml(text) + '</span>'
}

/**
 * 通用扫描：一条 master regex 从左到右吃掉整段代码，空隙原样 escape。
 * 单趟扫描（而不是「先包标签再补规则」）才能保证注释/字符串里的内容不会被二次高亮。
 */
function scan(code, re, classify) {
  let out = ''
  let last = 0
  let m
  re.lastIndex = 0
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index))
    out += classify(m)
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex += 1
  }
  out += escapeHtml(code.slice(last))
  return out
}

const JS_RE = new RegExp(
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)'                                  // 1 注释
  + '|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)'  // 2 字符串
  + '|\\b(0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b'      // 3 数字
  + '|\\b([A-Za-z_$][\\w$]*)\\b'                                            // 4 标识符
  + '|([{}()\\[\\];,.:?!<>+\\-*/%=&|^~]+)',                                // 5 标点
  'g',
)

function highlightJs(code) {
  return scan(code, JS_RE, (m) => {
    if (m[1]) return span(HL.c, m[1])
    if (m[2]) return span(HL.s, m[2])
    if (m[3]) return span(HL.n, m[3])
    if (m[4]) {
      const w = m[4]
      if (JS_KW.has(w)) return span(HL.k, w)
      if (JS_BUILTIN.has(w)) return span(HL.p, w)
      /* 后面紧跟 ( 的是函数调用 */
      const after = code.slice(m.index + w.length).match(/^\s*\(/)
      if (after) return span(HL.f, w)
      return escapeHtml(w)
    }
    return escapeHtml(m[5] || '')
  })
}

const CSS_RE = new RegExp(
  '(\\/\\*[\\s\\S]*?\\*\\/)'                      // 1 注释
  + '|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')'  // 2 字符串
  + '|(@[\\w-]+)'                                 // 3 at 规则
  + '|(#(?:[0-9a-fA-F]{3,8})\\b)'                 // 4 颜色
  + '|(-?\\d*\\.?\\d+(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?)'  // 5 数字
  + '|([A-Za-z-]+)(?=\\s*:)',                     // 6 属性名
  'g',
)

function highlightCss(code) {
  return scan(code, CSS_RE, (m) => {
    if (m[1]) return span(HL.c, m[1])
    if (m[2]) return span(HL.s, m[2])
    if (m[3]) return span(HL.k, m[3])
    if (m[4]) return span(HL.n, m[4])
    if (m[5]) return span(HL.n, m[5])
    if (m[6]) return span(HL.p, m[6])
    return escapeHtml(m[0])
  })
}

const HTML_RE = new RegExp(
  '(<!--[\\s\\S]*?-->)'                    // 1 注释
  + '|(<\\/?)([A-Za-z][\\w:.-]*)'          // 2/3 标签
  + '|([A-Za-z_:][\\w:.-]*)(?=\\s*=)'      // 4 属性名
  + '|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',  // 5 属性值
  'g',
)

function highlightHtml(code) {
  return scan(code, HTML_RE, (m) => {
    if (m[1]) return span(HL.c, m[1])
    if (m[3]) return escapeHtml(m[2]) + span(HL.t, m[3])
    if (m[4]) return span(HL.a, m[4])
    if (m[5]) return span(HL.s, m[5])
    return escapeHtml(m[0])
  })
}

/**
 * 代码 → 高亮 HTML（已 escape，可安全塞进 dangerouslySetInnerHTML）。
 * @param {string} code
 * @param {string} [lang] 'js' | 'css' | 'html'，其它/缺省 → 纯 escape
 */
export function highlightCode(code, lang) {
  const src = String(code ?? '')
  if (lang === 'js') return highlightJs(src)
  if (lang === 'css') return highlightCss(src)
  if (lang === 'html') return highlightHtml(src)
  return escapeHtml(src)
}

/* ============================ Markdown ============================ */

const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#-]*)\s*$/
const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*)$/
const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const RE_QUOTE = /^\s{0,3}>\s?/
const RE_UL = /^(\s*)([-*+])\s+(.*)$/
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** 表格行 → 单元格 */
function cellsOf(line) {
  let s = String(line).trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/**
 * 行内标记。**先 escape**，再按占位符保护 code span，最后套粗体/斜体/链接。
 * @param {string} text 原始文本
 * @param {{dir?:string, imageUrl?:(abs:string)=>string}} ctx
 */
export function renderInline(text, ctx = {}) {
  const raw = String(text ?? '')
  const codes = []
  /* 行内代码先抽走：里面的 `*` `_` 不能再当强调符号 */
  let s = raw.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code)
    return '\u0000C' + (codes.length - 1) + '\u0000'
  })

  s = escapeHtml(s)

  /* 图片：只有 http(s)/data: 与本地相对路径能渲染；其它（比如 javascript:）直接丢掉 */
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, title) => {
    const url = imageSrcOf(src, ctx)
    if (!url) return escapeHtml(alt || '')
    return '<img class="ed-md-img" src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || '') + '"'
      + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>'
  })

  /* 链接：外链放开（新窗口），内链/相对路径降级成纯文本（不把面板导航走） */
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, label, href) => {
    if (/^(https?:|mailto:)/i.test(href)) {
      return '<a class="ed-md-a" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
    }
    return '<span class="ed-md-inner" title="' + escapeHtml(href) + '">' + label + '</span>'
  })

  /* 自动链接：<https://...> 已被 escape 成 &lt;https://...&gt; */
  s = s.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_m, href) =>
    '<a class="ed-md-a" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(href) + '</a>')

  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>').replace(/__([^\n]+?)__/g, '<b>$1</b>')
  s = s.replace(/(^|[\s（(])\*([^*\n]+?)\*/g, '$1<i>$2</i>').replace(/(^|[\s（(])_([^_\n]+?)_/g, '$1<i>$2</i>')
  s = s.replace(/~~([^\n]+?)~~/g, '<del>$1</del>')

  /* 硬换行：行尾两个空格 */
  s = s.replace(/ {2,}\n/g, '<br>\n')
  s = s.replace(/\n/g, '\n')

  /* 还原 code span（内容也 escape 过，安全） */
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i) => '<code class="ed-md-code-inline">' + escapeHtml(codes[Number(i)] ?? '') + '</code>')
  return s
}

function imageSrcOf(src, ctx) {
  const s = String(src || '').trim()
  if (/^data:image\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z]+:/i.test(s)) return ''            // file: / javascript: 一律不认
  if (!ctx.imageUrl) return ''
  const abs = s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)
    ? s
    : joinFs(ctx.dir || '', s.replace(/^\.\//, ''))
  return ctx.imageUrl(abs)
}

/**
 * Markdown → HTML。
 * 支持的子集：标题 / 围栏代码 / 引用 / 有序无序列表（含一级嵌套）/ 表格 / 分隔线 /
 * 段落 + 行内粗斜体、行内代码、删除线、链接、图片。
 * @param {string} src
 * @param {{dir?:string, imageUrl?:(abs:string)=>string}} [ctx]
 */
export function renderMarkdown(src, ctx = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  return renderBlocks(lines, ctx).join('\n')
}

function isBlockStart(line) {
  return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_HR.test(line) || RE_QUOTE.test(line)
    || RE_UL.test(line) || RE_OL.test(line)
}

function renderBlocks(lines, ctx) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    /* 空行 */
    if (!line.trim()) { i += 1; continue }

    /* 围栏代码 */
    const fence = RE_FENCE.exec(line)
    if (fence) {
      const mark = fence[1]
      const lang = (fence[2] || '').toLowerCase()
      const body = []
      i += 1
      while (i < lines.length && !new RegExp('^\\s{0,3}' + mark[0] + '{3,}\\s*$').test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1    // 吃掉收尾围栏（缺失就吃到结尾）
      const code = body.join('\n')
      out.push('<pre class="ed-md-pre"><code>' + highlightCode(code, normLang(lang)) + '</code></pre>')
      continue
    }

    /* 分隔线（要在列表之前判：--- 会和 - 列表打架） */
    if (RE_HR.test(line)) { out.push('<hr class="ed-md-hr">'); i += 1; continue }

    /* 标题 */
    const head = RE_HEAD.exec(line)
    if (head) {
      const lv = head[1].length
      out.push('<h' + lv + ' class="ed-md-h' + lv + '">' + renderInline(head[2].replace(/\s+#+\s*$/, ''), ctx) + '</h' + lv + '>')
      i += 1
      continue
    }

    /* 引用 */
    if (RE_QUOTE.test(line)) {
      const body = []
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        body.push(lines[i].replace(RE_QUOTE, ''))
        i += 1
      }
      out.push('<blockquote class="ed-md-quote">' + renderBlocks(body, ctx).join('\n') + '</blockquote>')
      continue
    }

    /* 表格 */
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const head = cellsOf(line)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cellsOf(lines[i]))
        i += 1
      }
      out.push('<table class="ed-md-table"><thead><tr>'
        + head.map((c) => '<th>' + renderInline(c, ctx) + '</th>').join('')
        + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + head.map((_h, k) => '<td>' + renderInline(r[k] ?? '', ctx) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>')
      continue
    }

    /* 列表 */
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const r = renderList(lines, i, ctx)
      out.push(r.html)
      i = r.next
      continue
    }

    /* 段落：一直吃到空行或下一个块 */
    const para = []
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) {
      para.push(lines[i])
      i += 1
      if (i < lines.length && RE_TABLE_SEP.test(lines[i]) && lines[i - 1].includes('|')) break
    }
    out.push('<p class="ed-md-p">' + renderInline(para.join('\n'), ctx) + '</p>')
  }
  return out
}

function renderList(lines, start, ctx) {
  const first = RE_UL.exec(lines[start]) || RE_OL.exec(lines[start])
  const ordered = !!RE_OL.exec(lines[start])
  const baseIndent = first[1].length
  const items = []
  let i = start
  let cur = null

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      /* 空行后如果还是同级项，继续；否则结束 */
      const nxt = lines[i + 1]
      if (nxt == null) break
      const n = RE_UL.exec(nxt) || RE_OL.exec(nxt)
      if (!n || n[1].length !== baseIndent) break
      i += 1
      continue
    }
    const ul = RE_UL.exec(line)
    const ol = RE_OL.exec(line)
    const m = ul || ol
    if (m && m[1].length === baseIndent) {
      cur = { text: [m[3]], sub: [] }
      items.push(cur)
      i += 1
      continue
    }
    /* 缩进更深的续行：先当子块收着 */
    if (cur && (line.match(/^\s*/)[0].length > baseIndent || !m)) {
      cur.sub.push(line.replace(new RegExp('^\\s{0,' + (baseIndent + 4) + '}'), ''))
      i += 1
      continue
    }
    break
  }

  const tag = ordered ? 'ol' : 'ul'
  const html = '<' + tag + ' class="ed-md-list">'
    + items.map((it) => {
      const sub = it.sub.length ? renderBlocks(it.sub, ctx).join('\n') : ''
      return '<li>' + renderInline(it.text.join('\n'), ctx) + sub + '</li>'
    }).join('')
    + '</' + tag + '>'
  return { html, next: i }
}

function normLang(lang) {
  if (!lang) return ''
  if (['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'json', 'jsx'].includes(lang)) return 'js'
  if (['css', 'scss', 'less'].includes(lang)) return 'css'
  if (['html', 'htm', 'xml', 'svg', 'vue'].includes(lang)) return 'html'
  return ''
}
