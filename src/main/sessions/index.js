import { FtpSession } from './ftp.js'
import { SftpSession } from './sftp.js'

// Fabryka sesji — renderer nie wie, jaki protokół jest pod spodem.
// Wszystkie implementacje dzielą ten sam interfejs:
//   connect(profile) -> cwd
//   list(dir) -> [{ name, isDir, isSymlink, size, mtime }]
//   uploadFile(localPath, remotePath, onProgress)
//   downloadFile(remotePath, localPath, onProgress)
//   size(remotePath) -> bytes
//   mkdir(remotePath) / rename(from, to) / remove(remotePath, isDir)
//   disconnect()
//   .cwd  (aktualny katalog)
export function createSession(protocol) {
  if (protocol === 'sftp') return new SftpSession()
  return new FtpSession(protocol === 'ftps')
}
