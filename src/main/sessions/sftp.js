import SftpClient from 'ssh2-sftp-client'
import fs from 'node:fs'

// SFTP na bazie `ssh2-sftp-client` (wrapper na `ssh2`).
// Uwierzytelnianie hasłem lub kluczem prywatnym (+ opcjonalna passphrase).
export class SftpSession {
  constructor() {
    this.client = new SftpClient()
    this.cwd = '/'
  }

  async connect(profile) {
    const conn = {
      host: profile.host,
      port: Number(profile.port) || 22,
      username: profile.username,
      readyTimeout: 30_000
    }
    if (profile.authType === 'key' && profile.keyPath) {
      conn.privateKey = fs.readFileSync(profile.keyPath)
      if (profile.passphrase) conn.passphrase = profile.passphrase
    } else {
      const password = profile.password || ''
      conn.password = password
      // Wiele serwerów (Ubuntu/PAM) przyjmuje hasło wyłącznie przez
      // keyboard-interactive, a nie metodą "password". Włączamy ją i
      // odpowiadamy hasłem na każdy prompt serwera.
      conn.tryKeyboard = true
      this.client.client.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
        finish(prompts.map(() => password))
      })
    }
    await this.client.connect(conn)
    this.cwd = await this.client.realPath('.').catch(() => '/')
    return this.cwd
  }

  async list(dir) {
    const target = dir || this.cwd
    const items = await this.client.list(target)
    this.cwd = target
    return items.map((f) => ({
      name: f.name,
      isDir: f.type === 'd',
      isSymlink: f.type === 'l',
      size: f.size,
      mtime: f.modifyTime || null
    }))
  }

  async size(remotePath) {
    try {
      const st = await this.client.stat(remotePath)
      return st.size
    } catch {
      return 0
    }
  }

  async uploadFile(localPath, remotePath, onProgress) {
    await this.client.fastPut(localPath, remotePath, {
      step: (transferred) => onProgress(transferred)
    })
  }

  async downloadFile(remotePath, localPath, onProgress) {
    await this.client.fastGet(remotePath, localPath, {
      step: (transferred) => onProgress(transferred)
    })
  }

  async mkdir(remotePath) {
    await this.client.mkdir(remotePath, false)
  }

  async rename(from, to) {
    await this.client.rename(from, to)
  }

  async remove(remotePath, isDir) {
    if (isDir) await this.client.rmdir(remotePath, true)
    else await this.client.delete(remotePath)
  }

  async disconnect() {
    try {
      await this.client.end()
    } catch {
      /* ignore */
    }
  }
}
