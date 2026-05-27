import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { GrepTool } from "@/tool/grep"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { Ripgrep } from "@/file/ripgrep"
import { MessageID, SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const raised = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    TestConfig.layer({ get: () => Effect.succeed({ tool_output: { max_bytes: 100 * 1024 } }) }),
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("kilocode grep budget", () => {
  it.live("initializes without instance-scoped output configuration", () =>
    Effect.gen(function* () {
      const grep = yield* (yield* GrepTool).init()
      expect(grep.description).toContain("previewed to 500 characters")
    }),
  )

  it.instance("limits each matching line to 500 characters", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const text = `needle${"x".repeat(600)}`
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "long.txt"), text))
      const grep = yield* (yield* GrepTool).init()
      const result = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx)

      expect(grep.description).toContain("previewed to 500 characters")
      expect(result.metadata.linesTruncated).toBe(true)
      expect(result.output).toContain(`Line 1: ${text.slice(0, 500)}... [truncated]`)
      expect(result.output).toContain("Use Read on the original file at the reported line to see full content")
      expect(result.output).not.toContain(text.slice(0, 501))
    }),
  )

  raised.instance("truncates a 100-match preview at the grep cap even when configured higher", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const content = Array.from(
        { length: 100 },
        (_, i) => `needle${String(i).padStart(3, "0")}${"x".repeat(700)}`,
      ).join("\n")
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "large.txt"), content))
      const grep = yield* (yield* GrepTool).init()
      const result = yield* grep.execute({ pattern: "needle", path: test.directory }, ctx)

      expect(result.metadata.matches).toBe(100)
      expect(result.metadata.truncated).toBe(true)
      expect(result.metadata.linesTruncated).toBe(true)
      expect(result.output).toContain("The tool call succeeded but the output was truncated")
      expect(result.output).toContain("Saved grep output also contains shortened previews")
      expect(result.output).toContain("Use Read on the original file at the reported line to see full content")
      const file = result.metadata.outputPath
      if (!file) throw new Error("expected saved full output")
      const saved = yield* Effect.promise(() => Bun.file(file).text())
      expect(Buffer.byteLength(saved, "utf-8")).toBeGreaterThan(50 * 1024)
      expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThan(Buffer.byteLength(saved, "utf-8"))
      expect(saved).toContain("Line 100:")
    }),
  )
})
