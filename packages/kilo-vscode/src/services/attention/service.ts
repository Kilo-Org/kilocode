import * as vscode from "vscode"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import type { KiloConnectionService } from "../cli-backend/connection-service"
import { playSound, resolveSoundID } from "./sound"

type Sync = Extract<SSEPayload, { type: "sync" }>
type Question = Extract<SSEPayload, { type: "question.asked" | "question.replied" | "question.rejected" }>
type Permission = Extract<SSEPayload, { type: "permission.asked" | "permission.replied" }>
type Status = Extract<SSEPayload, { type: "session.status" }>
type Error = Extract<SSEPayload, { type: "session.error" }>

export function previewSound(value: string) {
  void playSound("default", resolveSoundID(value))
}

export class AttentionService implements vscode.Disposable {
  private readonly active = new Set<string>()
  private readonly errored = new Set<string>()
  private readonly questions = new Set<string>()
  private readonly permissions = new Set<string>()
  private readonly parents = new Map<string, string | undefined>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void

  constructor(connection: KiloConnectionService) {
    this.unsubscribeEvent = connection.onEvent((event) => this.handle(event))
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state === "error" || state === "disconnected") this.reset()
    })
  }

  dispose() {
    this.unsubscribeEvent()
    this.unsubscribeState()
    this.reset()
    this.parents.clear()
  }

  private handle(event: SSEPayload) {
    if (event.type === "sync") return this.sync(event)
    if (event.type === "question.asked" || event.type === "question.replied" || event.type === "question.rejected") {
      return this.question(event)
    }
    if (event.type === "permission.asked" || event.type === "permission.replied") return this.permission(event)
    if (event.type === "session.status") return this.status(event)
    if (event.type === "session.error") return this.error(event)
  }

  private sync(event: Sync) {
    if (event.name === "session.created.1") {
      this.parents.set(event.data.sessionID, event.data.info.parentID)
      return
    }
    if (event.name === "session.updated.1") {
      if (event.data.info.parentID !== undefined) {
        this.parents.set(event.data.sessionID, event.data.info.parentID ?? undefined)
      }
      return
    }
    if (event.name !== "session.deleted.1") return
    this.parents.delete(event.data.sessionID)
    this.active.delete(event.data.sessionID)
    this.errored.delete(event.data.sessionID)
  }

  private question(event: Question) {
    if (event.type !== "question.asked") {
      this.questions.delete(event.properties.requestID)
      return
    }
    if (this.questions.has(event.properties.id)) return
    this.questions.add(event.properties.id)
    this.notify("question")
  }

  private permission(event: Permission) {
    if (event.type !== "permission.asked") {
      this.permissions.delete(event.properties.requestID)
      return
    }
    if (this.permissions.has(event.properties.id)) return
    this.permissions.add(event.properties.id)
    this.notify("permission")
  }

  private status(event: Status) {
    const sessionID = event.properties.sessionID
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      this.active.add(sessionID)
      this.errored.delete(sessionID)
      return
    }
    if (event.properties.status.type !== "idle") return
    if (!this.active.has(sessionID)) return
    this.active.delete(sessionID)
    if (this.errored.delete(sessionID)) return
    this.notify(this.parents.get(sessionID) ? "subagent_done" : "done")
  }

  private error(event: Error) {
    const sessionID = event.properties.sessionID
    if (!sessionID || !this.active.has(sessionID)) return
    this.errored.add(sessionID)
    this.notify("error")
  }

  private notify(sound: TuiAttentionSoundName) {
    const config = vscode.workspace.getConfiguration("kilo-code.new.attention")
    if (!config.get<boolean>("enabled", false)) return
    const selected = resolveSoundID(config.get<string>("sound", "default"))
    void playSound(sound, selected)
  }

  private reset() {
    this.active.clear()
    this.errored.clear()
    this.questions.clear()
    this.permissions.clear()
  }
}
