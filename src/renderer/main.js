import { renderConnectBar } from './ui/connectBar.js'
import { renderPanes, joinPath, parentPath } from './ui/fileList.js'
import { renderTransfers } from './ui/transfers.js'
import { openSiteManager } from './ui/siteManager.js'
import { promptModal, confirmModal } from './ui/dialogs.js'
import { toast } from './dom.js'

const state = {
  connected: false,
  connecting: false,
  info: null,
  remote: { cwd: '/', entries: [], loading: false, highlight: new Set() },
  local: { cwd: '', parent: null, entries: [], loading: true, highlight: new Set() },
  transfers: new Map(),
  form: { protocol: 'sftp', host: '', port: 22, username: '', password: '' }
}

function msg(err) {
  return (err && (err.message || err.toString())) || 'unknown error'
}

function renderAll() {
  renderConnectBar(state, actions)
  renderPanes(state, actions)
  renderTransfers(state, actions)
}

/* ---------- Zdalne ---------- */
async function connect(payload) {
  if (state.connecting) return
  state.connecting = true
  renderConnectBar(state, actions)
  renderPanes(state, actions)
  try {
    const res = await window.api.connect(payload)
    state.connected = true
    state.info = res.info
    state.remote.cwd = res.cwd
    state.remote.entries = res.entries
    state.form.password = ''
    toast('Connected', 'ok')
  } catch (err) {
    state.connected = false
    toast('Connection error: ' + msg(err), 'error')
  } finally {
    state.connecting = false
    renderAll()
  }
}

async function loadRemote(dir) {
  state.remote.loading = true
  renderPanes(state, actions)
  try {
    const res = await window.api.list(dir)
    if (res.cwd !== state.remote.cwd) state.remote.highlight.clear() // zmiana katalogu czyści podświetlenia
    state.remote.cwd = res.cwd
    state.remote.entries = res.entries
  } catch (err) {
    toast('Failed to load folder: ' + msg(err), 'error')
  } finally {
    state.remote.loading = false
    renderPanes(state, actions)
  }
}

/* ---------- Lokalne ---------- */
async function loadLocal(dir) {
  state.local.loading = true
  renderPanes(state, actions)
  try {
    const res = await window.api.listLocal(dir)
    if (res.cwd !== state.local.cwd) state.local.highlight.clear() // zmiana katalogu czyści podświetlenia
    state.local.cwd = res.cwd
    state.local.parent = res.parent
    state.local.entries = res.entries
  } catch (err) {
    toast('Failed to open local folder: ' + msg(err), 'error')
  } finally {
    state.local.loading = false
    renderPanes(state, actions)
  }
}

/* ---------- Transfery ---------- */
async function uploadPaths(paths) {
  if (!state.connected) {
    toast('Connect to a server first', 'error')
    return
  }
  if (!paths || !paths.length) return
  try {
    await window.api.upload(paths, state.remote.cwd)
  } catch (err) {
    toast('Upload error: ' + msg(err), 'error')
  }
}

async function downloadItems(items) {
  if (!items || !items.length) return
  if (!state.local.cwd) {
    toast('No local destination folder', 'error')
    return
  }
  try {
    await window.api.download(items, state.local.cwd)
  } catch (err) {
    toast('Download error: ' + msg(err), 'error')
  }
}

const actions = {
  async quickConnect() {
    const f = state.form
    if (!f.host) {
      toast('Enter host', 'error')
      return
    }
    await connect({
      protocol: f.protocol,
      host: f.host,
      port: Number(f.port) || undefined,
      username: f.username,
      password: f.password,
      authType: 'password'
    })
  },
  connectProfile(id) {
    return connect({ profileId: id })
  },
  async disconnect() {
    try {
      await window.api.disconnect()
    } catch {
      /* ignore */
    }
    state.connected = false
    state.info = null
    state.remote = { cwd: '/', entries: [], loading: false, highlight: new Set() }
    renderAll()
  },

  remoteNavigate(dir) {
    loadRemote(dir)
  },
  remoteUp() {
    if (state.remote.cwd !== '/') loadRemote(parentPath(state.remote.cwd))
  },
  remoteRefresh() {
    loadRemote(state.remote.cwd)
  },

  localNavigate(dir) {
    loadLocal(dir)
  },
  localUp() {
    if (state.local.parent) loadLocal(state.local.parent)
  },
  localRefresh() {
    loadLocal(state.local.cwd)
  },

  uploadLocal(paths) {
    return uploadPaths(paths)
  },
  downloadRemote(entries) {
    const items = entries.map((e) => ({
      remotePath: joinPath(state.remote.cwd, e.name),
      name: e.name,
      size: e.size,
      isDir: e.isDir
    }))
    return downloadItems(items)
  },
  downloadItems,

  async uploadDialog() {
    const paths = await window.api.pickFiles()
    await uploadPaths(paths)
  },
  async makeDir() {
    const name = await promptModal({ title: 'New folder', label: 'Folder name', okText: 'Create' })
    if (!name) return
    try {
      await window.api.mkdir(joinPath(state.remote.cwd, name))
      toast('Folder created', 'ok')
      loadRemote(state.remote.cwd)
    } catch (err) {
      toast('Failed to create folder: ' + msg(err), 'error')
    }
  },
  async renameRemote(entry) {
    const name = await promptModal({ title: 'Rename', value: entry.name, okText: 'Rename' })
    if (!name || name === entry.name) return
    try {
      await window.api.rename(joinPath(state.remote.cwd, entry.name), joinPath(state.remote.cwd, name))
      toast('Renamed', 'ok')
      loadRemote(state.remote.cwd)
    } catch (err) {
      toast('Rename error: ' + msg(err), 'error')
    }
  },
  async removeRemote(entry) {
    const ok = await confirmModal({
      title: 'Delete',
      message: `Delete ${entry.isDir ? 'folder' : 'file'} "${entry.name}"${entry.isDir ? ' and all its contents' : ''}?`,
      okText: 'Delete'
    })
    if (!ok) return
    try {
      await window.api.remove(joinPath(state.remote.cwd, entry.name), entry.isDir)
      toast('Deleted', 'ok')
      loadRemote(state.remote.cwd)
    } catch (err) {
      toast('Delete error: ' + msg(err), 'error')
    }
  },
  clearTransfers() {
    for (const [id, t] of [...state.transfers]) {
      if (t.status === 'done' || t.status === 'error') state.transfers.delete(id)
    }
    renderTransfers(state, actions)
  },
  openSiteManager() {
    openSiteManager(actions)
  }
}

