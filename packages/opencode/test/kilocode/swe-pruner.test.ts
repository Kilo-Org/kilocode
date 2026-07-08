import { describe, expect, test } from "bun:test"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Config } from "../../src/config/config"
import { SwePruner } from "../../src/kilocode/swe-pruner"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"

const pid = ProviderID.make("test")
const mid = ModelID.make("swe-pruner-test")

function model(): Provider.Model {
  return {
    id: mid,
    providerID: pid,
    api: { id: mid, npm: "test-provider", url: "" },
    limit: { context: 100_000, output: 4_000 },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
  } as unknown as Provider.Model
}

function provider(seen: string[]): Provider.Interface {
  const mdl = model()
  const lang = {
    specificationVersion: "v3",
    provider: "test",
    modelId: mid,
    supportedUrls: {},
    doGenerate: async (input: LanguageModelV3CallOptions) => {
      seen.push(JSON.stringify(input))
      return {
        content: [{ type: "text", text: "1-10" }],
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 12 },
          outputTokens: { total: 8 },
          raw: {},
        },
        warnings: [],
        providerMetadata: {},
        request: {},
        response: {},
      }
    },
  } as unknown as LanguageModelV3
  return {
    defaultModel: () => Effect.succeed({ providerID: pid, modelID: mid }),
    getSmallModel: () => Effect.succeed(mdl),
    getModel: () => Effect.succeed(mdl),
    getLanguage: () => Effect.succeed(lang),
  } as unknown as Provider.Interface
}

describe("SwePruner.question", () => {
  test("extracts a non-empty focus question from raw args", () => {
    expect(SwePruner.question({ filePath: "/a", context_focus_question: "How is auth handled?" })).toBe(
      "How is auth handled?",
    )
  })

  test("returns undefined for missing, empty, or non-string values", () => {
    expect(SwePruner.question({ filePath: "/a" })).toBeUndefined()
    expect(SwePruner.question({ context_focus_question: "   " })).toBeUndefined()
    expect(SwePruner.question({ context_focus_question: 42 })).toBeUndefined()
    expect(SwePruner.question(undefined)).toBeUndefined()
    expect(SwePruner.question(null)).toBeUndefined()
  })
})

describe("SwePruner.prunable", () => {
  test("only read and grep are prunable", () => {
    expect(SwePruner.prunable("read")).toBe(true)
    expect(SwePruner.prunable("grep")).toBe(true)
    expect(SwePruner.prunable("bash")).toBe(false)
    expect(SwePruner.prunable("edit")).toBe(false)
  })
})

describe("SwePruner.extend", () => {
  test("adds the focus parameter without mutating the input schema", () => {
    const schema = {
      type: "object" as const,
      properties: { filePath: { type: "string" as const } },
      required: ["filePath"],
    }
    const extended = SwePruner.extend(schema)
    expect(extended.properties?.[SwePruner.PARAMETER]).toMatchObject({ type: "string" })
    expect(extended.required).toEqual(["filePath"])
    expect(schema.properties).not.toHaveProperty(SwePruner.PARAMETER)
  })

  test("leaves non-object schemas untouched", () => {
    const schema = { type: "string" as const }
    expect(SwePruner.extend(schema)).toBe(schema)
  })
})

