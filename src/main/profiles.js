import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Zapisane serwery trzymamy w userData/profiles.json.
// Hasła i passphrasy są szyfrowane przez Electron safeStorage
// (Keychain na macOS, DPAPI na Windows, libsecret na Linux) i NIGDY
// nie są zwracane do renderera w formie jawnej.

function filePath() {
  return path.join(app.getPath('userData'), 'profiles.json')
}

function readAll() {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeAll(list) {
  fs.writeFileSync(filePath(), JSON.stringify(list, null, 2), 'utf8')
}

function encrypt(text) {
  if (!text) return null
  if (!safeStorage.isEncryptionAvailable()) return { plain: text } // rzadki fallback
  return { enc: safeStorage.encryptString(text).toString('base64') }
}

function decrypt(secret) {
  if (!secret) return ''
  if (secret.plain != null) return secret.plain
  if (secret.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(secret.enc, 'base64'))
    } catch {
      return ''
    }
  }
  return ''
}

function genId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Lista dla UI — bez sekretów, z flagami informującymi czy są zapisane.
export function listProfiles() {
  return readAll().map((p) => ({
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    host: p.host,
    port: p.port,
    username: p.username,
    authType: p.authType || 'password',
    keyPath: p.keyPath || '',
    hasPassword: !!p.password,
    hasPassphrase: !!p.passphrase
  }))
}

export function saveProfile(input) {
  const list = readAll()
  const id = input.id || genId()
  const idx = list.findIndex((p) => p.id === id)
  const existing = idx >= 0 ? list[idx] : {}

  const profile = {
    id,
    name: input.name || input.host,
    protocol: input.protocol || 'sftp',
    host: input.host,
    port: Number(input.port) || (input.protocol === 'sftp' ? 22 : 21),
    username: input.username || '',
    authType: input.authType || 'password',
    keyPath: input.keyPath || '',
    // sekrety: zachowujemy istniejące, aktualizujemy tylko gdy podano nowe
    password: existing.password || null,
    passphrase: existing.passphrase || null
  }
  if (input.password) profile.password = encrypt(input.password)
  if (input.passphrase) profile.passphrase = encrypt(input.passphrase)

  if (idx >= 0) list[idx] = profile
  else list.push(profile)
  writeAll(list)
  return id
}

export function deleteProfile(id) {
  writeAll(readAll().filter((p) => p.id !== id))
}

// Pełny profil z odszyfrowanymi sekretami — tylko do użytku w procesie main przy łączeniu.
export function hydrateProfile(id) {
  const p = readAll().find((x) => x.id === id)
  if (!p) return null
  return { ...p, password: decrypt(p.password), passphrase: decrypt(p.passphrase) }
}

export function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
