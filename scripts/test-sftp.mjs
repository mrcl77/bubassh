// Lekki test SFTP (read-only) PRAWDZIWEGO kodu SftpSession wobec publicznego
// serwera testowego rebex.net (demo/password). Weryfikuje connect → realPath →
// list → size → download. Operacje zapisu (mkdir/rename/delete/upload) to cienkie
// wrappery na ssh2-sftp-client o tym samym kształcie co zweryfikowane lokalnie FTP.
// Wymaga internetu — bez sieci test robi czysty SKIP. Uruchom: `npm run test:sftp`.
import { build } from 'esbuild'
import { mkdtempSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const sftpSrc = path.join(projectRoot, 'src/main/sessions/sftp.js')
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'babyssh-sftp-'))
// Bundle musi leżeć w projekcie, by require('ssh2-sftp-client') trafił w node_modules.
const bundlePath = path.join(projectRoot, '.babyssh-sftp-test.cjs')

await build({
  stdin: { contents: `export { SftpSession } from ${JSON.stringify(sftpSrc)}`, resolveDir: projectRoot, loader: 'js' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['ssh2-sftp-client'], // nie bundlujemy ssh2 (natywne/ dynamiczne require)
  outfile: bundlePath,
  logLevel: 'silent'
})
const mod = await import(pathToFileURL(bundlePath).href)
const { SftpSession } = mod.default ?? mod

let passed = 0
function ok(cond, label) {
  if (!cond) throw new Error('ASERCJA NIEUDANA: ' + label)
  passed++
  console.log('  ✓ ' + label)
}

const NETWORK_ERR = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH']

async function run() {
  const session = new SftpSession()
  const cwd = await session.connect({
    host: 'test.rebex.net',
    port: 22,
    username: 'demo',
    password: 'password',
    authType: 'password'
  })
  ok(typeof cwd === 'string' && cwd.startsWith('/'), 'connect + realPath: cwd=' + cwd)

  const entries = await session.list('/')
  ok(Array.isArray(entries) && entries.length > 0, 'list zwrócił wpisy (' + entries.length + ')')
  ok(entries.some((e) => e.name === 'readme.txt'), 'widać readme.txt na serwerze testowym')

  const size = await session.size('/readme.txt')
  ok(size > 0, 'size(/readme.txt) > 0 (' + size + ' B)')

  const out = path.join(tmpDir, 'readme.txt')
  let lastTransferred = 0
  await session.downloadFile('/readme.txt', out, (t) => (lastTransferred = t))
  ok(statSync(out).size === size, 'pobrany readme.txt ma rozmiar zgodny z SIZE')
  ok(lastTransferred > 0, 'callback postępu otrzymał transferred>0')

  await session.disconnect()
}

const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error('__TIMEOUT__')), 25000))

Promise.race([run(), timeout])
  .then(() => console.log(`\n✅ SFTP e2e (read-only): wszystkie ${passed} asercje przeszły.`))
  .catch((err) => {
    const code = err && err.code
    if (err.message === '__TIMEOUT__' || NETWORK_ERR.includes(code) || /timed out|getaddrinfo|connect/i.test(err.message)) {
      console.log('\n⏭️  SFTP e2e POMINIĘTY (brak dostępu do sieci / serwera testowego): ' + (code || err.message))
    } else {
      console.error('\n❌ SFTP e2e NIEUDANY:', err.message)
      process.exitCode = 1
    }
  })
  .finally(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    try { rmSync(bundlePath, { force: true }) } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 200)
  })
