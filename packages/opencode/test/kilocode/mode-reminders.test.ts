import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Session } from "../../src/session/session"
import { SessionReminders } from "../../src/session/reminders"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { KiloModeReminders } from "../../src/kilocode/session/mode-reminders"

const sessionID = SessionID.make("ses_mode")
const model = { providerID: ProviderV2.ID.make("openai"), modelID: ModelV2.ID.make("gpt-4") }

const code = { name: "code", native: true, permission: Permission.fromConfig({ "*": "allow" }) }
const ask = { name: "ask", native: true, permission: Permission.fromConfig({ "*": "deny", read: "allow", edit: "deny" }) }
const audit = {
  name: "security-audit",
  displayName: "Security Audit",
  permission: Permission.fromConfig({ "*": "allow", edit: "deny", write: "deny" }),
}
// Custom agent with a scoped edit allowlist: a catch-all check would call it read-only, so it must stay neutral.
const docsmith = { name: "docsmith", permission: Permission.fromConfig({ "*": "allow", edit: { "docs/**": "allow", "*": "deny" } }) }
const debug = { name: "debug", native: true, permission: Permission.fromConfig({ "*": "ask", edit: "allow" }) }
// An organization override of a native agent keeps native: true; capability must follow permissions, not the name.
const openAsk = { ...ask, permission: Permission.merge(ask.permission, Permission.fromConfig({ edit: "allow" })) }

function user(agent: string, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: { id, role: "user", sessionID, time: { created: 0 }, agent, model },
    parts: [{ id: PartID.ascending(), sessionID, messageID: id, type: "text", text }],
  }
}

function assistant(agent: string, parentID: MessageID): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      sessionID,
      time: { created: 0 },
      agent,
      mode: agent,
      parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [],
  }
}

function texts(message: MessageV2.WithParts) {
  return message.parts.filter((part): part is MessageV2.TextPart => part.type === "text").map((part) => part.text)
}

describe("KiloModeReminders.transition", () => {
  test("ask -> code lifts restrictions", () => {
    const text = KiloModeReminders.transition({ current: code, prior: "ask" })
    expect(text).toContain("changed from ask to code")
    expect(text).toContain(KiloModeReminders.WRITABLE)
    expect(text).toContain("supersedes earlier agent-switch reminders")
    expect(text).toContain("those of the code agent")
    expect(text).not.toContain("${")
    expect(text?.startsWith("\n\n<system-reminder>")).toBe(true)
  })

  test("code -> ask reinstates restrictions", () => {
    const text = KiloModeReminders.transition({ current: ask, prior: "code" })
    expect(text).toContain("changed from code to ask")
    expect(text).toContain(KiloModeReminders.READONLY)
  })

  test("ask -> custom writable agent cancels the ask restrictions", () => {
    const text = KiloModeReminders.transition({ current: debug, prior: "ask" })
    expect(text).toContain("changed from ask to debug")
    expect(text).toContain(KiloModeReminders.WRITABLE)
  })

  test("code -> custom agent uses displayName and a neutral capability line", () => {
    const text = KiloModeReminders.transition({ current: audit, prior: "code" })
    expect(text).toContain("changed from code to Security Audit")
    expect(text).toContain(KiloModeReminders.NEUTRAL)
    expect(text).not.toContain(KiloModeReminders.READONLY)
  })

  test("custom agent with a scoped edit allowlist is not called read-only", () => {
    const text = KiloModeReminders.transition({ current: docsmith, prior: "code" })
    expect(text).toContain(KiloModeReminders.NEUTRAL)
    expect(text).not.toContain("cannot modify files")
  })

  test("capability follows permissions for an organization-overridden ask", () => {
    expect(KiloModeReminders.transition({ current: openAsk, prior: "code" })).toContain(KiloModeReminders.WRITABLE)
  })

  test("plan -> code is writable", () => {
    expect(KiloModeReminders.transition({ current: code, prior: "plan" })).toContain(KiloModeReminders.WRITABLE)
  })

  test("no reminder when the agent did not change or on the first turn", () => {
    expect(KiloModeReminders.transition({ current: ask, prior: "ask" })).toBeUndefined()
    expect(KiloModeReminders.transition({ current: code, prior: "Code" })).toBeUndefined()
    expect(KiloModeReminders.transition({ current: code, prior: undefined })).toBeUndefined()
  })
})

describe("KiloModeReminders.apply", () => {
  const apply = (
    messages: MessageV2.WithParts[],
    agent: KiloModeReminders.Target,
    stored: MessageV2.Part[] = [],
    experimental = false,
  ) =>
    Effect.runPromise(
      SessionReminders.apply({
        messages,
        agent: agent as Agent.Info,
        session: {} as unknown as Session.Info,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            RuntimeFlags.layer({ experimentalPlanMode: experimental }),
            Layer.mock(Session.Service, {
              updatePart: <T extends MessageV2.Part>(part: T) => {
                stored.push(part)
                return Effect.succeed(part)
              },
            }),
            FSUtil.defaultLayer,
          ),
        ),
      ),
    )

  test("persists one switch reminder per agent change and keeps user text separate", async () => {
    const stored: MessageV2.Part[] = []
    const first = user("ask", "How does this work?")
    const next = user("code", "write this to a file:")
    await apply([first, assistant("ask", first.info.id), next], code, stored)

    const parts = texts(next)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBe("write this to a file:")
    expect(parts[1]).toContain("changed from ask to code")
    expect(stored).toHaveLength(1)
    const last = next.parts.at(-1)
    expect(last?.type === "text" && last.synthetic).toBe(true)
  })

  test("ask -> custom agent after code -> ask cancels the stale ask reminder", async () => {
    const stored: MessageV2.Part[] = []
    const start = user("code", "Implement it.")
    const asked = user("ask", "Explain what you did.")
    await apply([start, assistant("code", start.info.id), asked], ask, stored)
    const custom = user("debug", "Now fix the failing test.")
    await apply([start, assistant("code", start.info.id), asked, assistant("ask", asked.info.id), custom], debug, stored)

    expect(texts(asked).at(-1)).toContain(KiloModeReminders.READONLY)
    expect(texts(custom).at(-1)).toContain("changed from ask to debug")
    expect(texts(custom).at(-1)).toContain(KiloModeReminders.WRITABLE)
    expect(stored).toHaveLength(2)
  })

  test("does not duplicate a reminder already on the message", async () => {
    const stored: MessageV2.Part[] = []
    const start = user("code", "Implement it.")
    const back = user("ask", "Explain.")
    const messages = [start, assistant("code", start.info.id), back]
    await apply(messages, ask, stored)
    await apply(messages, ask, stored)

    expect(texts(back)).toHaveLength(2)
    expect(stored).toHaveLength(1)
  })

  test("no reminder on later turns with the same agent", async () => {
    const stored: MessageV2.Part[] = []
    const start = user("code", "Implement it.")
    const later = user("code", "Also add tests.")
    await apply([start, assistant("code", start.info.id), later], code, stored)

    expect(texts(later)).toEqual(["Also add tests."])
    expect(stored).toHaveLength(0)
  })
})
