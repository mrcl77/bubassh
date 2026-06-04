// Drobne helpery DOM — bez frameworka.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v)
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v)
    } else if (v === true) node.setAttribute(k, '')
    else node.setAttribute(k, v)
  }
  append(node, children)
  return node
}

function append(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue
    if (Array.isArray(c)) append(node, c)
    else node.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—'
  if (n < 1024) return n + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i]
}

export function fmtSpeed(bps) {
  if (!bps || bps <= 0) return ''
  return fmtBytes(bps) + '/s'
}

export function fmtDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

let toastRoot
export function toast(message, type = 'info', timeout = 4000) {
  if (!toastRoot) toastRoot = document.getElementById('toast-root')
  const node = el('div', { class: `toast toast-${type}` }, message)
  toastRoot.append(node)
  setTimeout(() => {
    node.classList.add('out')
    setTimeout(() => node.remove(), 280)
  }, timeout)
}
