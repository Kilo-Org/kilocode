import type { KiloClient } from "./index"
import { startWebServer, type WebHost } from "../web-server"

/** Per-connection terminal relay; only short-lived native tickets reach webviews. */
export class TerminalConnection {
  private host?: Promise<WebHost>
  private running?: WebHost
  private closed = false
  private readonly origins = new Map<string, { origin: string; release?: () => void }>()

  constructor(private readonly config: { assets: string; serverUrl: string; serverPassword: string }) {}

  register(panel: string, origin?: string) {
    this.origins.get(panel)?.release?.()
    this.origins.delete(panel)
    if (!origin || this.closed) return
    const entry: { origin: string; release?: () => void } = { origin }
    this.origins.set(panel, entry)
    entry.release = this.running?.allowOrigin(origin)
  }

  async connect(client: Pick<KiloClient, "pty">, ptyID: string, directory: string, replayExited = false) {
    if (this.closed) throw new Error("Terminal connection is closed")
    this.host ??= startWebServer(this.config).then((host) => {
      this.running = host
      for (const entry of this.origins.values()) entry.release = host.allowOrigin(entry.origin)
      return host
    })
    const host = await this.host
    const token = await client.pty.connect.token({ ptyID, directory }, { throwOnError: true })
    if (this.closed) throw new Error("Terminal connection is closed")
    const url = new URL(`/api/pty/${encodeURIComponent(ptyID)}/connect`, host.url)
    url.protocol = "ws:"
    url.searchParams.set("ticket", token.data.ticket)
    url.searchParams.set("location[directory]", token.data.directory)
    url.searchParams.set("cursor", "0")
    if (replayExited) url.searchParams.set("replayExited", "1")
    return url.href
  }

  async close() {
    this.closed = true
    for (const entry of this.origins.values()) entry.release?.()
    this.origins.clear()
    await (await this.host)?.close()
  }
}
