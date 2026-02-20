// kilocode_change - new file
import { test, expect, describe, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { LearnTracker } from "../../src/kilocode/learn-tracker"
import { Bus } from "../../src/bus"

describe("LearnTracker", () => {
  describe("get", () => {
    test("returns empty state for unknown session", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const state = await LearnTracker.get("nonexistent")
          expect(state.checks).toEqual([])
          expect(state.level).toBe("intermediate")
        },
      })
    })
  })

  describe("record", () => {
    test("records a check and returns updated state", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const state = await LearnTracker.record({
            sessionID: "test-session",
            check: {
              question: "What does processQueue do?",
              category: "comprehension",
              quality: "correct",
              concepts: ["processQueue", "queue"],
            },
          })

          expect(state.checks).toHaveLength(1)
          expect(state.checks[0].question).toBe("What does processQueue do?")
          expect(state.checks[0].category).toBe("comprehension")
          expect(state.checks[0].quality).toBe("correct")
          expect(state.checks[0].concepts).toEqual(["processQueue", "queue"])
          expect(state.checks[0].id).toStartWith("chk_")
          expect(state.checks[0].timestamp).toBeGreaterThan(0)
        },
      })
    })

    test("appends multiple checks to the same session", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LearnTracker.record({
            sessionID: "append-test",
            check: {
              question: "Q1",
              category: "comprehension",
              quality: "correct",
              concepts: ["a"],
            },
          })
          const state = await LearnTracker.record({
            sessionID: "append-test",
            check: {
              question: "Q2",
              category: "reasoning",
              quality: "wrong",
              concepts: ["b"],
            },
          })

          expect(state.checks).toHaveLength(2)
          expect(state.checks[0].question).toBe("Q1")
          expect(state.checks[1].question).toBe("Q2")
        },
      })
    })

    test("persists state across reads", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LearnTracker.record({
            sessionID: "persist-test",
            check: {
              question: "Q1",
              category: "comprehension",
              quality: "correct",
              concepts: ["x"],
            },
          })

          const state = await LearnTracker.get("persist-test")
          expect(state.checks).toHaveLength(1)
          expect(state.checks[0].question).toBe("Q1")
        },
      })
    })

    test("isolates sessions from each other", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LearnTracker.record({
            sessionID: "session-a",
            check: {
              question: "Q-A",
              category: "comprehension",
              quality: "correct",
              concepts: ["a"],
            },
          })
          await LearnTracker.record({
            sessionID: "session-b",
            check: {
              question: "Q-B",
              category: "edge",
              quality: "wrong",
              concepts: ["b"],
            },
          })

          const stateA = await LearnTracker.get("session-a")
          const stateB = await LearnTracker.get("session-b")

          expect(stateA.checks).toHaveLength(1)
          expect(stateA.checks[0].question).toBe("Q-A")
          expect(stateB.checks).toHaveLength(1)
          expect(stateB.checks[0].question).toBe("Q-B")
        },
      })
    })

    test("publishes learn.updated bus event on record", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const events: { sessionID: string; state: LearnTracker.State }[] = []
          const unsub = Bus.subscribe(LearnTracker.Event.Updated, (evt) => {
            events.push(evt.properties)
          })

          await LearnTracker.record({
            sessionID: "bus-test",
            check: {
              question: "Q1",
              category: "comprehension",
              quality: "correct",
              concepts: ["x"],
            },
          })

          expect(events).toHaveLength(1)
          expect(events[0].sessionID).toBe("bus-test")
          expect(events[0].state.checks).toHaveLength(1)

          unsub()
        },
      })
    })

    test("generates unique check IDs", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const state1 = await LearnTracker.record({
            sessionID: "id-test",
            check: {
              question: "Q1",
              category: "comprehension",
              quality: "correct",
              concepts: ["a"],
            },
          })
          // small delay to ensure different timestamps
          await new Promise((r) => setTimeout(r, 2))
          const state2 = await LearnTracker.record({
            sessionID: "id-test",
            check: {
              question: "Q2",
              category: "reasoning",
              quality: "partial",
              concepts: ["b"],
            },
          })

          expect(state2.checks[0].id).not.toBe(state2.checks[1].id)
        },
      })
    })
  })

  describe("clear", () => {
    test("resets state to empty", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await LearnTracker.record({
            sessionID: "clear-test",
            check: {
              question: "Q1",
              category: "comprehension",
              quality: "correct",
              concepts: ["a"],
            },
          })

          await LearnTracker.clear("clear-test")

          const state = await LearnTracker.get("clear-test")
          expect(state.checks).toEqual([])
          expect(state.level).toBe("intermediate")
        },
      })
    })

    test("publishes bus event on clear", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const events: { sessionID: string; state: LearnTracker.State }[] = []
          const unsub = Bus.subscribe(LearnTracker.Event.Updated, (evt) => {
            events.push(evt.properties)
          })

          await LearnTracker.clear("clear-bus-test")

          expect(events).toHaveLength(1)
          expect(events[0].state.checks).toEqual([])
          expect(events[0].state.level).toBe("intermediate")

          unsub()
        },
      })
    })
  })

  describe("calibrate (via record)", () => {
    test("defaults to intermediate with no checks", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const state = await LearnTracker.get("empty")
          expect(state.level).toBe("intermediate")
        },
      })
    })

    test("stays intermediate with mixed results", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "mixed"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "wrong", concepts: ["b"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "correct", concepts: ["c"] },
          })

          expect(state.level).toBe("intermediate")
        },
      })
    })

    test("drops to beginner with 2+ wrong in last 5", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "beginner"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "wrong", concepts: ["b"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "wrong", concepts: ["c"] },
          })

          expect(state.level).toBe("beginner")
        },
      })
    })

    test("rises to advanced with 4+ correct in last 5", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "advanced"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "correct", concepts: ["b"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "correct", concepts: ["c"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q4", category: "edge", quality: "correct", concepts: ["d"] },
          })

          expect(state.level).toBe("advanced")
        },
      })
    })

    test("wrong takes priority over correct in calibration", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "priority"
          // 4 correct + 2 wrong = beginner (wrong >= 2 checked first)
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "correct", concepts: ["b"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "wrong", concepts: ["c"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q4", category: "edge", quality: "correct", concepts: ["d"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q5", category: "comprehension", quality: "wrong", concepts: ["e"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q6", category: "reasoning", quality: "correct", concepts: ["f"] },
          })

          // Last 5: correct, wrong, correct, wrong, correct => 2 wrong => beginner
          expect(state.level).toBe("beginner")
        },
      })
    })

    test("sliding window only considers last 5 checks", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "window"
          // First 3 are wrong (will slide out of window)
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "wrong", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "wrong", concepts: ["b"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "wrong", concepts: ["c"] },
          })
          // Next 5 are correct (these are the last 5)
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q4", category: "edge", quality: "correct", concepts: ["d"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q5", category: "comprehension", quality: "correct", concepts: ["e"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q6", category: "reasoning", quality: "correct", concepts: ["f"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q7", category: "system", quality: "correct", concepts: ["g"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q8", category: "edge", quality: "correct", concepts: ["h"] },
          })

          // Last 5: correct, correct, correct, correct, correct => 5 correct => advanced
          expect(state.level).toBe("advanced")
        },
      })
    })

    test("skipped answers do not count as wrong or correct", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "skipped"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "skipped", concepts: ["a"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "skipped", concepts: ["b"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "skipped", concepts: ["c"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q4", category: "edge", quality: "skipped", concepts: ["d"] },
          })
          const state = await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q5", category: "comprehension", quality: "skipped", concepts: ["e"] },
          })

          // All skipped: 0 wrong, 0 correct => intermediate
          expect(state.level).toBe("intermediate")
        },
      })
    })
  })

  describe("summary", () => {
    test("categorizes checks by quality", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "summary-test"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["Storage"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "wrong", concepts: ["Bus"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q3", category: "system", quality: "skipped", concepts: ["SSE"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q4", category: "edge", quality: "partial", concepts: ["calibrate"] },
          })

          const state = await LearnTracker.get(sid)
          const sum = LearnTracker.summary(state)

          expect(sum.understood).toEqual(["Storage"])
          expect(sum.gaps).toEqual(["Bus", "calibrate"])
          expect(sum.skipped).toEqual(["SSE"])
          expect(sum.total).toBe(4)
        },
      })
    })

    test("deduplicates concepts across checks", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sid = "dedup-test"
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q1", category: "comprehension", quality: "correct", concepts: ["Storage", "Bus"] },
          })
          await LearnTracker.record({
            sessionID: sid,
            check: { question: "Q2", category: "reasoning", quality: "correct", concepts: ["Storage", "SSE"] },
          })

          const state = await LearnTracker.get(sid)
          const sum = LearnTracker.summary(state)

          // Storage appears in both checks but should be deduplicated
          expect(sum.understood).toEqual(["Storage", "Bus", "SSE"])
        },
      })
    })

    test("returns empty arrays for empty state", () => {
      const sum = LearnTracker.summary({ checks: [], level: "intermediate" })
      expect(sum.understood).toEqual([])
      expect(sum.gaps).toEqual([])
      expect(sum.skipped).toEqual([])
      expect(sum.total).toBe(0)
      expect(sum.level).toBe("intermediate")
    })
  })
})
