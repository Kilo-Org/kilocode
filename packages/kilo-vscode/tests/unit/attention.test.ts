import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import { AttentionService, type AttentionNotice } from "../../src/services/attention/service"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { CustomSoundIDs, resolveSoundID } from "../../src/services/attention/sound"

function setup(
  opts: {
    approve?: () => boolean | Promise<boolean>
    details?: (sessionID: string, directory?: string) => Promise<Omit<AttentionNotice, "message"> | undefined>
    notifications?: boolean
    osNotifications?: boolean
    focused?: boolean | (() => boolean)
    visible?: boolean | ((sessionID: string) => boolean)
    os?: (notice: AttentionNotice) => void
    show?: (sessionID: string, directory?: string) => void
    action?: boolean
    capture?: boolean
  } = {},
) {
  const sounds: TuiAttentionSoundName[] = []
  const messages: Array<{ message: string; style: "error" | "info" | "warning" }> = []
  const events: Array<(event: SSEPayload, directory?: string) => void> = []
  const states: Array<(state: "connecting" | "connected" | "disconnected" | "error") => void> = []
  const mocked = opts.notifications !== undefined || opts.osNotifications !== undefined
  const original = mocked ? vscode.workspace.getConfiguration : undefined
  const info = mocked ? vscode.window.showInformationMessage : undefined
  const warning = mocked ? vscode.window.showWarningMessage : undefined
  const failure = mocked ? vscode.window.showErrorMessage : undefined
  if (mocked) {
    ;(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
      () =>
        ({
          get: <T>(key: string, value?: T) => {
            if (key === "notifications") return opts.notifications as T
            if (key === "OSNotifications") return opts.osNotifications as T
            return value
          },
        }) as vscode.WorkspaceConfiguration
    ;(
      vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }
    ).showInformationMessage = async (message: string) => {
      messages.push({ message, style: "info" })
      return (opts.action ? "Show" : undefined) as never
    }
    ;(vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
      async (message: string) => {
        messages.push({ message, style: "warning" })
        return (opts.action ? "Show" : undefined) as never
      }
    ;(vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
      async (message: string) => {
        messages.push({ message, style: "error" })
        return (opts.action ? "Show" : undefined) as never
      }
  }
  const connection = {
    onEvent: (handler: (event: SSEPayload) => void) => {
      events.push(handler)
      return () => undefined
    },
    onStateChange: (handler: (state: "connecting" | "connected" | "disconnected" | "error") => void) => {
      states.push(handler)
      return () => undefined
    },
  } as unknown as KiloConnectionService
  const service = new AttentionService(connection, {
    approve: opts.approve,
    details: opts.details,
    focused: () => (typeof opts.focused === "function" ? opts.focused() : (opts.focused ?? true)),
    visible: (sessionID) => (typeof opts.visible === "function" ? opts.visible(sessionID) : (opts.visible ?? false)),
    os: opts.os,
    show: opts.show,
  })
  if (opts.capture !== false) {
    ;(service as unknown as { notify: (sound: TuiAttentionSoundName) => void }).notify = (sound) => sounds.push(sound)
  }
  return {
    sounds,
    messages,
    event: (event: SSEPayload, directory?: string) => events[0]?.(event, directory),
    state: (state: "connecting" | "connected" | "disconnected" | "error") => states[0]?.(state),
    service,
    restore: () => {
      if (!original || !info || !warning || !failure) return
      ;(
        vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }
      ).getConfiguration = original
      ;(
        vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }
      ).showInformationMessage = info
      ;(
        vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }
      ).showWarningMessage = warning
      ;(vscode.window as unknown as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage =
        failure
    },
  }
}

function event(value: unknown) {
  return value as SSEPayload
}

