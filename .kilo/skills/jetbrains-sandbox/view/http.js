export default class Channel {
  readyState = 0
  binaryType = "arraybuffer"
  protocol = "binary"
  bufferedAmount = 0
  onopen = null
  onmessage = null
  onerror = null
  onclose = null
  id = null
  pending = []
  writing = false
  abort = new AbortController()

  constructor() {
    this.open().catch((err) => this.fail(err))
  }

  async open() {
    const res = await fetch("/channel", { method: "POST" })
    if (!res.ok) throw new Error(`Desktop session failed: HTTP ${res.status}`)
    const id = (await res.json()).id
    if (this.readyState === 3) {
      fetch(`/channel/${id}`, { method: "DELETE", keepalive: true }).catch((err) => {
        console.error("HTTP desktop cleanup failed", err)
      })
      return
    }
    this.id = id
    this.readyState = 1
    this.onopen?.(new Event("open"))
    while (this.readyState === 1) {
      const res = await fetch(`/channel/${this.id}`, { signal: this.abort.signal })
      if (!res.ok) throw new Error(`Desktop read failed: HTTP ${res.status}`)
      if (res.status === 204) continue
      const data = await res.arrayBuffer()
      if (data.byteLength) this.onmessage?.(new MessageEvent("message", { data }))
    }
  }

  send(data) {
    if (this.readyState !== 1) return
    const bytes = new Uint8Array(data).slice()
    this.bufferedAmount += bytes.byteLength
    this.pending.push(bytes)
    queueMicrotask(() => this.flush().catch((err) => this.fail(err)))
  }

  async flush() {
    if (this.writing || this.readyState !== 1) return
    this.writing = true
    while (this.pending.length && this.readyState === 1) {
      const chunks = this.pending.splice(0)
      const size = chunks.reduce((size, chunk) => size + chunk.byteLength, 0)
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const res = await fetch(`/channel/${this.id}`, { method: "POST", body: bytes, signal: this.abort.signal })
      this.bufferedAmount -= size
      if (!res.ok) throw new Error(`Desktop input failed: HTTP ${res.status}`)
    }
    this.writing = false
  }

  fail(err) {
    if (this.readyState === 3) return
    console.error("HTTP desktop transport failed", err)
    this.onerror?.(new Event("error"))
    this.shutdown(1006, false)
  }

  close() {
    this.shutdown(1000, true)
  }

  shutdown(code, clean) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.abort.abort()
    this.pending = []
    this.bufferedAmount = 0
    if (this.id) {
      fetch(`/channel/${this.id}`, { method: "DELETE", keepalive: true }).catch((err) => {
        console.error("HTTP desktop cleanup failed", err)
      })
    }
    this.onclose?.(new CloseEvent("close", { code, wasClean: clean }))
  }
}
