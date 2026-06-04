// Integracyjny test warstwy FTP: stawia lokalny serwer (ftp-srv) na katalogu
// tymczasowym i przepuszcza pełny cykl przez PRAWDZIWY kod aplikacji
// (FtpSession + TransferManager): connect → list → mkdir → upload (z postępem)
// → download → rename → delete. Uruchom: `npm run test:ftp`.
import FtpSrv from 'ftp-srv'
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Źródła main-process są ESM, ale w pakiecie bez "type":"module" Node widzi je
// jako CommonJS. Bundlujemy je esbuildem (z zależnościami) do samodzielnego
// modułu i importujemy — dokładnie ten sam kod, który pakuje electron-vite.
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

const PORT = 2121
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'babyssh-ftp-'))
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

// --- prosty bus zdarzeń dla TransferManagera ---
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

async function run() {
  await srv.listen()
  console.log('Serwer FTP nasłuchuje na 127.0.0.1:' + PORT + '\n')

  console.log('connect / list:')
  const cwd = await session.connect({ host: '127.0.0.1', port: PORT, username: 'test', password: 'test' })
  ok(typeof cwd === 'string', 'connect zwrócił cwd: ' + cwd)
  let entries = await session.list('/')
  ok(Array.isArray(entries) && entries.length === 0, 'pusty katalog na starcie')

  console.log('mkdir:')
  await session.mkdir('/sub')
  entries = await session.list('/')
  ok(entries.some((e) => e.name === 'sub' && e.isDir), 'utworzono i widać folder „sub”')

  console.log('upload (z postępem):')
  const localFile = path.join(tmpRoot, 'hello.bin')
  writeFileSync(localFile, Buffer.alloc(2_000_000, 7)) // 2 MB
  events = []
  tm.enqueue([{ direction: 'upload', localPath: localFile, remotePath: '/hello.bin', name: 'hello.bin' }])
  const upStart = await waitFor('transfer:start')
  ok(upStart.total === 2_000_000, 'transfer:start ma poprawny rozmiar (total=' + upStart.total + ')')
  await waitFor('transfer:done')
  const progress = events.filter((e) => e.channel === 'transfer:progress').map((e) => e.payload)
  ok(progress.length >= 1, 'pojawiły się zdarzenia postępu (' + progress.length + ')')
  ok(progress.every((p) => p.total === 2_000_000), 'każde zdarzenie postępu ma total=2MB')
  ok(progress.some((p) => p.transferred > 0), 'co najmniej jedno zdarzenie ma transferred>0')
  ok(existsSync(path.join(serverRoot, 'hello.bin')), 'plik istnieje na serwerze')
  ok(statSync(path.join(serverRoot, 'hello.bin')).size === 2_000_000, 'rozmiar pliku na serwerze = 2MB')

  console.log('download (z postępem):')
  events = []
  const localOut = path.join(downloadDir, 'hello.bin')
  tm.enqueue([{ direction: 'download', remotePath: '/hello.bin', localPath: localOut, name: 'hello.bin' }])
  const dlStart = await waitFor('transfer:start')
  ok(dlStart.total === 2_000_000, 'download: total wykryty przez SIZE = 2MB')
  await waitFor('transfer:done')
  ok(existsSync(localOut) && statSync(localOut).size === 2_000_000, 'pobrany plik ma 2MB')
  ok(readFileSync(localOut)[0] === 7, 'zawartość pobranego pliku poprawna')

  console.log('rename:')
  await session.rename('/hello.bin', '/renamed.bin')
  entries = await session.list('/')
  ok(entries.some((e) => e.name === 'renamed.bin'), 'plik po zmianie nazwy widoczny')
  ok(!entries.some((e) => e.name === 'hello.bin'), 'stara nazwa zniknęła')

  console.log('delete (plik i folder):')
  await session.remove('/renamed.bin', false)
  await session.remove('/sub', true)
  entries = await session.list('/')
  ok(entries.length === 0, 'katalog znów pusty po usunięciu')

  await session.disconnect()
}

run()
  .then(() => {
    console.log(`\n✅ FTP e2e: wszystkie ${passed} asercje przeszły.`)
  })
  .catch((err) => {
    console.error('\n❌ FTP e2e NIEUDANY:', err.message)
    process.exitCode = 1
  })
  .finally(() => {
    try { srv.close() } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 300)
  })
