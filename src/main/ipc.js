import { ipcMain, dialog } from 'electron'
import path from 'node:path'
import { createSession } from './sessions/index.js'
import { TransferManager } from './transfers.js'
import { listLocal } from './local.js'
import {
  listProfiles,
  saveProfile,
  deleteProfile,
  hydrateProfile,
  encryptionAvailable
} from './profiles.js'

let session = null // jedno aktywne połączenie na raz (proste i przewidywalne)
let win = null
let transfers = null

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// Ścieżki zdalne są zawsze POSIX-owe (/), niezależnie od systemu klienta.
function remoteJoin(dir, name) {
  return path.posix.join(dir || '/', name)
}

export function registerIpc(mainWindow) {
  win = mainWindow
  transfers = new TransferManager({ getSession: () => session, emit })

  ipcMain.handle('connect', async (_e, payload) => {
    if (session) {
      try {
        await session.disconnect()
      } catch {
        /* ignore */
      }
      session = null
    }
    let profile = payload || {}
    if (profile.profileId) {
      const hydrated = hydrateProfile(profile.profileId)
      if (!hydrated) throw new Error('Saved server not found')
      profile = hydrated
    }
    const s = createSession(profile.protocol)
    const cwd = await s.connect(profile)
    session = s
    const entries = await s.list(cwd)
    return {
      cwd: session.cwd,
      entries,
      info: { host: profile.host, protocol: profile.protocol, username: profile.username }
    }
  })

  ipcMain.handle('disconnect', async () => {
    if (session) {
      try {
        await session.disconnect()
      } catch {
        /* ignore */
      }
    }
    session = null
    return { ok: true }
  })

  ipcMain.handle('list', async (_e, dir) => {
    if (!session) throw new Error('Not connected')
    const entries = await session.list(dir)
    return { cwd: session.cwd, entries }
  })

  ipcMain.handle('mkdir', async (_e, remotePath) => {
    if (!session) throw new Error('Not connected')
    await session.mkdir(remotePath)
    return { ok: true }
  })

  ipcMain.handle('rename', async (_e, { from, to }) => {
    if (!session) throw new Error('Not connected')
    await session.rename(from, to)
    return { ok: true }
  })

  ipcMain.handle('remove', async (_e, { path: remotePath, isDir }) => {
    if (!session) throw new Error('Not connected')
    await session.remove(remotePath, isDir)
    return { ok: true }
  })

  ipcMain.handle('upload', async (_e, { paths, remoteDir }) => {
    if (!session) throw new Error('Not connected')
    const items = (paths || []).map((localPath) => {
      const name = path.basename(localPath)
      return { direction: 'upload', localPath, remotePath: remoteJoin(remoteDir, name), name }
    })
    return transfers.enqueue(items)
  })

  ipcMain.handle('download', async (_e, { items, localDir }) => {
    if (!session) throw new Error('Not connected')
    const tasks = (items || []).map((it) => ({
      direction: 'download',
      remotePath: it.remotePath,
      localPath: path.join(localDir, it.name),
      name: it.name,
      total: it.size || 0
    }))
    return transfers.enqueue(tasks)
  })

  ipcMain.handle('pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose destination folder'
    })
    return r.canceled ? '' : r.filePaths[0]
  })

  ipcMain.handle('pickKey', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Choose private key'
    })
    return r.canceled ? '' : r.filePaths[0]
  })

  ipcMain.handle('local:list', async (_e, dir) => listLocal(dir))

  ipcMain.handle('profiles:list', async () => listProfiles())
  ipcMain.handle('profiles:save', async (_e, input) => ({ id: saveProfile(input) }))
  ipcMain.handle('profiles:delete', async (_e, id) => {
    deleteProfile(id)
    return { ok: true }
  })
  ipcMain.handle('encryption:available', async () => encryptionAvailable())

  // Sterowanie oknem dla własnego paska tytułu (Windows/Linux).
  ipcMain.handle('window:minimize', () => win.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => win.close())
}
