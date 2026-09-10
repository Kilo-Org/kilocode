import type * as vscode from "vscode"

type Message = { type?: unknown; sessionID?: unknown; visible?: unknown }

function parse(message: unknown): Message | undefined {
  if (!message || typeof message !== "object") return undefined
  const msg = message as Message
  if (msg.type !== "streamSessionVisible") return undefined
  return msg
}

export class VisibleTaskStreams {
  private readonly refs = new Map<string, number>()
  private active = true

  constructor(private readonly set: (id: string, visible: boolean) => void) {}

  clear(): void {
    for (const id of this.refs.keys()) this.set(id, false)
    this.refs.clear()
  }

  delete(id: string): void {
    this.set(id, false)
    this.refs.delete(id)
  }

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    for (const id of this.refs.keys()) this.set(id, active)
  }

  bindPanel(panel: vscode.WebviewPanel, focus: () => void): vscode.Disposable {
    this.setActive(panel.active)
    return panel.onDidChangeViewState(() => {
      this.setActive(panel.active)
      focus()
    })
  }

  handle(message: unknown): boolean {
    const msg = parse(message)
    if (!msg) return false
    if (typeof msg.sessionID !== "string" || typeof msg.visible !== "boolean") return true
    const count = this.refs.get(msg.sessionID) ?? 0
    const next = msg.visible ? count + 1 : Math.max(0, count - 1)
    if (next === 0) this.refs.delete(msg.sessionID)
    else this.refs.set(msg.sessionID, next)
    this.set(msg.sessionID, this.active && next > 0)
    return true
  }
}
