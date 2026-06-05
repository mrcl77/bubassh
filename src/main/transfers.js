import fs from 'node:fs'
import path from 'node:path'

// Sekwencyjna kolejka transferów (pliki i katalogi). Dla każdego zadania emituje:
//   transfer:queued / transfer:start / transfer:progress / transfer:done / transfer:error
//
// Katalogi są przechodzone rekurencyjnie tutaj (a nie w bibliotece), dzięki czemu
// dla folderów też mamy realny postęp bajtowy: najpierw budujemy listę plików z
// rozmiarami (realny `total`), potem lecimy plik po pliku, raportując sumę bajtów,
// bieżący plik oraz licznik plików.
export class TransferManager {
  constructor({ getSession, emit }) {
    this.getSession = getSession
    this.emit = emit
    this.queue = []
    this.running = false
    this._id = 0
  }

  enqueue(items) {
    const created = []
    for (const it of items) {
      const id = ++this._id
      this.queue.push({ id, transferred: 0, total: it.total || 0, ...it })
      created.push({ id, name: it.name, direction: it.direction, total: it.total || 0, isDir: !!it.isDir })
    }
    this.emit('transfer:queued', created)
    this._run()
    return created
  }

  async _run() {
    if (this.running) return
    this.running = true
    while (this.queue.length) {
      const task = this.queue.shift()
      const session = this.getSession()
      if (!session) {
        this.emit('transfer:error', { id: task.id, name: task.name, error: 'Not connected' })
        continue
      }
      try {
        if (task.isDir) await this._runDir(task, session)
        else await this._runFile(task, session)
      } catch (err) {
        this.emit('transfer:error', {
          id: task.id,
          name: task.name,
          error: String((err && err.message) || err)
        })
      }
    }
    this.running = false
  }

  // Zwraca funkcję raportującą postęp: throttluje (~100 ms), liczy wygładzoną
  // prędkość i ETA, i dorzuca dodatkowe pola (np. bieżący plik). `force` wymusza
  // natychmiastową emisję (start, granice plików, koniec).
  _makeReporter(task) {
    let lastEmit = 0
    let lastBytes = task.transferred || 0
    let lastTime = Date.now()
    let speed = 0
    return (transferred, extra = {}, force = false) => {
      task.transferred = transferred
      const now = Date.now()
      if (!force && now - lastEmit < 100) return
      const dt = (now - lastTime) / 1000
      if (dt > 0) {
        const inst = Math.max(0, (transferred - lastBytes) / dt)
        speed = speed > 0 ? speed * 0.65 + inst * 0.35 : inst
        lastBytes = transferred
        lastTime = now
      }
      const eta = speed > 0 && task.total ? (task.total - transferred) / speed : null
      this.emit('transfer:progress', {
        id: task.id,
        name: task.name,
        direction: task.direction,
        transferred,
        total: task.total,
        speed,
        eta,
        isDir: task.isDir,
        ...extra
      })
      lastEmit = now
    }
  }

  async _runFile(task, session) {
    if (!task.total) {
      if (task.direction === 'upload') {
        try {
          task.total = fs.statSync(task.localPath).size
        } catch {
          task.total = 0
        }
      } else {
        task.total = await session.size(task.remotePath)
      }
    }

    this.emit('transfer:start', {
      id: task.id,
      name: task.name,
      direction: task.direction,
      total: task.total,
      isDir: false
    })

    const report = this._makeReporter(task)
    if (task.direction === 'upload') await session.uploadFile(task.localPath, task.remotePath, (b) => report(b))
    else await session.downloadFile(task.remotePath, task.localPath, (b) => report(b))

    report(task.total, {}, true)
    this.emit('transfer:done', {
      id: task.id,
      name: task.name,
      direction: task.direction,
      total: task.total,
      isDir: false
    })
  }