describe("AttentionService", () => {
  it("plays the upstream completion sound once after a completed turn closes", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))

    expect(test.sounds).toEqual(["done"])
    test.service.dispose()
  })

  it("plays completion sounds only for parent agents", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "child", status: { type: "retry" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "child", status: { type: "idle" } } }))
    test.event(
      event({
        type: "session.turn.close",
        properties: { sessionID: "child", parentID: "parent", reason: "completed" },
      }),
    )
    test.event(event({ type: "session.status", properties: { sessionID: "parent", status: { type: "busy" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "parent", reason: "completed" } }))

    expect(test.sounds).toEqual(["done"])
    test.service.dispose()
  })

  it.each([{ "kilo.goal": { text: "Goal", active: false } }, {}])(
    "suppresses active goal completions but retains attention and restores normal completion after %j",
    (metadata) => {
      const test = setup()
      test.event(
        event({
          type: "sync",
          name: "session.updated.1",
          data: { sessionID: "s1", info: { metadata: { "kilo.goal": { text: "Goal", active: true } } } },
        }),
      )
      test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
      test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
      expect(test.sounds).toEqual([])
      test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
      test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
      test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
      test.event(event({ type: "session.error", properties: { sessionID: "s1", error: { name: "ApiError" } } }))
      expect(test.sounds).toEqual(["question", "permission", "error"])
      test.event(event({ type: "sync", name: "session.updated.1", data: { sessionID: "s1", info: { metadata } } }))
      test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
      test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
      expect(test.sounds).toEqual(["question", "permission", "error", "done"])
      test.service.dispose()
    },
  )

  it("deduplicates question and permission requests", () => {
    const test = setup()
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.replied", properties: { requestID: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))

    expect(test.sounds).toEqual(["question", "question", "permission"])
    test.service.dispose()
  })

  it("shows a VS Code notification when input is needed and Kilo is hidden", () => {
    const test = setup({ notifications: true, capture: false })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))

    expect(test.messages).toEqual([{ message: "Kilo needs your input.", style: "info" }])
    test.service.dispose()
    test.restore()
  })

  it("includes workspace and session details in VS Code notifications", async () => {
    const test = setup({
      notifications: true,
      capture: false,
      details: async () => ({ workspace: "kilo-vscode", session: "Add notifications" }),
    })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    await Bun.sleep(0)

    expect(test.messages).toEqual([
      { message: "Kilo needs your input. Workspace: kilo-vscode | Session: Add notifications", style: "info" },
    ])
    test.service.dispose()
    test.restore()
  })

  it("shows completion and permission notifications", () => {
    const test = setup({ notifications: true, capture: false })
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))

    expect(test.messages).toEqual([
      { message: "Kilo task completed.", style: "info" },
      { message: "Kilo needs permission.", style: "warning" },
    ])
    test.service.dispose()
    test.restore()
  })

  it("fires both the OS and VS Code channels together while unfocused", async () => {
    const alerts: AttentionNotice[] = []
    const test = setup({
      notifications: true,
      osNotifications: true,
      focused: false,
      os: (notice) => alerts.push(notice),
      details: async () => ({ workspace: "kilo-vscode", session: "Add notifications" }),
      capture: false,
    })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }), "C:\\repo")
    await Bun.sleep(0)

    // The OS toast is a transient, informational ping; the VS Code notification
    // persists as an actionable "Show" entry for when the user returns.
    expect(alerts).toEqual([
      { message: "Kilo needs your input.", workspace: "kilo-vscode", session: "Add notifications" },
    ])
    expect(test.messages).toEqual([
      { message: "Kilo needs your input. Workspace: kilo-vscode | Session: Add notifications", style: "info" },
    ])
    test.service.dispose()
    test.restore()
  })

  it("falls back to a VS Code notification when the OS channel is unavailable", () => {
    const test = setup({ notifications: true, osNotifications: true, focused: false, capture: false })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))

    expect(test.messages).toEqual([{ message: "Kilo needs your input.", style: "info" }])
    test.service.dispose()
    test.restore()
  })

  it("skips the alert when the session becomes visible while details resolve", async () => {
    let visible = false
    const test = setup({
      notifications: true,
      capture: false,
      visible: () => visible,
      details: async () => {
        visible = true
        return { workspace: "kilo-vscode", session: "Add notifications" }
      },
    })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    await Bun.sleep(0)

    expect(test.messages).toEqual([])
    test.service.dispose()
    test.restore()
  })

  it("uses the VS Code channel when the window regains focus while details resolve", async () => {
    const alerts: AttentionNotice[] = []
    let focused = false
    const test = setup({
      notifications: true,
      osNotifications: true,
      capture: false,
      focused: () => focused,
      os: (notice) => alerts.push(notice),
      details: async () => {
        focused = true
        return { workspace: "kilo-vscode", session: "Add notifications" }
      },
    })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    await Bun.sleep(0)

    expect(alerts).toEqual([])
    expect(test.messages).toEqual([
      { message: "Kilo needs your input. Workspace: kilo-vscode | Session: Add notifications", style: "info" },
    ])
    test.service.dispose()
    test.restore()
  })

  it("focuses Kilo when the notification action is selected", async () => {
    const ids: string[] = []
    const test = setup({
      notifications: true,
      action: true,
      capture: false,
      show: (sessionID, directory) => ids.push(`${sessionID}:${directory}`),
    })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }), "C:\\repo")
    await Promise.resolve()

    expect(ids).toEqual(["s1:C:\\repo"])
    test.service.dispose()
    test.restore()
  })

  it("suppresses VS Code notifications while Kilo is visible", () => {
    const test = setup({ notifications: true, visible: true, capture: false })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))

    expect(test.messages).toEqual([])
    test.service.dispose()
    test.restore()
  })

  it("notifies when a different Kilo session is visible", () => {
    const test = setup({ notifications: true, visible: (sessionID) => sessionID === "s2", capture: false })
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.asked", properties: { id: "q2", sessionID: "s2" } }))

    expect(test.messages).toEqual([{ message: "Kilo needs your input.", style: "info" }])
    test.service.dispose()
    test.restore()
  })

  it("stays silent for auto-approved permission requests", () => {
    const test = setup({ approve: () => true })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.replied", properties: { requestID: "p1", sessionID: "s1" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("plays attention when auto-approval fails and the request remains pending", async () => {
    const test = setup({ approve: async () => false })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    await Bun.sleep(0)

    expect(test.sounds).toEqual(["permission"])
    test.service.dispose()
  })

  it("stays silent when a permission resolves before auto-approval failure settles", async () => {
    const approval = Promise.withResolvers<boolean>()
    const test = setup({ approve: () => approval.promise })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.replied", properties: { requestID: "p1", sessionID: "s1" } }))
    approval.resolve(false)
    await Bun.sleep(0)

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("notifies after a terminal error closes the root session", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.error", properties: { sessionID: "s1", error: { name: "ApiError" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.sounds).toEqual(["error"])
    test.service.dispose()
  })

  it("shows an error notification only after a terminal error closes", () => {
    const test = setup({ notifications: true, capture: false })
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.error", properties: { sessionID: "s1", error: { name: "ApiError" } } }))
    expect(test.messages).toEqual([])
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.messages).toEqual([{ message: "Kilo task stopped due to an error.", style: "error" }])
    test.service.dispose()
    test.restore()
  })

  it("does not report an error when the session retries", () => {
    // The sound stays immediate, as it always has: it is a local cue that
    // something happened. Only the notification waits for the turn to close, so
    // a retry that recovers reports "done" without a "task failed" toast.
    const test = setup({ notifications: true, capture: false })
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.error", properties: { sessionID: "s1", error: { name: "ApiError" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "retry" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))

    expect(test.messages).toEqual([{ message: "Kilo task completed.", style: "info" }])
    test.service.dispose()
    test.restore()
  })

  it("stays silent when a turn is manually interrupted after becoming idle", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("does not treat an aborted session error as requiring attention", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(
      event({
        type: "session.error",
        properties: { sessionID: "s1", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
      }),
    )
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("clears transitions when the backend disconnects", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.state("disconnected")
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("clears transitions when a session is deleted", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.deleted", properties: { sessionID: "s1", info: { id: "s1" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s2", status: { type: "busy" } } }))
    test.event(event({ type: "sync", name: "session.deleted.1", data: { sessionID: "s2" } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s2", reason: "completed" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })
})

describe("attention defaults", () => {
  it("keeps attention sounds opt-in", async () => {
    const manifest = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: unknown[] }> } }
    }
    const properties = manifest.contributes.configuration.properties

    expect(properties["kilo-code.new.attention.enabled"]?.default).toBe(false)
    expect(properties["kilo-code.new.attention.notifications"]?.default).toBe(false)
    expect(properties["kilo-code.new.attention.OSNotifications"]?.default).toBe(false)
    expect(properties["kilo-code.new.attention.sound"]?.default).toBe("default")
    expect(properties["kilo-code.new.attention.sound"]?.enum).toEqual(["default", "system", ...CustomSoundIDs])
    expect(properties["kilo-code.new.sounds.agentEnabled"]).toBeUndefined()
    expect(properties["kilo-code.new.sounds.permissionsEnabled"]).toBeUndefined()
    expect(properties["kilo-code.new.sounds.errorsEnabled"]).toBeUndefined()
  })

  it("resolves global sound choices safely", () => {
    expect(resolveSoundID("default")).toBe("default")
    expect(resolveSoundID("system")).toBe("system")
    expect(resolveSoundID("alert-04")).toBe("alert-04")
    expect(resolveSoundID("unknown")).toBe("default")
  })

  it("packages every selectable bundled sound", async () => {
    const exists = await Promise.all(
      CustomSoundIDs.map((name) => Bun.file(new URL(`../../audio-wav/${name}.wav`, import.meta.url)).exists()),
    )
    expect(exists.every(Boolean)).toBe(true)
  })
})
