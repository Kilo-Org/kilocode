import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { instructionFilesByRead } from "../webview-ui/src/v2/instruction-files"

const read = (id: string, created: number, ran: number, completed?: number, path = "src/math.ts") =>
  ({
    type: "tool",
    id,
    name: "read",
    time: { created, ran, completed },
    state: { status: completed === undefined ? "running" : "completed", input: { path }, metadata: {} },
  }) as unknown as SessionMessageAssistant["content"][number]

const step = (id: string, created: number, content: SessionMessageAssistant["content"]) =>
  ({
    id,
    type: "assistant",
    agent: "default",
    model: { id: "model", providerID: "provider" },
    content,
    time: { created },
  }) as unknown as SessionMessageInfo

const user = (id: string, created: number) =>
  ({ id, type: "user", text: "Also check lib.", time: { created } }) as unknown as SessionMessageInfo

const instruction = (id: string, created: number, paths: readonly string[]) =>
  ({
    id,
    type: "synthetic",
    text: "Instructions",
    time: { created },
    metadata: { instruction: { paths } },
  }) as unknown as SessionMessageInfo

describe("read instruction files", () => {
  test("attaches the loaded paths to the read in the same directory", () => {
    const files = instructionFilesByRead(
      [step("a1", 1000, [read("read-1", 1001, 1100, 1300)]), instruction("s1", 1200, ["/repo/AGENTS.md"])],
      "/repo",
    )

    expect([...files]).toEqual([["read-1", ["/repo/AGENTS.md"]]])
  })

  test("attaches each instruction message to the read in its directory", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [
          read("read-src", 1001, 1100, 1300, "src/math.ts"),
          read("read-lib", 1002, 1150, 1400, "lib/util.ts"),
        ]),
        instruction("s1", 1200, ["/repo/src/AGENTS.md"]),
        instruction("s2", 1300, ["/repo/lib/AGENTS.md"]),
      ],
      "/repo",
    )

    expect(files.get("read-src")).toEqual(["/repo/src/AGENTS.md"])
    expect(files.get("read-lib")).toEqual(["/repo/lib/AGENTS.md"])
  })

  test("does not guess between reads in one directory that are still running", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [
          read("read-1", 1001, 1100, undefined, "src/math.ts"),
          read("read-2", 1002, 1150, undefined, "src/util.ts"),
        ]),
        instruction("s1", 1200, ["/repo/src/AGENTS.md"]),
      ],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("picks the read that completed just after the message when reads share a directory", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [
          read("read-1", 1001, 1100, 1250, "src/math.ts"),
          read("read-2", 1002, 1150, 1400, "src/util.ts"),
        ]),
        instruction("s1", 1200, ["/repo/src/AGENTS.md"]),
      ],
      "/repo",
    )

    expect([...files]).toEqual([["read-1", ["/repo/src/AGENTS.md"]]])
  })

  test("does not attach a read outside the instruction directory", () => {
    const files = instructionFilesByRead(
      [step("a1", 1000, [read("read-1", 1001, 1100, 1300)]), instruction("s1", 1200, ["/repo/lib/AGENTS.md"])],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("normalizes a relative read path with parent segments", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [read("read-1", 1001, 1100, 1300, "src/../lib/math.ts")]),
        instruction("s1", 1200, ["/repo/lib/AGENTS.md"]),
      ],
      "/repo",
    )

    expect([...files]).toEqual([["read-1", ["/repo/lib/AGENTS.md"]]])
  })

  test("resolves an absolute read path without the directory", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [read("read-1", 1001, 1100, 1300, "/repo/src/math.ts")]),
        instruction("s1", 1200, ["/repo/AGENTS.md"]),
      ],
    )

    expect([...files]).toEqual([["read-1", ["/repo/AGENTS.md"]]])
  })

  test("does not attach a read before it started", () => {
    const files = instructionFilesByRead(
      [step("a1", 1000, [read("read-1", 1001, 1300)]), instruction("s1", 1200, ["/repo/AGENTS.md"])],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("keeps the read candidates when a steer row arrives before the instruction message", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [read("read-1", 1001, 1100, 1400)]),
        user("u1", 1210),
        instruction("s1", 1220, ["/repo/AGENTS.md"]),
      ],
      "/repo",
    )

    expect([...files]).toEqual([["read-1", ["/repo/AGENTS.md"]]])
  })

  test("merges the paths of later instruction messages onto the same read", () => {
    const files = instructionFilesByRead(
      [
        step("a1", 1000, [read("read-1", 1001, 1100, 1600)]),
        instruction("s1", 1200, ["/repo/AGENTS.md"]),
        instruction("s2", 1300, ["/repo/AGENTS.md", "/repo/src/AGENTS.md"]),
      ],
      "/repo",
    )

    expect(files.get("read-1")).toEqual(["/repo/AGENTS.md", "/repo/src/AGENTS.md"])
  })

  test("ignores a failed read", () => {
    const failed = {
      type: "tool",
      id: "read-failed",
      name: "read",
      time: { created: 1001, ran: 1100, completed: 1300 },
      state: { status: "error", input: {}, error: { type: "tool", message: "failed" } },
    } as unknown as SessionMessageAssistant["content"][number]

    const files = instructionFilesByRead(
      [step("a1", 1000, [failed]), instruction("s1", 1200, ["/repo/AGENTS.md"])],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("ignores instruction messages without paths", () => {
    const files = instructionFilesByRead(
      [step("a1", 1000, [read("read-1", 1001, 1100, 1300)]), instruction("s1", 1200, [])],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("ignores instructions loaded before any read", () => {
    const files = instructionFilesByRead(
      [instruction("s1", 900, ["/repo/AGENTS.md"]), step("a1", 1000, [])],
      "/repo",
    )

    expect(files.size).toBe(0)
  })

  test("keeps a read without an instruction message empty", () => {
    const files = instructionFilesByRead([step("a1", 1000, [read("read-1", 1001, 1100, 1300)])], "/repo")

    expect(files.get("read-1")).toBeUndefined()
    expect(files.size).toBe(0)
  })
})
