import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Zdarzenia, na które renderer może się zapisać.
const EVENTS = [
  'transfer:queued',
  'transfer:start',
  'transfer:progress',
  'transfer:done',
  'transfer:error',
  'session:disconnected'
]

const api = {
  connect: (payload) => ipcRenderer.invoke('connect', payload),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  list: (dir) => ipcRenderer.invoke('list', dir),
  mkdir: (remotePath) => ipcRenderer.invoke('mkdir', remotePath),
  rename: (from, to) => ipcRenderer.invoke('rename', { from, to }),
  remove: (remotePath, isDir) => ipcRenderer.invoke('remove', { path: remotePath, isDir }),
  upload: (paths, remoteDir) => ipcRenderer.invoke('upload', { paths, remoteDir }),
  download: (items, localDir) => ipcRenderer.invoke('download', { items, localDir }),
  listLocal: (dir) => ipcRenderer.invoke('local:list', dir),
  pickFiles: () => ipcRenderer.invoke('pickFiles'),
  pickDirectory: () => ipcRenderer.invoke('pickDirectory'),
  pickKey: () => ipcRenderer.invoke('pickKey'),

  // Zamiana obiektu File (z drag&drop) na ścieżkę w systemie plików.
  // W Electron 32+ File.path zostało usunięte — to oficjalny następca.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  platform: process.platform,
  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },

  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: (input) => ipcRenderer.invoke('profiles:save', input),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id)
  },
  encryptionAvailable: () => ipcRenderer.invoke('encryption:available'),

  // Subskrypcja zdarzeń; zwraca funkcję do wypisania.
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) return () => {}
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
