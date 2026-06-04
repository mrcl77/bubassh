import fs from 'node:fs'

// Sekwencyjna kolejka transferów. Dla każdego zadania emituje zdarzenia:
//   transfer:queued / transfer:start / transfer:progress / transfer:done / transfer:error
// Postęp jest dławiony (~100 ms), żeby nie zalewać renderera.
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
      created.push({ id, name: it.name, direction: it.direction, total: it.total || 0 })
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
          total: task.total
        })

        let lastEmit = 0
        let lastBytes = 0
        let lastTime = Date.now()
        const onProgress = (transferred) => {
          task.transferred = transferred
          const now = Date.now()
          if (now - lastEmit >= 100 || (task.total && transferred >= task.total)) {
            const dt = (now - lastTime) / 1000
            const speed = dt > 0 ? Math.max(0, (transferred - lastBytes) / dt) : 0
            this.emit('transfer:progress', {
              id: task.id,
              name: task.name,
              direction: task.direction,
              transferred,
              total: task.total,
              speed
            })
            lastEmit = now
            lastBytes = transferred
            lastTime = now
          }
        }

        if (task.direction === 'upload') {
          await session.uploadFile(task.localPath, task.remotePath, onProgress)
        } else {
          await session.downloadFile(task.remotePath, task.localPath, onProgress)
        }

        this.emit('transfer:done', {
          id: task.id,
          name: task.name,
          direction: task.direction,
          total: task.total
        })
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
}
