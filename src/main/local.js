import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Listowanie lokalnego systemu plików dla panelu „LOKALNE”.
// Zwraca ten sam, znormalizowany kształt wpisów co sesje zdalne,
// dodatkowo `path` (pełna ścieżka natywna) oraz `parent` katalogu.
export function listLocal(dir) {
  const target = dir && String(dir).trim() ? dir : os.homedir()
  const resolved = path.resolve(target)
  const dirents = fs.readdirSync(resolved, { withFileTypes: true })
  const entries = []
  for (const d of dirents) {
    const full = path.join(resolved, d.name)
    let isDir = d.isDirectory()
    let size = 0
    let mtime = null
    try {
      // dla dowiązań pokazujemy cel (stat), inaczej lstat
      const st = d.isSymbolicLink() ? fs.statSync(full) : fs.lstatSync(full)
      isDir = st.isDirectory()
      size = st.size
      mtime = st.mtimeMs
    } catch {
      // brak dostępu/zerwany symlink — pokaż wpis bez metadanych
    }
    entries.push({ name: d.name, isDir, isSymlink: d.isSymbolicLink(), size, mtime, path: full })
  }
  const parent = path.dirname(resolved)
  return { cwd: resolved, parent: parent === resolved ? null : parent, entries }
}
