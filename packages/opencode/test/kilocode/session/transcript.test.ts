import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Session } from "@/session/session"
import { SessionTranscript } from "@/kilocode/session/transcript"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test")

function seed(dir: string) {
  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create({})
    const user = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID: session.id,
      role: "user",
      agent: "default",
      model: { providerID, modelID },
      time: { created: Date.now() },
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: user.id,
      sessionID: session.id,
      type: "text",
      text: "how do I rotate the signing keys?",
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: user.id,
      sessionID: session.id,
      type: "text",
      text: "injected file dump that should not be transcribed",
      synthetic: true,
    })
    const assistant = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID: session.id,
      role: "assistant",
      parentID: user.id,
      mode: "default",
      agent: "default",
      path: { cwd: dir, root: dir },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID,
      providerID,
      time: { created: Date.now(), completed: Date.now() },
      finish: "stop",
    })
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: session.id,
      type: "text",
      text: "run the rotation script with --apply",
    })
    return session
  })
}

function mention(id: SessionID) {
  return {
    type: "file" as const,
    mime: "text/plain",
    url: SessionTranscript.url(id),
    filename: "past-chat.md",
    source: {
      type: "file" as const,
      path: SessionTranscript.url(id),
      text: { value: "@past chat", start: 0, end: 10 },
    },
  }
}

describe("SessionTranscript.resolve", () => {
  it.live(
    "injects the referenced session transcript as context",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const past = yield* seed(dir)
        const current = yield* sessions.create({})

        const parts = yield* SessionTranscript.resolve(mention(past.id), {
          messageID: MessageID.ascending(),
          sessionID: current.id,
          sessions,
        })

        expect(parts).toHaveLength(3)
        const [note, transcript, file] = parts
        expect(note.type).toBe("text")
        expect(note.type === "text" && note.synthetic).toBe(true)
        expect(note.type === "text" && note.text).toContain("Attached transcript of past chat")
        expect(transcript.type === "text" && transcript.text).toContain("how do I rotate the signing keys?")
        expect(transcript.type === "text" && transcript.text).toContain("run the rotation script with --apply")
        expect(transcript.type === "text" && transcript.text).not.toContain(
          "injected file dump that should not be transcribed",
        )
        expect(file.type).toBe("file")
        expect(file.type === "file" && file.url).toBe(SessionTranscript.url(past.id))
      }),
    ),
  )

  it.live(
    "rejects sessions from a different workspace",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const past = yield* seed(dir)
        return yield* provideTmpdirInstance((other) =>
          Effect.gen(function* () {
            const current = yield* sessions.create({})
            expect(other).not.toBe(dir)
            const parts = yield* SessionTranscript.resolve(mention(past.id), {
              messageID: MessageID.ascending(),
              sessionID: current.id,
              sessions,
            })
            expect(parts).toHaveLength(1)
            expect(parts[0].type === "text" && parts[0].text).toContain("different workspace")
          }),
        )
      }),
    ),
  )

  it.live(
    "reports unknown or invalid session references",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const current = yield* sessions.create({})
        const missing = yield* SessionTranscript.resolve(mention(SessionID.make("ses_doesnotexist")), {
          messageID: MessageID.ascending(),
          sessionID: current.id,
          sessions,
        })
        expect(missing).toHaveLength(1)
        expect(missing[0].type === "text" && missing[0].text).toContain("not found")

        const invalid = yield* SessionTranscript.resolve(
          { ...mention(SessionID.make("ses_bad")), url: "session:not-a-session" },
          {
            messageID: MessageID.ascending(),
            sessionID: current.id,
            sessions,
          },
        )
        expect(invalid).toHaveLength(1)
        expect(invalid[0].type === "text" && invalid[0].text).toContain("invalid session reference")
        expect(dir).toBeTruthy()
      }),
    ),
  )
})

describe("SessionTranscript.format", () => {
  it.live(
    "truncates oversized transcripts keeping head and tail",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          agent: "default",
          model: { providerID, modelID },
          time: { created: Date.now() },
        })
        yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: user.id,
          sessionID: session.id,
          type: "text",
          text: `START ${"x".repeat(2000)} END`,
        })
        const [msg] = yield* sessions.messages({ sessionID: session.id })
        const text = SessionTranscript.format(session, [msg], { max: 600 })
        expect(text.length).toBeLessThan(700)
        expect(text).toContain("characters omitted")
        expect(text).toContain("START")
        expect(text).toContain("END")
      }),
    ),
  )
})
