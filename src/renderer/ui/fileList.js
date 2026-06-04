import { el, clear, fmtBytes } from '../dom.js'

// Ścieżki zdalne są POSIX-owe.
export function joinPath(dir, name) {
  if (dir === '/') return '/' + name
  return dir.replace(/\/+$/, '') + '/' + name
}

export function parentPath(dir) {
  if (dir === '/' || !dir) return '/'
  const parts = dir.replace(/\/+$/, '').split('/').slice(0, -1)
  return parts.join('/') || '/'
}

function baseName(p) {
  if (!p) return '~'
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : '/'
}

function sortEntries(a, b) {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return a.name.localeCompare(b.name, 'pl')
}

function iconBtn(glyph, title, onClick, kind) {
  return el(
    'button',
    {
      class: `btn btn-icon ${kind === 'danger' ? 'btn-icon-danger' : ''} ${kind === 'accent' ? 'btn-icon-accent' : ''}`,
      title,
      onClick: (ev) => {
        ev.stopPropagation()
        onClick()
      }
    },
    glyph
  )
}

function navigateInto(side, entry, state, actions) {
  if (side === 'local') actions.localNavigate(entry.path)
  else actions.remoteNavigate(joinPath(state.remote.cwd, entry.name))
}

function transfer(side, entry, state, actions) {
  if (side === 'local') actions.uploadLocal([entry.path])
  else actions.downloadRemote([entry])
}

function row(entry, side, state, actions) {
  const isLocal = side === 'local'
  const icon = entry.isDir ? '📁' : '📄'
  const nameEl = entry.isDir
    ? el(
        'button',
        { class: 'pname dir', onClick: () => navigateInto(side, entry, state, actions) },
        el('span', { class: 'ic' }, icon),
        entry.name
      )
    : el('span', { class: 'pname' }, el('span', { class: 'ic' }, icon), entry.name)

  const acts = el('div', { class: 'prow-actions' })
  if (isLocal) {
    if (!entry.isDir) acts.append(iconBtn('→', 'Upload to server', () => actions.uploadLocal([entry.path]), 'accent'))
  } else {
    if (!entry.isDir) acts.append(iconBtn('⬇', 'Download', () => actions.downloadRemote([entry]), 'accent'))
    acts.append(iconBtn('✎', 'Rename', () => actions.renameRemote(entry)))
    acts.append(iconBtn('🗑', 'Delete', () => actions.removeRemote(entry), 'danger'))
  }

  const hl = state[side].highlight && state[side].highlight.has(entry.name) ? ' hl' : ''
  const r = el(
    'div',
    {
      class: 'prow' + hl,
      ondblclick: () => (entry.isDir ? navigateInto(side, entry, state, actions) : transfer(side, entry, state, actions))
    },
    el('div', { class: 'prow-name' }, nameEl),
    el('div', { class: 'prow-size' }, entry.isDir ? '' : fmtBytes(entry.size)),
    acts
  )

  // Przeciąganie plików między panelami (foldery pomijamy — brak rekursji w v1).
  if (!entry.isDir) {
    r.draggable = true
    r.addEventListener('dragstart', (e) => {
      if (isLocal) {
        e.dataTransfer.setData('application/x-bubassh-local', JSON.stringify([entry.path]))
      } else {
        e.dataTransfer.setData(
          'application/x-bubassh-remote',
          JSON.stringify([{ remotePath: joinPath(state.remote.cwd, entry.name), name: entry.name, size: entry.size }])
        )
      }
      e.dataTransfer.effectAllowed = 'copy'
    })
  }
  return r
}

function upRow(side, target, state, actions) {
  return el(
    'div',
    { class: 'prow prow-up', onClick: () => (side === 'local' ? actions.localNavigate(target) : actions.remoteNavigate(target)) },
    el('div', { class: 'prow-name' }, el('span', { class: 'pname' }, el('span', { class: 'ic' }, '📁'), '..'))
  )
}

function paneHead(side, state, actions) {
  const isLocal = side === 'local'
  const data = isLocal ? state.local : state.remote
  const head = el('div', { class: 'pane-head' })
  head.append(el('span', { class: 'pane-label' }, isLocal ? 'LOCAL' : 'REMOTE'))

  if (!isLocal && !state.connected) {
    head.append(el('span', { class: 'pane-path muted' }, '— not connected'))
    return head
  }

  const canUp = isLocal ? !!state.local.parent : state.remote.cwd !== '/'
  head.append(el('span', { class: 'pane-path', title: data.cwd || '' }, baseName(data.cwd)))
  head.append(el('div', { class: 'spacer' }))
  head.append(
    el(
      'button',
      { class: 'btn btn-icon', title: 'Up', disabled: !canUp, onClick: () => (isLocal ? actions.localUp() : actions.remoteUp()) },
      '↑'
    )
  )
  head.append(
    el('button', { class: 'btn btn-icon', title: 'Refresh', onClick: () => (isLocal ? actions.localRefresh() : actions.remoteRefresh()) }, '↻')
  )
  if (!isLocal) {
    head.append(el('button', { class: 'btn btn-icon', title: 'New folder', onClick: actions.makeDir }, '＋'))
    head.append(el('button', { class: 'btn btn-icon', title: 'Upload file…', onClick: actions.uploadDialog }, '⬆'))
  }
  return head
}

function renderPane(side, state, actions) {
  const isLocal = side === 'local'
  const root = document.getElementById(isLocal ? 'local-pane' : 'remote-pane')
  clear(root)
  root.append(paneHead(side, state, actions))

  const list = el('div', { class: 'pane-list' })

  if (!isLocal && !state.connected) {
    list.append(
      el('div', { class: 'empty' }, 'Connect to a server', el('br'), 'to browse and transfer files.')
    )
    root.append(list)
    return
  }

  const data = isLocal ? state.local : state.remote
  if (data.loading) {
    list.append(el('div', { class: 'empty' }, 'Loading…'))
    root.append(list)
    return
  }

  if (isLocal && state.local.parent) list.append(upRow('local', state.local.parent, state, actions))
  if (!isLocal && state.remote.cwd !== '/') list.append(upRow('remote', parentPath(state.remote.cwd), state, actions))

  const entries = [...(data.entries || [])].sort(sortEntries)
  for (const entry of entries) list.append(row(entry, side, state, actions))
  if (entries.length === 0) list.append(el('div', { class: 'empty empty-small' }, 'Empty folder'))
  root.append(list)
}

export function renderPanes(state, actions) {
  renderPane('local', state, actions)
  renderPane('remote', state, actions)
}
