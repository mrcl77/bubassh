import { Client } from 'basic-ftp'

// FTP oraz FTPS (FTP over TLS) na bazie biblioteki `basic-ftp`.
export class FtpSession {
  constructor(secure = false) {
    this.client = new Client(30_000)
    this.client.ftp.verbose = false
    this.secure = secure
    this.cwd = '/'
  }

  async connect(profile) {
    await this.client.access({
      host: profile.host,
      port: Number(profile.port) || 21,
      user: profile.username || 'anonymous',
      password: profile.password || '',
      secure: this.secure,
      // Klient minimalistyczny — akceptujemy też certyfikaty samopodpisane.
      secureOptions: this.secure ? { rejectUnauthorized: false } : undefined
    })
    this.cwd = await this.client.pwd().catch(() => '/')
    return this.cwd
  }

  async list(dir) {
    if (dir) await this.client.cd(dir)
    const infos = await this.client.list()
    this.cwd = await this.client.pwd().catch(() => dir || this.cwd)
    return infos.map((f) => ({
      name: f.name,
      isDir: f.isDirectory,
      isSymlink: f.isSymbolicLink,
      size: f.size,
      mtime: f.modifiedAt ? f.modifiedAt.getTime() : null
    }))
  }

  async size(remotePath) {
    try {
      return await this.client.size(remotePath)
    } catch {
      return 0
    }
  }

  async uploadFile(localPath, remotePath, onProgress) {
    this.client.trackProgress((info) => onProgress(info.bytes))
    try {
      await this.client.uploadFrom(localPath, remotePath)
    } finally {
      this.client.trackProgress() // zatrzymaj śledzenie
    }
  }

  async downloadFile(remotePath, localPath, onProgress) {
    this.client.trackProgress((info) => onProgress(info.bytes))
    try {
      await this.client.downloadTo(localPath, remotePath)
    } finally {
      this.client.trackProgress()
    }
  }

  async mkdir(remotePath) {
    // Tworzymy pojedynczy katalog (rodzic musi istnieć).
    await this.client.send('MKD ' + remotePath)
  }

  async rename(from, to) {
    await this.client.rename(from, to)
  }

  async remove(remotePath, isDir) {
    if (isDir) await this.client.removeDir(remotePath)
    else await this.client.remove(remotePath)
  }

  async disconnect() {
    this.client.close()
  }
}
