import { describe, expect, test } from "bun:test"
import path from "node:path"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Provider } from "../../src/provider/provider"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_test")
const model = {
  providerID: ProviderV2.ID.make("openai"),
  modelID: ModelV2.ID.make("gpt-4"),
}
const session = {
  directory: "/repo/session",
  path: "session",
}
const mdl: Provider.Model = {
  id: model.modelID,
  providerID: model.providerID,
  api: { id: model.modelID, url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100_000, input: 100_000, output: 10_000 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function user(text: string, created: number, activeFile?: string, route?: string) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "user" as const,
      sessionID,
      time: { created },
      agent: "code",
      model,
      editorContext: {
        ...(route ? { directory: route, worktree: route } : {}),
        ...(activeFile ? { activeFile } : {}),
      },
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text" as const, text }],
  } satisfies MessageV2.WithParts
}

function assistant(parentID: MessageID, text: string) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant" as const,
      sessionID,
      time: { created: Date.now() },
      parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      mode: "code",
      agent: "code",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text" as const, text }],
  } satisfies MessageV2.WithParts
}

function inject(msgs: MessageV2.WithParts[], cache: KiloSessionPrompt.EnvCache = {}) {
  KiloSessionPrompt.injectEditorContext({ msgs, session, sessionID, cache })
}

function blocks(msg: MessageV2.WithParts) {
  return msg.parts.filter(
    (part): part is MessageV2.TextPart =>
      part.type === "text" && !!part.synthetic && part.text.startsWith("<environment_details>"),
  )
}

async function prompt(msgs: MessageV2.WithParts[]) {
  return JSON.stringify(await MessageV2.toModelMessages(msgs, mdl))
}

describe("injectEditorContext", () => {
  test("keeps the previous model prompt byte-identical across turns without persisting blocks", async () => {
    const stored1 = user("2 + 2", Date.parse("2026-08-24T12:00:00Z"), "src/one.ts")
    const turn1 = [structuredClone(stored1)]
    inject(turn1)
    const first = await prompt(turn1)

    expect(blocks(turn1[0])).toHaveLength(1)
    expect(blocks(stored1)).toHaveLength(0)

    const stored2 = user("3 + 3", Date.parse("2026-08-24T12:01:00Z"), "src/two.ts", "/repo/next")
    const turn2 = [structuredClone(stored1), assistant(stored1.info.id, "4"), structuredClone(stored2)]
    inject(turn2)

    expect((await prompt(turn2)).startsWith(first.slice(0, -1))).toBe(true)
    expect(blocks(turn2[0])).toHaveLength(1)
    expect(blocks(turn2[2])).toHaveLength(1)
    expect(blocks(turn2[0])[0].text).toContain("Active file: src/one.ts")
    expect(blocks(turn2[2])[0].text).toContain("Active file: src/two.ts")
    expect(blocks(turn2[0])[0].text).toContain("Message time: 2026-08-24T")
    expect(blocks(turn2[0])[0].text).toContain("Working directory: /repo/session")
    expect(blocks(turn2[0])[0].text).toContain(`Workspace root folder: ${path.resolve(session.directory, "..")}`)
    expect(blocks(turn2[2])[0].text).toContain("Working directory: /repo/next")
  })

  test("is byte-identical across repeated loop iterations", async () => {
    const stored = user("list files", Date.parse("2026-08-24T12:00:00Z"))
    const cache: KiloSessionPrompt.EnvCache = {}
    const first = [structuredClone(stored)]
    const second = [structuredClone(stored)]

    inject(first, cache)
    inject(second, cache)

    expect(await prompt(second)).toBe(await prompt(first))
    expect(blocks(second[0])).toHaveLength(1)
  })

  test("does not mistake user-authored markup for an injected block", () => {
    const stored = user("<environment_details>example</environment_details>", Date.parse("2026-08-24T12:00:00Z"))
    const msgs = [stored]
    inject(msgs)

    expect(blocks(stored)).toHaveLength(1)
    expect(stored.parts.filter((part) => part.type === "text")).toHaveLength(2)
  })
})
