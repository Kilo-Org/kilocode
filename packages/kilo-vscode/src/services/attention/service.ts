import * as vscode from "vscode"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import type { KiloConnectionService } from "../cli-backend/connection-service"
import { playSound, resolveSoundID } from "./sound"

type Sync = Extract<SSEPayload, { type: "sync" }>
type Question = Extract<SSEPayload, { type: "question.asked" | "question.replied" | "question.rejected" }>
type Permission = Extract<SSEPayload, { type: "permission.asked" | "permission.replied" }>
type Asked = Extract<Permission, { type: "permission.asked" }>
type Status = Extract<SSEPayload, { type: "session.status" }>
type Close = Extract<SSEPayload, { type: "session.turn.close" }>
type Error = Extract<SSEPayload, { type: "session.error" }>

export type AttentionNotice = {
  message: string
  workspace?: string
  session?: string
}

type Options = {
  approve?: (event: Asked, directory?: string) => boolean | Promise<boolean>
  details?: (sessionID: string, directory?: string) => Promise<Omit<AttentionNotice, "message"> | undefined>
  focused?: () => boolean
  visible?: (sessionID: string) => boolean
  windows?: (notice: AttentionNotice) => void
  show?: (sessionID: string, directory?: string) => void | Promise<void>
}

export function previewSound(value: string) {
  void playSound("default", resolveSoundID(value))
}

export class AttentionService implements vscode.Disposable {
  private readonly active = new Set<string>()
  private readonly errored = new Set<string>()
  private readonly questions = new Set<string>()
  private readonly permissions = new Set<string>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void

  constructor(
    connection: KiloConnectionService,
    private readonly opts: Options = {},
  ) {
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.handle(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state === "error" || state === "disconnected") this.reset()
    })
  }

  dispose() {
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.reset()
  }

  private handle(event: SSEPayload, directory?: string) {
    if (event.type === "sync") return this.sync(event)
    if (event.type === "question.asked" || event.type === "question.replied" || event.type === "question.rejected") {
      return this.question(event, directory)
    }
    if (event.type === "permission.asked" || event.type === "permission.replied") {
      return this.permission(event, directory)
    }
    if (event.type === "session.deleted") return this.remove(event.properties.sessionID)
    if (event.type === "session.status") return this.status(event)
    if (event.type === "session.turn.close") return this.close(event, directory)
    if (event.type === "session.error") return this.error(event)
  }

  private sync(event: Sync) {
    if (event.name !== "session.deleted.1") return
    this.remove(event.data.sessionID)
  }

  private remove(sessionID: string) {
    this.active.delete(sessionID)
    this.errored.delete(sessionID)
  }

  private question(event: Question, directory?: string) {
    if (event.type !== "question.asked") {
      this.questions.delete(event.properties.requestID)
      return
    }
    if (this.questions.has(event.properties.id)) return
    this.questions.add(event.properties.id)
    this.notify("question", event.properties.sessionID, directory)
  }

  private permission(event: Permission, directory?: string) {
    if (event.type !== "permission.asked") {
      this.permissions.delete(event.properties.requestID)
      return
    }
    const id = event.properties.id
    if (this.permissions.has(id)) return
    this.permissions.add(id)
    const alert = () => {
      if (!this.permissions.has(id)) return
      this.notify("permission", event.properties.sessionID, directory)
    }
    const approval = this.opts.approve?.(event, directory)
    if (approval === true) return
    if (approval === false || approval === undefined) return alert()
    void approval.then((handled) => {
      if (!handled) alert()
    }, alert)
  }

  private status(event: Status) {
    const sessionID = event.properties.sessionID
    if (event.properties.status.type !== "busy" && event.properties.status.type !== "retry") return
    this.active.add(sessionID)
    this.errored.delete(sessionID)
  }

  private close(event: Close, directory?: string) {
    const sessionID = event.properties.sessionID
    if (!this.active.delete(sessionID)) return
    if (this.errored.delete(sessionID)) {
      if (event.properties.parentID === undefined) this.notify("error", sessionID, directory)
      return
    }
    if (event.properties.reason !== "completed") return
    if (event.properties.parentID !== undefined) return
    this.notify("done", sessionID, directory)
  }

  private error(event: Error) {
    const sessionID = event.properties.sessionID
    if (!sessionID || !this.active.has(sessionID)) return
    if (event.properties.error?.name === "MessageAbortedError") return
    this.errored.add(sessionID)
  }

  private notify(sound: TuiAttentionSoundName, sessionID: string, directory?: string) {
    const config = vscode.workspace.getConfiguration("kilo-code.new.attention")
    if (config.get<boolean>("enabled", false)) {
      const selected = resolveSoundID(config.get<string>("sound", "default"))
      void playSound(sound, selected)
    }
    const text = this.text(sound)
    if (!text) return
    const windows =
      config.get<boolean>("windowsNotifications", false) && !(this.opts.focused?.() ?? vscode.window.state.focused)
    const notification = config.get<boolean>("notifications", false) && !this.opts.visible?.(sessionID)
    if (!windows && !notification) return
    const send = (details?: Omit<AttentionNotice, "message">) => {
      const notice = { message: text, ...details }
      if (windows) {
        this.opts.windows?.(notice)
        return
      }
      this.message(sound, notice, sessionID, directory)
    }
    const details = this.opts.details?.(sessionID, directory)
    if (!details) return send()
    void details.then(send, () => send())
  }

  private text(sound: TuiAttentionSoundName) {
    return sound === "done"
      ? "Kilo task completed."
      : sound === "question"
        ? "Kilo needs your input."
        : sound === "permission"
          ? "Kilo needs permission."
          : sound === "error"
            ? "Kilo task stopped due to an error."
            : undefined
  }

  private message(sound: TuiAttentionSoundName, notice: AttentionNotice, sessionID: string, directory?: string) {
    const show = "Show"
    const details = [
      notice.workspace ? `Workspace: ${notice.workspace}` : undefined,
      notice.session ? `Session: ${notice.session}` : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join(" | ")
    const text = [notice.message, details].filter(Boolean).join(" ")
    const alert =
      sound === "error"
        ? vscode.window.showErrorMessage(text, show)
        : sound === "permission"
          ? vscode.window.showWarningMessage(text, show)
          : vscode.window.showInformationMessage(text, show)
    void alert.then((value) => {
      if (value === show) void this.opts.show?.(sessionID, directory)
    })
  }

  private reset() {
    this.active.clear()
    this.errored.clear()
    this.questions.clear()
    this.permissions.clear()
  }
}
