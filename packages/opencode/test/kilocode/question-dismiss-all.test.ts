import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloSessionPromptQueue } from "../../src/kilocode/session/prompt-queue"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("Question.dismissAll", () => {
  test("rejects pending asks for the target session and clears them", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sesA = SessionID.make("ses_a")
        const sesB = SessionID.make("ses_b")

        const a1 = Question.ask({
          sessionID: sesA,
          questions: [
            {
              header: "Continue?",
              question: "Should I continue?",
              options: [
                { label: "Yes", description: "Go" },
                { label: "No", description: "Stop" },
              ],
            },
          ],
        }).catch((err) => {
          if (err instanceof Question.RejectedError) return "rejected"
          throw err
        })

        const a2 = Question.ask({
          sessionID: sesA,
          questions: [
            {
              header: "Retry?",
              question: "Try again?",
              options: [
                { label: "Retry", description: "Retry" },
                { label: "Cancel", description: "Cancel" },
              ],
            },
          ],
        }).catch((err) => {
          if (err instanceof Question.RejectedError) return "rejected"
          throw err
        })

        const b1 = Question.ask({
          sessionID: sesB,
          questions: [
            {
              header: "Deploy?",
              question: "Deploy now?",
              options: [
                { label: "Ship", description: "Ship" },
                { label: "Wait", description: "Wait" },
              ],
            },
          ],
        }).catch((err) => {
          if (err instanceof Question.RejectedError) return "rejected-b"
          throw err
        })

        // Wait for all three asks to register so we can dismiss them.
        for (let i = 0; i < 50; i++) {
          if ((await Question.list()).length >= 3) break
          await Bun.sleep(10)
        }
        expect(await Question.list()).toHaveLength(3)

        // Track whether B's promise settles.
        let settled = false
        b1.then(() => {
          settled = true
        })

        await Question.dismissAll("ses_a")

        expect(await a1).toBe("rejected")
        expect(await a2).toBe("rejected")

        await new Promise((r) => setTimeout(r, 10))
        expect(settled).toBe(false)

        const remaining = await Question.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0]?.sessionID).toBe(sesB)

        await Question.reject(remaining[0]!.id)
        expect(await b1).toBe("rejected-b")
      },
    })
  })

  test("is a no-op when no questions exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Question.dismissAll("ses_missing")
        expect(await Question.list()).toEqual([])
      },
    })
  })

  test("ask rejects immediately when a followup is queued on the session", async () => {
    // When a newer prompt has already been enqueued on the session, a tool
    // that subsequently calls Question.ask would otherwise block the run until
    // the user manually dismisses it. Verify the pre-emptive hasFollowup check
    // rejects with RejectedError before any pending entry is registered.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_auto_ask")
        const started = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()

        // Slot 1 stays running so activeSince is pinned to its seq.
        const first = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_ask_1"),
            Effect.gen(function* () {
              started.resolve()
              yield* Effect.promise(() => release.promise)
              return "first" as const
            }),
            Effect.succeed("first-cancelled" as const),
          ),
        )
        await started.promise

        // Slot 2 arrives while slot 1 is active — latest > activeSince.
        const second = Effect.runPromise(
          KiloSessionPromptQueue.enqueue(
            sessionID,
            MessageID.make("message_ask_2"),
            Effect.succeed("second" as const),
            Effect.succeed("second-cancelled" as const),
          ),
        )
        await Bun.sleep(10)
        expect(KiloSessionPromptQueue.hasFollowup(sessionID)).toBe(true)

        await expect(
          Question.ask({
            sessionID,
            questions: [
              {
                header: "Continue?",
                question: "Should I continue?",
                options: [
                  { label: "Yes", description: "Go" },
                  { label: "No", description: "Stop" },
                ],
              },
            ],
          }),
        ).rejects.toBeInstanceOf(Question.RejectedError)
        expect(await Question.list()).toEqual([])

        release.resolve()
        expect(await first).toBe("first")
        expect(await second).toBe("second")
      },
    })
  })
})
