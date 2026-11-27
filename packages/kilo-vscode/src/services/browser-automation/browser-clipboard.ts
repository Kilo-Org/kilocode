export const COPY_BINDING = "__kiloCopy"

// Main-world hook that forwards user-initiated page clipboard copies (navigator.clipboard.writeText,
// navigator.clipboard.write, and document.execCommand("copy" | "cut")) to the isolated-world bridge via a per-stream
// CustomEvent channel. Runs only in the top frame and leaks no globals to window; the isolated world verifies real
// Blink userActivation and the Extension Host enforces its own gesture window, frame identity, and ownership.
export function clipboardPageScript(channel: string): string {
  return `(() => {
    if (window !== window.top) return
    const CH = ${JSON.stringify(channel)}
    const LIMIT = 65536
    const emit = (text) => {
      if (typeof text !== "string" || !text.length || text.length > LIMIT) return
      if (navigator.userActivation && !navigator.userActivation.isActive) return
      window.dispatchEvent(new CustomEvent(CH, { detail: text }))
    }
    const readSelection = () => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el instanceof HTMLInputElement && el.type === "password") return ""
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? 0
        return end > start ? el.value.slice(start, end) : ""
      }
      return window.getSelection()?.toString() ?? ""
    }
    if (typeof Clipboard !== "undefined" && Clipboard.prototype) {
      const origWriteText = Clipboard.prototype.writeText
      if (typeof origWriteText === "function") {
        Clipboard.prototype.writeText = function (text) {
          const value = String(text)
          const active = !navigator.userActivation || navigator.userActivation.isActive
          if (active) emit(value)
          const pending = origWriteText.call(this, value)
          return active ? pending.catch(() => undefined) : pending
        }
      }
      const origWrite = Clipboard.prototype.write
      if (typeof origWrite === "function") {
        Clipboard.prototype.write = function (items) {
          const active = !navigator.userActivation || navigator.userActivation.isActive
          if (active && Array.isArray(items)) {
            for (const item of items) {
              if (item && Array.isArray(item.types) && item.types.includes("text/plain") && typeof item.getType === "function") {
                void item.getType("text/plain").then((blob) => blob.text()).then(emit).catch(() => undefined)
                break
              }
            }
          }
          const pending = origWrite.call(this, items)
          return active ? pending.catch(() => undefined) : pending
        }
      }
    }
    const origExec = Document.prototype.execCommand
    if (typeof origExec === "function") {
      const origSetData = typeof DataTransfer !== "undefined" && DataTransfer.prototype ? DataTransfer.prototype.setData : null
      Document.prototype.execCommand = function (command, showUI, value) {
        const lower = String(command).toLowerCase()
        const active = (lower === "copy" || lower === "cut") && (!navigator.userActivation || navigator.userActivation.isActive)
        if (!active) return origExec.call(this, command, showUI, value)
        // Snapshot selection before execCommand("cut") deletes and collapses it.
        const before = readSelection()
        let captured = ""
        if (origSetData) {
          DataTransfer.prototype.setData = function (format, data) {
            if (String(format).toLowerCase() === "text/plain" && typeof data === "string") captured = data
            return origSetData.call(this, format, data)
          }
        }
        let ok = false
        try {
          ok = origExec.call(this, command, showUI, value)
        } finally {
          if (origSetData) DataTransfer.prototype.setData = origSetData
        }
        if (!captured && (lower === "copy" || ok)) captured = before || readSelection()
        if (captured) emit(captured)
        return ok || !!captured
      }
    }
  })()`
}

export function clipboardBridgeScript(channel: string, binding: string, epoch: number): string {
  return `(() => {
    if (window !== window.top) return
    const key = "${binding}Cleanup"
    if (typeof globalThis[key] === "function") globalThis[key]()
    const onCopy = (event) => {
      // Read native userActivation from the isolated world so main-world property tampering cannot bypass it.
      if (navigator.userActivation && !navigator.userActivation.isActive) return
      if (typeof event.detail === "string" && typeof globalThis[${JSON.stringify(binding)}] === "function") {
        globalThis[${JSON.stringify(binding)}](${JSON.stringify(`${epoch}:`)} + event.detail)
      }
    }
    window.addEventListener(${JSON.stringify(channel)}, onCopy)
    globalThis[key] = () => {
      window.removeEventListener(${JSON.stringify(channel)}, onCopy)
      delete globalThis[key]
    }
  })()`
}
