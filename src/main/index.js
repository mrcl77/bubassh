import { app, BrowserWindow, Menu, nativeImage, shell, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerIpc } from './ipc.js'

// Wymuszamy ciemny motyw na poziomie systemu (okna dialogowe itd.)
nativeTheme.themeSource = 'dark'

const isMac = process.platform === 'darwin'

// W trybie deweloperskim pokazujemy własną ikonę (w produkcji robi to electron-builder).
const devIconPath = path.join(__dirname, '../../build/icon.png')
const devIcon = fs.existsSync(devIconPath) ? devIconPath : null

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 620,
    minWidth: 740,
    minHeight: 460,
    backgroundColor: '#0f1115',
    show: false,
    title: 'BubaSSH',
    ...(devIcon && !isMac ? { icon: devIcon } : {}),
    // Własny pasek tytułu: na macOS natywne „światła” z ukrytym paskiem,
    // na Windows/Linux okno bezramkowe z własnymi przyciskami okna.
    ...(isMac
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 13, y: 11 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => {
    if (!process.env.BABYSSH_SMOKE) win.show()
  })

  // Tryb smoke-test (CI/weryfikacja): bez okna, auto-zamknięcie po załadowaniu,
  // przechwytuje błędy renderera/preloadu i kończy z odpowiednim kodem wyjścia.
  if (process.env.BABYSSH_SMOKE) {
    let hadError = false
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) {
        hadError = true
        console.log('RENDERER_ERROR:', message)
      }
    })
    win.webContents.on('did-finish-load', async () => {
      // poczekaj aż renderer wczyta katalog lokalny i wyrenderuje oba panele
      await new Promise((r) => setTimeout(r, 1200))
      let localRows = -1
      let remotePrompt = false
      let hlBg = ''
      let tbInfo = ''
      let bodyStyle = ''
      try {
        localRows = await win.webContents.executeJavaScript("document.querySelectorAll('#local-pane .prow').length")
        remotePrompt = await win.webContents.executeJavaScript("!!document.querySelector('#remote-pane .empty')")
        hlBg = await win.webContents.executeJavaScript(
          "(()=>{const d=document.createElement('div');d.className='prow hl';document.body.appendChild(d);const b=getComputedStyle(d).backgroundColor;d.remove();return b})()"
        )
        tbInfo = await win.webContents.executeJavaScript(
          "(()=>document.querySelectorAll('#titlebar .tb-btn').length + '|' + document.body.className)()"
        )
        bodyStyle = await win.webContents.executeJavaScript(
          "(()=>{const s=getComputedStyle(document.body);return s.backgroundColor+' / '+s.color})()"
        )
      } catch (e) {
        hadError = true
        console.log('PROBE_ERROR:', e.message)
      }
      console.log('LOCAL_ROWS=' + localRows)
      console.log('REMOTE_PROMPT=' + remotePrompt)
      console.log('HL_BG=' + hlBg)
      console.log('TITLEBAR=' + tbInfo)
      console.log('BODY=' + bodyStyle)
      const hlOk = !!hlBg && hlBg.replace(/\s/g, '') !== 'rgba(0,0,0,0)' && hlBg !== 'transparent'
      const tbOk = tbInfo.startsWith('3|') && /platform-\w+/.test(tbInfo)
      const shapeOk = localRows >= 1 && remotePrompt === true && hlOk && tbOk
      console.log(hadError || !shapeOk ? 'BABYSSH_SMOKE_FAIL' : 'BABYSSH_SMOKE_OK')
      app.exit(hadError || !shapeOk ? 1 : 0)
    })
  }

  // Linki zewnętrzne otwieramy w przeglądarce, nie w oknie aplikacji.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (isMac && devIcon && app.dock) app.dock.setIcon(nativeImage.createFromPath(devIcon))

  registerIpc(win)
  return win
}

app.whenReady().then(() => {
  if (!isMac) Menu.setApplicationMenu(null) // bezramkowe Win/Linux — bez natywnego menu
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
