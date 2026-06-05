// Integracyjny test rekurencyjnego transferu FOLDERÓW przez TransferManager
// (na lokalnym serwerze ftp-srv). Sprawdza realny postęp katalogu: sumaryczny
// `total`, licznik plików, bieżący plik oraz wierne odtworzenie drzewa w obie
// strony (upload + download). Uruchom: `npm run test:dir`.
import FtpSrv from 'ftp-srv'
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ftpSrc = path.join(projectRoot, 'src/main/sessions/ftp.js')
const tmSrc = path.join(projectRoot, 'src/main/transfers.js')
const bundlePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'babyssh-bundle-')), 'app.cjs')
await build({
  stdin: {
    contents: `export { FtpSession } from ${JSON.stringify(ftpSrc)}\nexport { TransferManager } from ${JSON.stringify(tmSrc)}`,
    resolveDir: projectRoot,
    loader: 'js'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent'
})
const mod = await import(pathToFileURL(bundlePath).href)
const { FtpSession, TransferManager } = mod.default ?? mod

const PORT = 2122
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'babyssh-dir-'))
const serverRoot = path.join(tmpRoot, 'server')
const downloadDir = path.join(tmpRoot, 'down')
mkdirSync(serverRoot, { recursive: true })
mkdirSync(downloadDir, { recursive: true })

let passed = 0
function ok(cond, label) {
  if (!cond) throw new Error('ASERCJA NIEUDANA: ' + label)
  passed++
  console.log('  ✓ ' + label)
}

let events = []
let waiters = []
function emit(channel, payload) {
  events.push({ channel, payload })
  waiters = waiters.filter((w) => {
    if (w.channel === channel) {
      w.resolve(payload)
      return false
    }
    return true
  })
}
function waitFor(channel, timeoutMs = 20000) {
  const found = events.find((e) => e.channel === channel)
  if (found) return Promise.resolve(found.payload)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + channel)), timeoutMs)
    waiters.push({ channel, resolve: (p) => { clearTimeout(t); resolve(p) } })
  })
}

const srv = new FtpSrv({ url: `ftp://127.0.0.1:${PORT}`, pasv_url: '127.0.0.1', anonymous: false })
srv.on('login', (data, resolve, reject) => {
  if (data.username === 'test' && data.password === 'test') resolve({ root: serverRoot })
  else reject(new Error('Złe dane logowania'))
})

const session = new FtpSession(false)
const tm = new TransferManager({ getSession: () => session, emit })

// Zagnieżdżone drzewo lokalne: a.bin (1MB), sub/b.bin (500KB), sub/deep/c.bin (300KB)
const SIZES = { a: 1_000_000, b: 500_000, c: 300_000 }
const TOTAL = SIZES.a + SIZES.b + SIZES.c
function buildTree() {
  const root = path.join(tmpRoot, 'tree')
  mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true })
  writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(SIZES.a, 1))
  writeFileSync(path.join(root, 'sub', 'b.bin'), Buffer.alloc(SIZES.b, 2))
  writeFileSync(path.join(root, 'sub', 'deep', 'c.bin'), Buffer.alloc(SIZES.c, 3))
  return root
}

async function run() {
  await srv.listen()
  console.log('Serwer FTP nasłuchuje na 127.0.0.1:' + PORT + '\n')
  await session.connect({ host: '127.0.0.1', port: PORT, username: 'test', password: 'test' })

  console.log('upload folderu (rekurencyjnie, z postępem):')
  const localTree = buildTree()
  events = []
  tm.enqueue([{ direction: 'upload', localPath: localTree, remotePath: '/tree', name: 'tree', isDir: true }])

  const upStart = await waitFor('transfer:start')
  ok(upStart.isDir === true, 'transfer:start oznaczony jako katalog')
  ok(upStart.total === TOTAL, `transfer:start ma sumaryczny total=${upStart.total} (oczekiwano ${TOTAL})`)
  ok(upStart.fileCount === 3, 'transfer:start ma fileCount=3')

  const upDone = await waitFor('transfer:done')
  const upProg = events.filter((e) => e.channel === 'transfer:progress').map((e) => e.payload)
  ok(upProg.length >= 3, `pojawiły się zdarzenia postępu (${upProg.length})`)
  ok(upProg.every((p) => p.total === TOTAL), 'każde zdarzenie postępu ma sumaryczny total')
  ok(upProg.some((p) => p.file && p.file.includes('c.bin')), 'postęp raportuje bieżący plik (c.bin)')
  ok(upProg.some((p) => p.fileIndex >= 1 && p.fileCount === 3), 'postęp ma licznik plików (X/3)')
  const maxT = Math.max(...upProg.map((p) => p.transferred))
  ok(maxT > SIZES.a, `transferred rośnie ponad pierwszy plik (max=${maxT})`)
  ok(upDone.failed === 0, 'transfer:done bez błędów (failed=0)')

  ok(existsSync(path.join(serverRoot, 'tree', 'a.bin')), 'serwer: tree/a.bin istnieje')
  ok(existsSync(path.join(serverRoot, 'tree', 'sub', 'b.bin')), 'serwer: tree/sub/b.bin istnieje')
  ok(existsSync(path.join(serverRoot, 'tree', 'sub', 'deep', 'c.bin')), 'serwer: tree/sub/deep/c.bin istnieje')
  ok(statSync(path.join(serverRoot, 'tree', 'sub', 'deep', 'c.bin')).size === SIZES.c, 'serwer: c.bin ma poprawny rozmiar')

  console.log('download folderu (rekurencyjnie):')
  events = []
  const outRoot = path.join(downloadDir, 'tree')
  tm.enqueue([{ direction: 'download', remotePath: '/tree', localPath: outRoot, name: 'tree', isDir: true }])
  const dlStart = await waitFor('transfer:start')
  ok(dlStart.total === TOTAL && dlStart.fileCount === 3, 'download: wykryto total + 3 pliki przez przejście drzewa')
  const dlDone = await waitFor('transfer:done')
  ok(dlDone.failed === 0, 'download zakończony bez błędów')

  ok(existsSync(path.join(outRoot, 'a.bin')), 'pobrano tree/a.bin')
  ok(existsSync(path.join(outRoot, 'sub', 'b.bin')), 'pobrano tree/sub/b.bin')
  ok(existsSync(path.join(outRoot, 'sub', 'deep', 'c.bin')), 'pobrano tree/sub/deep/c.bin')
  ok(statSync(path.join(outRoot, 'a.bin')).size === SIZES.a, 'pobrany a.bin ma poprawny rozmiar')
  ok(readFileSync(path.join(outRoot, 'sub', 'deep', 'c.bin'))[0] === 3, 'zawartość pobranego c.bin poprawna')

  await session.disconnect()
}

run()
  .then(() => {
    console.log(`\n✅ Transfer folderów e2e: wszystkie ${passed} asercje przeszły.`)
  })
  .catch((err) => {
    console.error('\n❌ Transfer folderów e2e NIEUDANY:', err.message)
    process.exitCode = 1
  })
  .finally(() => {
    try { srv.close() } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 300)
  })