describe("SwePruner.parse", () => {
  test("parses ranges and singles, clamps, sorts, and merges", () => {
    const ranges = SwePruner.parse("40-60\n10-20\n12\n62", 100)
    expect(ranges).toEqual([
      [1, 5],
      [10, 20],
      [40, 62],
      [96, 100],
    ])
  })

  test("always keeps head and tail lines", () => {
    const ranges = SwePruner.parse("50-55", 100)
    expect(ranges?.[0]).toEqual([1, 5])
    expect(ranges?.[ranges.length - 1]).toEqual([96, 100])
  })

  test("returns undefined for ALL or unparseable replies", () => {
    expect(SwePruner.parse("ALL", 100)).toBeUndefined()
    expect(SwePruner.parse("all of it is relevant", 100)).toBeUndefined()
    expect(SwePruner.parse("nothing useful here", 100)).toBeUndefined()
    expect(SwePruner.parse("", 100)).toBeUndefined()
  })

  test("drops ranges entirely out of bounds and clamps partial overlaps", () => {
    expect(SwePruner.parse("200-300", 100)).toBeUndefined()
    const ranges = SwePruner.parse("90-300", 100)
    expect(ranges?.[ranges.length - 1]).toEqual([90, 100])
  })

  test("tolerates reversed bounds and bulleted lists", () => {
    const ranges = SwePruner.parse("- 60-40\n* 70", 100)
    expect(ranges).toContainEqual([40, 60])
  })

  test("parses comma-separated ranges on a single line", () => {
    const ranges = SwePruner.parse("10-20, 30-40; 50", 100)
    expect(ranges).toContainEqual([10, 20])
    expect(ranges).toContainEqual([30, 40])
    expect(ranges).toContainEqual([50, 50])
  })

  test("treats comma-separated singles as singles, not a range", () => {
    const ranges = SwePruner.parse("10, 20", 100)
    expect(ranges).toContainEqual([10, 10])
    expect(ranges).toContainEqual([20, 20])
    expect(ranges).not.toContainEqual([10, 20])
  })

  test("tolerates JSON-style array replies", () => {
    const ranges = SwePruner.parse("[[10, 12], [30, 33]]", 100)
    expect(ranges).toContainEqual([10, 12])
    expect(ranges).toContainEqual([30, 33])
  })
})

describe("SwePruner.assemble", () => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)

  test("keeps selected ranges and marks omitted sections", () => {
    const output = SwePruner.assemble(
      lines,
      [
        [1, 3],
        [10, 12],
      ],
      20,
    )
    expect(output).toContain("line 1")
    expect(output).toContain("line 12")
    expect(output).not.toContain("line 5\n")
    expect(output).toContain("[6 lines omitted by SWE-Pruner]")
    expect(output).toContain("[8 lines omitted by SWE-Pruner]")
    expect(output.startsWith("[SWE-Pruner: kept 6 of 20 output lines")).toBe(true)
  })

  test("adds no trailing marker when the last range reaches the end", () => {
    const output = SwePruner.assemble(lines, [[18, 20]], 20)
    expect(output.endsWith("line 20")).toBe(true)
  })
})

describe("SwePruner.kept", () => {
  test("sums inclusive range sizes", () => {
    expect(
      SwePruner.kept([
        [1, 5],
        [10, 10],
      ]),
    ).toBe(6)
  })
})

describe("SwePruner.sweep", () => {
  test("preserves dynamically loaded instructions outside the pruned output", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `${index + 1}: ${"source content ".repeat(4)}`)
    const body = `<path>/repo/pkg/source.ts</path>\n<type>file</type>\n<content>\n${lines.join("\n")}\n</content>`
    const rules = Array.from({ length: 10 }, (_, index) => `Keep instruction ${index + 1} intact.`)
    const tail = `\n\n<system-reminder>\nInstructions from: /repo/pkg/AGENTS.md\n${rules.join("\n")}\n</system-reminder>`
    const seen: string[] = []
    const result = await SwePruner.sweep({
      tool: "read",
      args: { context_focus_question: "Where is the relevant source content?" },
      result: {
        title: "source.ts",
        output: body + tail,
        metadata: { truncated: false, loaded: ["/repo/pkg/AGENTS.md"] },
      },
    }).pipe(
      Effect.provideService(Provider.Service, provider(seen)),
      Effect.provideService(Config.Service, { get: () => Effect.succeed({}) } as Config.Interface),
      Effect.runPromise,
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("source content")
    expect(seen[0]).not.toContain(rules[0])
    expect(result.output).toEndWith(tail)
    expect(result.metadata["loaded"]).toEqual(["/repo/pkg/AGENTS.md"])
    expect(result.metadata["swePruner"]).toMatchObject({ kept: 29, total: 78 })
  })
})
