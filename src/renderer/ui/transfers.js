import { el, clear, fmtBytes, fmtSpeed } from '../dom.js'

function fmtEta(s) {
  if (s == null || !isFinite(s) || s < 0) return ''
  s = Math.round(s)
  if (s < 60) return `${s}s left`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

function pctOf(t) {
  if (t.total) return Math.min(100, Math.round((t.transferred / t.total) * 100))
  return t.status === 'done' ? 100 : 0
}

function renderTransfer(t) {
  const pct = pctOf(t)
  const active = t.status === 'active' || t.status === 'queued'
  const dirIcon = t.direction === 'upload' ? '⬆' : '⬇'

  let meta
  if (t.status === 'error') meta = el('span', { class: 'pmeta err' }, t.error || 'error')
  else if (t.status === 'done')
    meta = el('span', { class: 'pmeta ok' }, (t.failed ? `done, ${t.failed} failed · ` : 'done · ') + fmtBytes(t.total))
  else if (t.status === 'queued') meta = el('span', { class: 'pmeta' }, 'queued')
  else {
    const parts = [`${pct}%`, `${fmtBytes(t.transferred)} / ${fmtBytes(t.total)}`]
    const speed = fmtSpeed(t.speed)
    if (speed) parts.push(speed)
    const eta = fmtEta(t.eta)
    if (eta) parts.push(eta)
    meta = el('span', { class: 'pmeta' }, parts.join(' · '))
  }

  const rows = [
    el(
      'div',
      { class: 'transfer-top' },
      el('span', { class: 'transfer-dir' }, dirIcon),
      el('span', { class: 'transfer-name', title: t.name }, (t.isDir ? '📁 ' : '') + t.name),
      el('div', { class: 'spacer' }),
      meta
    ),
    el(
      'div',
      { class: 'pbar' },
      el('div', { class: `pfill ${t.status}${active && !t.total ? ' indet' : ''}`, style: { width: pct + '%' } })
    )
  ]

  // Druga linia dla folderów: bieżący plik + licznik plików.
  if (t.isDir && active && (t.file || t.fileCount)) {
    rows.push(
      el(
        'div',
        { class: 'transfer-sub' },
        t.file ? el('span', { class: 'transfer-file', title: t.file }, t.file) : el('span'),
        t.fileCount ? el('span', { class: 'transfer-counter' }, `${t.fileIndex || 0} / ${t.fileCount} files`) : null
      )
    )
  }

  return el('div', { class: `transfer ${t.status}` }, rows)
}

export function renderTransfers(state, actions) {
  const root = document.getElementById('transfers')
  clear(root)
  const items = [...state.transfers.values()]
  const active = items.filter((t) => t.status === 'active' || t.status === 'queued')

  // Zbiorczy postęp wszystkich aktywnych/kolejkowanych transferów.
  let aggTotal = 0
  let aggDone = 0
  let aggSpeed = 0
  for (const t of active) {
    if (t.total) {
      aggTotal += t.total
      aggDone += Math.min(t.transferred || 0, t.total)
    }
    if (t.speed) aggSpeed += t.speed
  }
  const aggPct = aggTotal ? Math.min(100, Math.round((aggDone / aggTotal) * 100)) : 0

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

  if (active.length && aggTotal) {
    root.append(
      el(
        'div',
        { class: 'transfers-agg' },
        el('div', { class: 'pbar pbar-agg' }, el('div', { class: 'pfill', style: { width: aggPct + '%' } })),
        el(
          'span',
          { class: 'transfers-agg-meta' },
          `${aggPct}% · ${fmtBytes(aggDone)} / ${fmtBytes(aggTotal)}${aggSpeed ? ' · ' + fmtSpeed(aggSpeed) : ''}`
        )
      )
    )
  }

  if (!items.length) {
    root.append(el('div', { class: 'transfers-empty muted' }, 'Upload and download progress will appear here.'))
    return
  }

  const listEl = el('div', { class: 'transfers-list' })
  for (const t of items.slice(-8).reverse()) listEl.append(renderTransfer(t))
  root.append(listEl)
}
