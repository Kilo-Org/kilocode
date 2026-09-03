import type { KiloClient } from "@kilocode/sdk/v2"
import type {
  AnacondaDesktopAction,
  AnacondaDesktopExtensionMessage,
  AnacondaDesktopWebviewMessage,
} from "../shared/anaconda-desktop-messages"

interface Context {
  client?: KiloClient | null
  directory: string
  post: (message: AnacondaDesktopExtensionMessage) => void
  refresh: () => Promise<void>
  error: (error: unknown) => string
}

type Request = Exclude<AnacondaDesktopWebviewMessage, { type: "cancelAnacondaDesktopRequest" }>

function action(message: Request): AnacondaDesktopAction {
  if (message.type === "anacondaDesktopStatus") return "status"
  if (message.type === "anacondaDesktopOpen") return "open"
  return "sync"
}

export class AnacondaDesktopBridge {
  private readonly requests = new Map<string, AbortController>()

  async handle(message: AnacondaDesktopWebviewMessage, ctx: Context) {
    if (message.type === "cancelAnacondaDesktopRequest") {
      this.requests.get(message.requestId)?.abort()
      this.requests.delete(message.requestId)
      return
    }

    if (!ctx.client) {
      ctx.post({
        type: "anacondaDesktopActionError",
        requestId: message.requestId,
        action: action(message),
        message: "Not connected to CLI backend",
      })
      return
    }

    const ctrl = new AbortController()
    this.requests.set(message.requestId, ctrl)
    try {
      if (message.type === "anacondaDesktopStatus") {
        const response = await ctx.client.anacondaDesktop.status(
          { directory: ctx.directory },
          { throwOnError: true, signal: ctrl.signal },
        )
        if (!response.data) throw new Error("Failed to check Anaconda Desktop")
        if (ctrl.signal.aborted) return
        ctx.post({ type: "anacondaDesktopStatusResult", requestId: message.requestId, status: response.data })
        return
      }

      if (message.type === "anacondaDesktopOpen") {
        await ctx.client.anacondaDesktop.open({ directory: ctx.directory }, { throwOnError: true, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        ctx.post({ type: "anacondaDesktopOpened", requestId: message.requestId })
        return
      }

      const response = await ctx.client.anacondaDesktop.sync(
        {
          directory: ctx.directory,
          acknowledgeToolLimitations: message.acknowledgeToolLimitations,
        },
        { throwOnError: true, signal: ctrl.signal },
      )
      if (!response.data) throw new Error("Failed to synchronize Anaconda Desktop")
      if (ctrl.signal.aborted) return
      await ctx.refresh()
      if (ctrl.signal.aborted) return
      ctx.post({ type: "anacondaDesktopSynced", requestId: message.requestId, status: response.data })
    } catch (error) {
      if (ctrl.signal.aborted) return
      ctx.post({
        type: "anacondaDesktopActionError",
        requestId: message.requestId,
        action: action(message),
        message: ctx.error(error) || `Failed to ${action(message)} Anaconda Desktop`,
      })
    } finally {
      if (this.requests.get(message.requestId) === ctrl) this.requests.delete(message.requestId)
    }
  }

  dispose() {
    for (const ctrl of this.requests.values()) ctrl.abort()
    this.requests.clear()
  }
}
