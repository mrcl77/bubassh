// Test szyfrowania profili (safeStorage) w PRAWDZIWYM procesie main Electrona.
// Bundluje src/main/profiles.js, uruchamia harness pod electronem na tymczasowym
// userData i sprawdza: round-trip hasła (zapis→odczyt), brak jawnego hasła w
// listProfiles(), brak jawnego hasła w pliku na dysku, oraz usuwanie.
// Uruchom: `npm run test:profiles`.
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const profilesSrc = path.join(projectRoot, 'src/main/profiles.js')
const bundlePath = path.join(projectRoot, '.babyssh-profiles.cjs')
const harnessPath = path.join(projectRoot, '.babyssh-profiles-harness.cjs')

await build({
  stdin: {
    contents: `export * from ${JSON.stringify(profilesSrc)}`,
    resolveDir: projectRoot,
    loader: 'js'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: bundlePath,
  logLevel: 'silent'
})

const harness = `
const { app } = require('electron')
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'babyssh-prof-'))
app.setPath('userData', tmp)
const P = require(${JSON.stringify(bundlePath)})
const out = (m) => process.stdout.write(m + '\\n')
app.whenReady().then(() => {
  try {
    const encAvail = P.encryptionAvailable()
    const id = P.saveProfile({ name: 'T', protocol: 'sftp', host: 'h.example', port: 22, username: 'u', password: 'secret123', authType: 'password' })
    const item = P.listProfiles().find((p) => p.id === id)
    if (!item) throw new Error('profil nie zapisany')
    if (item.hasPassword !== true) throw new Error('hasPassword != true')
    if ('password' in item) throw new Error('listProfiles ujawnia pole password')
    const hyd = P.hydrateProfile(id)
    if (hyd.password !== 'secret123') throw new Error('hydrate nie odszyfrowal hasla')
    const raw = fs.readFileSync(path.join(tmp, 'profiles.json'), 'utf8')
    if (encAvail && raw.includes('secret123')) throw new Error('haslo zapisane jawnie mimo safeStorage')
    P.deleteProfile(id)
    if (P.listProfiles().length !== 0) throw new Error('delete nie usunal profilu')
    out('ENC_AVAIL=' + encAvail)
    out('PROFILES_OK')
    app.exit(0)
  } catch (e) {
    out('PROFILES_FAIL: ' + e.message)
    app.exit(1)
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
})
`
writeFileSync(harnessPath, harness)

const child = spawn(electronPath, [harnessPath], {
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
})
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', () => {})
const killer = setTimeout(() => child.kill('SIGKILL'), 30000)

child.on('exit', (code) => {
  clearTimeout(killer)
  try { rmSync(bundlePath, { force: true }) } catch {}
  try { rmSync(harnessPath, { force: true }) } catch {}
  const encLine = (out.match(/ENC_AVAIL=(\w+)/) || [])[1]
  if (out.includes('PROFILES_OK')) {
    console.log('  ✓ zapis profilu + listProfiles() bez jawnego hasła')
    console.log('  ✓ hydrateProfile() odszyfrował hasło (round-trip)')
    console.log('  ✓ plik na dysku bez jawnego hasła (safeStorage dostępny: ' + encLine + ')')
    console.log('  ✓ deleteProfile() usuwa wpis')
    console.log('\n✅ Profiles e2e: OK')
    process.exit(0)
  } else {
    console.error('\n❌ Profiles e2e NIEUDANY (exit ' + code + '):\n' + out.trim())
    process.exit(1)
  }
})