  async _runDir(task, session) {
    // 1. Zbuduj listę katalogów + plików (z rozmiarami) → realny `total`.
    const plan =
      task.direction === 'upload' ? walkLocal(task.localPath) : await walkRemote(session, task.remotePath)
    task.total = plan.totalBytes
    const fileCount = plan.files.length

    this.emit('transfer:start', {
      id: task.id,
      name: task.name,
      direction: task.direction,
      total: task.total,
      isDir: true,
      fileCount
    })

    const report = this._makeReporter(task)
    let base = 0 // bajty z ukończonych plików
    let index = 0
    let failed = 0

    if (task.direction === 'upload') {
      await session.ensureDir(task.remotePath)
      for (const rel of plan.dirs) await session.ensureDir(path.posix.join(task.remotePath, rel))
    } else {
      fs.mkdirSync(task.localPath, { recursive: true })
      for (const rel of plan.dirs) fs.mkdirSync(path.join(task.localPath, ...rel.split('/')), { recursive: true })
    }

    for (const f of plan.files) {
      index++
      const meta = { file: f.rel, fileIndex: index, fileCount }
      report(base, meta, true)
      let lastB = 0
      const onByte = (b) => {
        lastB = b
        report(base + b, meta)
      }
      try {
        if (task.direction === 'upload') {
          await session.uploadFile(f.localPath, path.posix.join(task.remotePath, f.rel), onByte)
        } else {
          const localPath = path.join(task.localPath, ...f.rel.split('/'))
          fs.mkdirSync(path.dirname(localPath), { recursive: true })
          await session.downloadFile(f.remotePath, localPath, onByte)
        }
      } catch {
        failed++
      }
      base += f.size || lastB
    }

    if (fileCount > 0 && failed === fileCount) throw new Error(`All ${fileCount} files failed`)

    report(task.total, { fileIndex: fileCount, fileCount }, true)
    this.emit('transfer:done', {
      id: task.id,
      name: task.name,
      direction: task.direction,
      total: task.total,
      isDir: true,
      fileCount,
      failed
    })
  }
}

// Rekurencyjnie przechodzi lokalny katalog. `rel` to ścieżka względem korzenia
// (POSIX-owe `/`), bo trafia na zdalny serwer. Katalogi są w kolejności „płytkie
// najpierw” (DFS, rodzic przed dziećmi).
function walkLocal(root) {
  const files = []
  const dirs = []
  let totalBytes = 0
  const walk = (absDir, rel) => {
    let ents = []
    try {
      ents = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of ents) {
      const abs = path.join(absDir, d.name)
      const childRel = rel ? rel + '/' + d.name : d.name
      let isDir = d.isDirectory()
      let size = 0
      try {
        const st = d.isSymbolicLink() ? fs.statSync(abs) : fs.lstatSync(abs)
        isDir = st.isDirectory()
        size = st.size
      } catch {
        continue
      }
      if (isDir) {
        dirs.push(childRel)
        walk(abs, childRel)
      } else {
        files.push({ localPath: abs, rel: childRel, size })
        totalBytes += size
      }
    }
  }
  walk(root, '')
  return { files, dirs, totalBytes }
}

// Rekurencyjnie przechodzi zdalny katalog przez `session.list` (ścieżki POSIX-owe).
async function walkRemote(session, root) {
  const files = []
  const dirs = []
  let totalBytes = 0
  const walk = async (absDir, rel) => {
    let ents = []
    try {
      ents = await session.list(absDir)
    } catch {
      return
    }
    for (const e of ents) {
      if (e.name === '.' || e.name === '..') continue
      const abs = path.posix.join(absDir, e.name)
      const childRel = rel ? rel + '/' + e.name : e.name
      if (e.isDir) {
        dirs.push(childRel)
        await walk(abs, childRel)
      } else {
        files.push({ remotePath: abs, rel: childRel, size: e.size || 0 })
        totalBytes += e.size || 0
      }
    }
  }
  await walk(root, '')
  return { files, dirs, totalBytes }
}
