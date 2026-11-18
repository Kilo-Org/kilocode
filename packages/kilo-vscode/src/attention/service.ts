// Attention: a sound, a VS Code notification and a native OS notification when a session finishes, fails or needs
// input, as on v1 (packages/kilo-vscode/src/services/attention/service.ts on main). One instance per extension host
// listens on the Agent Manager connection, the host's single event stream, so no webview adds a subscription.
import type { OpenCodeEvent, PermissionRequest } from "@opencode/client"
import { Goal } from "@opencode/schema/goal"
import type { AgentManagerConnection } from "../agent-manager/connection"
import { t, type AttentionKey } from "./i18n"
import { lines, type AttentionNotice } from "./notice"
import type { AttentionSoundID } from "./sound"

export type AttentionKind = "done" | "question" | "permission" | "error"

export type AttentionSettings = {
  /** Play sounds. */
  enabled: boolean
  /** Show VS Code notifications. */
  notifications: boolean
  /** Show native OS notifications while the window is not focused. */
  os: boolean
  sound: AttentionSoundID
}

type Session = { parentID?: string; title?: string; directory?: string }

const TEXT: Record<AttentionKind, AttentionKey> = {
  done: "attention.done",
  question: "attention.question",
  permission: "attention.permission",
  error: "attention.error",
}

/** Cap on remembered prompt IDs, so prompts that are never answered cannot grow the map forever. */
const PROMPTS = 1000

export function createAttention(input: {
  connection: Pick<AgentManagerConnection, "onEvent" | "current">
  settings: () => AttentionSettings
  play: (kind: AttentionKind, sound: AttentionSoundID) => void
  /** Present only where the platform has a native notification command. */
  os?: (notice: AttentionNotice) => void
  /** Shows a VS Code notification and resolves with the chosen action. */
  message: (kind: AttentionKind, text: string, action: string) => PromiseLike<string | undefined>
  focused: () => boolean
  /** True when a Kilo surface shows this session to the user right now. */
  visible: (sessionID: string) => boolean
  /** True when the host auto-approve sweep answers this request, so nobody has to. */
  approves: (request: PermissionRequest) => boolean
  /** The workspace label of a session directory. */
  workspace: (directory: string | undefined) => string | undefined
  show: (sessionID: string, directory?: string) => unknown
}) {
  // Every permission and form asked, by ID, until it is answered. The event stream reconnects and a recovered session
  // can ask again with the same ID, so a prompt announces once however often it arrives.
  const prompts = new Map<string, string>()

  const handle = (event: OpenCodeEvent) => {
    const directory = event.location?.directory
    if (event.type === "permission.asked")
      return prompt("permission", event.data.id, event.data.sessionID, directory, input.approves(event.data))
    if (event.type === "form.created") return prompt("question", event.data.form.id, event.data.form.sessionID, directory)
    if (event.type === "permission.replied") return void prompts.delete(event.data.requestID)
    if (event.type === "form.replied" || event.type === "form.cancelled") return void prompts.delete(event.data.id)
    if (event.type === "session.deleted") return forget(event.data.sessionID)
    if (event.type === "session.execution.succeeded") return void done(event.data.sessionID, directory)
    if (event.type === "session.execution.failed") return void failed(event.data.sessionID, directory)
  }

  const prompt = (kind: AttentionKind, id: string, sessionID: string, directory?: string, approved = false) => {
    if (prompts.has(id)) return
    prompts.set(id, sessionID)
    for (const oldest of prompts.keys()) {
      if (prompts.size <= PROMPTS) break
      prompts.delete(oldest)
    }
    if (approved) return
    sound(kind)
    void announce(kind, sessionID, directory)
  }

  // Only a root session's finished run is the user's task: a subagent reports to its parent, and a session with an
  // active goal keeps working on its own.
  const done = async (sessionID: string, directory?: string) => {
    if (!input.settings().enabled && !open(sessionID)) return
    const session = await lookup(sessionID)
    if (session?.parentID) return
    if (await goal(sessionID, session?.directory ?? directory)) return
    sound("done")
    deliver("done", sessionID, session, directory)
  }

  // A failed run is terminal: retries happen before it. Every failure sounds, as on v1, and only a root session's
  // failure shows a notification.
  const failed = async (sessionID: string, directory?: string) => {
    sound("error")
    if (!open(sessionID)) return
    const session = await lookup(sessionID)
    if (session?.parentID) return
    deliver("error", sessionID, session, directory)
  }

  const announce = async (kind: AttentionKind, sessionID: string, directory?: string) => {
    if (!open(sessionID)) return
    deliver(kind, sessionID, await lookup(sessionID), directory)
  }

  const forget = (sessionID: string) => {
    for (const [id, owner] of prompts) if (owner === sessionID) prompts.delete(id)
  }

  const sound = (kind: AttentionKind) => {
    const settings = input.settings()
    if (settings.enabled) input.play(kind, settings.sound)
  }

  /**
   * The channels that fire. The OS toast is a transient ping for when no editor window has focus; the VS Code
   * notification stays as an actionable "Show" entry unless the session is already on screen. A subagent's prompts
   * render in its parent's chat, so a visible parent counts too.
   */
  const channels = (sessionID: string, parentID?: string) => {
    const settings = input.settings()
    return {
      os: input.os !== undefined && settings.os && !input.focused(),
      vscode: settings.notifications && !input.visible(sessionID) && !(parentID && input.visible(parentID)),
    }
  }

  const open = (sessionID: string) => {
    const target = channels(sessionID)
    return target.os || target.vscode
  }

  // Re-reads the channels: the session lookup is async, so the focus and the visible session may have changed.
  const deliver = (kind: AttentionKind, sessionID: string, session: Session | undefined, directory?: string) => {
    const target = channels(sessionID, session?.parentID)
    if (!target.os && !target.vscode) return
    const dir = session?.directory ?? directory
    const notice = { message: t(TEXT[kind]), workspace: input.workspace(dir), session: session?.title || sessionID }
    if (target.os) input.os?.(notice)
    if (!target.vscode) return
    // A workbench notification is plain text, so the fields of the native toast are joined inline.
    const [head, ...rest] = lines(notice)
    const action = t("attention.show")
    void Promise.resolve(input.message(kind, [head, rest.join(" | ")].filter(Boolean).join(" "), action)).then(
      (choice) => {
        if (choice === action) void input.show(sessionID, dir)
      },
    )
  }

  const lookup = async (sessionID: string): Promise<Session | undefined> => {
    const info = await input.connection
      .current()
      ?.session.get({ sessionID })
      .catch(() => undefined)
    if (!info) return undefined
    return { parentID: info.parentID, title: info.title, directory: info.location.directory }
  }

  // A server without the goal plugin answers with an error, which means no goal.
  const goal = async (sessionID: string, directory?: string) => {
    const state = await input.connection
      .current()
      ?.rpc(Goal.Definition)
      .get({ sessionID }, directory ? { location: { directory } } : undefined)
      .catch(() => null)
    return state?.status === "active"
  }

  const unsubscribe = input.connection.onEvent(handle)

  return {
    dispose() {
      unsubscribe()
      prompts.clear()
    },
  }
}
