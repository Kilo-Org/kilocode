import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import type { Permission } from "@/permission"
import type { Question } from "@/question"
import { SessionID } from "@/session/schema"

const sessionID = SessionID.make("ses_blockers")

describe("KiloSessionPrompt.dismissBlockers", () => {
  test("rejects pending permission and question requests for the canceled session", async () => {
    const calls: string[] = []
    const permission = {
      list: () =>
        Effect.succeed([
          { id: "per_other", sessionID: SessionID.make("ses_other") },
          { id: "per_target", sessionID },
        ]),
      reply: ({ requestID }: { requestID: string }) => Effect.sync(() => (calls.push(`permission:${requestID}`), true)),
    } as unknown as Permission.Interface
    const question = {
      dismissAll: (id: SessionID) => Effect.sync(() => void calls.push(`question:${id}`)),
    } as unknown as Question.Interface

    await Effect.runPromise(KiloSessionPrompt.dismissBlockers(sessionID, permission, question))

    expect(calls).toEqual(["permission:per_target", `question:${sessionID}`])
  })
})
