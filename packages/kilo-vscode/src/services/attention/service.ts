import * as vscode from "vscode"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import type { KiloConnectionService } from "../cli-backend/connection-service"
import { playSound, resolveSoundID } from "./sound"
import { t } from "../i18n"
import { lines } from "./notice"

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
  os?: (notice: AttentionNotice) => void
  show?: (sessionID: string, directory?: string) => void | Promise<void>
}

export function previewSound(value: string) {
  void playSound("default", resolveSoundID(value))
}

export class AttentionService implements vscode.Disposable {
  private readonly active = new Set<string>()
  private readonly goals = new Set<string>()
  private readonly errored = new Set<string>()
  // Error notifications held until the root turn closes, keyed by session.
  // Distinct from `errored`, which also covers manual aborts and only
  // suppresses the following "done".
  private readonly pending = new Map<string, string | undefined>()
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
    if (event.name === "session.deleted.1") return this.remove(event.data.sessionID)
    if (event.name !== "session.updated.1" && event.name !== "session.created.1") return
    if (!("metadata" in event.data.info)) return
    const goal = event.data.info.metadata?.["kilo.goal"]
    if (goal && typeof goal === "object" && "active" in goal && goal.active === true) {
      this.goals.add(event.data.sessionID)
      return
    }
    this.goals.delete(event.data.sessionID)
  }

  private remove(sessionID: string) {
    this.active.delete(sessionID)
    this.goals.delete(sessionID)
    this.errored.delete(sessionID)
    this.pending.delete(sessionID)
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
    this.pending.delete(sessionID)
  }

  private close(event: Close, directory?: string) {
    const sessionID = event.properties.sessionID
    if (!this.active.delete(sessionID)) return
    if (this.errored.delete(sessionID)) {
      // The sound already played when the error arrived; only the notification
      // waits here, so a retry that recovers never shows a "task failed" toast.
      const held = this.pending.has(sessionID)
      const dir = this.pending.get(sessionID) ?? directory
      this.pending.delete(sessionID)
      if (held && event.properties.parentID === undefined) this.deliver("error", sessionID, dir)
      return
    }
    if (event.properties.reason !== "completed") return
    if (event.properties.parentID !== undefined || this.goals.has(sessionID)) return
    this.notify("done", sessionID, directory)
  }

  private error(event: Error) {
    const sessionID = event.properties.sessionID
    if (!sessionID || !this.active.has(sessionID)) return
    this.errored.add(sessionID)
    if (event.properties.error?.name === "MessageAbortedError") return
    this.notify("error", sessionID)
  }

  private notify(sound: TuiAttentionSoundName, sessionID: string, directory?: string) {
    this.sound(sound)
    this.announce(sound, sessionID, directory)
  }

  private sound(sound: TuiAttentionSoundName) {
    const config = vscode.workspace.getConfiguration("kilo-code.new.attention")
    if (!config.get<boolean>("enabled", false)) return
    void playSound(sound, resolveSoundID(config.get<string>("sound", "default")))
  }

  private announce(sound: TuiAttentionSoundName, sessionID: string, directory?: string) {
    // Hold errors back: `session.error` also fires for transient failures that
    // a retry recovers from, and only the closing root turn proves otherwise.
    if (sound === "error") {
      this.pending.set(sessionID, directory)
      return
    }
    this.deliver(sound, sessionID, directory)
  }

  private deliver(sound: TuiAttentionSoundName, sessionID: string, directory?: string) {
    const text = this.text(sound)
    if (!text) return
    const initial = this.channels(sessionID)
    if (!initial.os && !initial.vscode) return
    const send = (extra?: Omit<AttentionNotice, "message">) => {
      // Re-read the channels: resolving details is async, so focus and the visible session may have changed.
      const channels = this.channels(sessionID)
      if (!channels.os && !channels.vscode) return
      const notice = { message: text, ...extra }
      // Both can fire together: the OS toast is a transient, informational ping
      // for when the user isn't looking at any window, while the VS Code
      // notification persists as an actionable "Show" entry for whenever they
      // return to the editor, regardless of whether the OS toast also fired.
      if (channels.os) this.opts.os?.(notice)
      if (channels.vscode) this.message(sound, notice, sessionID, directory)
    }
    const details = this.opts.details?.(sessionID, directory)
    if (!details) return send()
    void details.then(send, () => send())
  }

  /** Picks which delivery channels should fire; independently, both, one, or neither. */
  private channels(sessionID: string) {
    const config = vscode.workspace.getConfiguration("kilo-code.new.attention")
    const focused = this.opts.focused?.() ?? vscode.window.state.focused
    // `os` is only wired up on hosts that can deliver a native notification, so other platforms fall through.
    const os = Boolean(this.opts.os) && config.get<boolean>("OSNotifications", false) && !focused
    // Independent of focus: this asks whether the exact session is already the
    // one in view, not whether the window has OS focus.
    const panel = config.get<boolean>("notifications", false) && !this.opts.visible?.(sessionID)
    return { os, vscode: panel }
  }

  private text(sound: TuiAttentionSoundName) {
    const key =
      sound === "done"
        ? "kilocode:attention.done"
        : sound === "question"
          ? "kilocode:attention.question"
          : sound === "permission"
            ? "kilocode:attention.permission"
            : sound === "error"
              ? "kilocode:attention.error"
              : undefined
    return key ? t(key) : undefined
  }

  private message(sound: TuiAttentionSoundName, notice: AttentionNotice, sessionID: string, directory?: string) {
    const show = t("kilocode:attention.show")
    // Same fields as the native toast; a workbench notification is plaintext,
    // so they are joined inline instead of on their own rows.
    const [head, ...rest] = lines(notice)
    const text = [head, rest.join(" | ")].filter(Boolean).join(" ")
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
    this.goals.clear()
    this.errored.clear()
    this.pending.clear()
    this.questions.clear()
    this.permissions.clear()
  }
}
