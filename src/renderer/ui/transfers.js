import { el, clear, fmtBytes, fmtSpeed } from '../dom.js'

function renderTransfer(t) {
  const pct = t.total
    ? Math.min(100, Math.round((t.transferred / t.total) * 100))
    : t.status === 'done'
      ? 100
      : 0
  const dirIcon = t.direction === 'upload' ? '⬆' : '⬇'

  let meta
  if (t.status === 'error') meta = el('span', { class: 'pmeta err' }, t.error || 'error')
  else if (t.status === 'done') meta = el('span', { class: 'pmeta ok' }, 'done · ' + fmtBytes(t.total))
  else
    meta = el(
      'span',
      { class: 'pmeta' },
      `${pct}% · ${fmtBytes(t.transferred)} / ${fmtBytes(t.total)}${t.speed ? ' · ' + fmtSpeed(t.speed) : ''}`
    )

  return el(
    'div',
    { class: 'transfer' },
    el(
      'div',
      { class: 'transfer-top' },
      el('span', { class: 'transfer-dir' }, dirIcon),
      el('span', { class: 'transfer-name', title: t.name }, t.name),
      el('div', { class: 'spacer' }),
      meta
    ),
    el('div', { class: 'pbar' }, el('div', { class: `pfill ${t.status}`, style: { width: pct + '%' } }))
  )
}

export function renderTransfers(state, actions) {
  const root = document.getElementById('transfers')
  clear(root)
  const items = [...state.transfers.values()]
  const active = items.filter((t) => t.status === 'active' || t.status === 'queued')

  root.append(
    el(
      'div',
      { class: 'transfers-head' },
      el('span', { class: 'transfers-title' }, 'Transfers'),
      active.length
        ? el('span', { class: 'transfers-count' }, `${active.length} in progress`)
        : el('span', { class: 'transfers-count muted' }, 'none active'),
      el('div', { class: 'spacer' }),
      items.length ? el('button', { class: 'btn btn-small', onClick: actions.clearTransfers }, 'Clear') : null
    )
  )

  if (!items.length) {
    root.append(el('div', { class: 'transfers-empty muted' }, 'Upload and download progress will appear here.'))
    return
  }

  const listEl = el('div', { class: 'transfers-list' })
  for (const t of items.slice(-8).reverse()) listEl.append(renderTransfer(t))
  root.append(listEl)
}