/* ---------- Zdarzenia transferów ---------- */
function upsertTransfer(id, patch) {
  const prev = state.transfers.get(id) || { id }
  state.transfers.set(id, { ...prev, ...patch })
  renderTransfers(state, actions)
}

// Krótkie podświetlenie świeżo przeniesionego pliku w odpowiednim panelu.
function addHighlight(side, name) {
  state[side].highlight.add(name)
  setTimeout(() => {
    state[side].highlight.delete(name)
    renderPanes(state, actions)
  }, 6000)
}

window.api.on('transfer:queued', (items) => {
  for (const it of items) state.transfers.set(it.id, { ...it, transferred: 0, status: 'queued', speed: 0 })
  renderTransfers(state, actions)
})
window.api.on('transfer:start', (t) => upsertTransfer(t.id, { ...t, status: 'active' }))
window.api.on('transfer:progress', (t) => upsertTransfer(t.id, { ...t, status: 'active' }))
window.api.on('transfer:done', (t) => {
  upsertTransfer(t.id, { ...t, status: 'done', transferred: t.total })
  if (t.direction === 'upload') {
    addHighlight('remote', t.name)
    loadRemote(state.remote.cwd)
  } else {
    addHighlight('local', t.name)
    loadLocal(state.local.cwd)
  }
})
window.api.on('transfer:error', (t) => {
  upsertTransfer(t.id, { name: t.name, status: 'error', error: t.error })
  toast('Transfer failed: ' + (t.error || ''), 'error')
})

/* ---------- Drag & drop ---------- */
const localPane = document.getElementById('local-pane')
const remotePane = document.getElementById('remote-pane')

// Bez tego Electron próbowałby otworzyć upuszczony plik.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

function hasType(e, t) {
  return e.dataTransfer && [...e.dataTransfer.types].includes(t)
}

const onRemoteDragOver = (e) => {
  if (state.connected && (hasType(e, 'Files') || hasType(e, 'application/x-bubassh-local'))) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    remotePane.classList.add('drag-over')
  }
}
remotePane.addEventListener('dragenter', onRemoteDragOver)
remotePane.addEventListener('dragover', onRemoteDragOver)
remotePane.addEventListener('dragleave', (e) => {
  if (!remotePane.contains(e.relatedTarget)) remotePane.classList.remove('drag-over')
})
remotePane.addEventListener('drop', (e) => {
  e.preventDefault()
  remotePane.classList.remove('drag-over')
  if (!state.connected) {
    toast('Connect to a server first', 'error')
    return
  }
  const files = [...(e.dataTransfer?.files || [])]
  if (files.length) {
    let paths = []
    try {
      paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
    } catch {
      /* ignore */
    }
    if (!paths.length) {
      toast('Could not read the dropped files — use the → button to upload', 'error')
      return
    }
    uploadPaths(paths)
    return
  }
  const internal = e.dataTransfer.getData('application/x-bubassh-local')
  if (internal) {
    try {
      uploadPaths(JSON.parse(internal))
    } catch {
      /* ignore */
    }
  }
})

const onLocalDragOver = (e) => {
  if (hasType(e, 'application/x-bubassh-remote')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    localPane.classList.add('drag-over')
  }
}
localPane.addEventListener('dragenter', onLocalDragOver)
localPane.addEventListener('dragover', onLocalDragOver)
localPane.addEventListener('dragleave', (e) => {
  if (!localPane.contains(e.relatedTarget)) localPane.classList.remove('drag-over')
})
localPane.addEventListener('drop', (e) => {
  e.preventDefault()
  localPane.classList.remove('drag-over')
  const internal = e.dataTransfer.getData('application/x-bubassh-remote')
  if (internal) {
    try {
      downloadItems(JSON.parse(internal))
    } catch {
      /* ignore */
    }
  }
})

/* ---------- Pasek tytułu ---------- */
document.body.classList.add('platform-' + (window.api.platform || 'unknown'))
{
  const tb = document.getElementById('titlebar')
  document.getElementById('tb-min').addEventListener('click', () => window.api.win.minimize())
  document.getElementById('tb-max').addEventListener('click', () => window.api.win.toggleMaximize())
  document.getElementById('tb-close').addEventListener('click', () => window.api.win.close())
  // dwuklik na pasku maksymalizuje (Win/Linux; na macOS zajmuje się tym system)
  if (window.api.platform !== 'darwin') {
    tb.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.tb-controls')) window.api.win.toggleMaximize()
    })
  }
}

/* ---------- Start ---------- */
renderAll()
loadLocal() // domyślnie katalog domowy
