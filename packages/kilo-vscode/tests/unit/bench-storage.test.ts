import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { describe, expect, it } from "bun:test"

import { loadAllResults, loadCheckpoint, loadLatestResult, saveCheckpoint, saveRunResult } from "../../src/bench/storage"
import type { BenchCheckpoint, BenchRunResult } from "../../src/bench/types"

function makeResult(id: string, runAt: string): BenchRunResult {
  return {
    id,
    runAt,
    problemSet: {
      version: "1.0.0",
      generatedAt: runAt,
      generatorModel: "gen",
      workspacePath: ".",
      workspaceSummary: "summary",
      problems: [
        {
          id: "p1",
          mode: "code",
          title: "title",
          prompt: "prompt",
          contextFiles: [],
          evaluationCriteria: [],
          difficulty: "medium",
        },
      ],
    },
    models: ["model-a"],
    config: {
      problemsPerMode: 1,
      activeModes: ["code"],
      generatorModel: "gen",
      evaluatorModel: "eval",
      maxParallelModels: 1,
      temperature: 0,
      weights: {
        quality: 0.5,
        relevance: 0.2,
        speed: 0.15,
        cost: 0.15,
      },
    },
    results: [
      {
        modelId: "model-a",
        modelName: "model-a",
        problems: [
          {
            problemId: "p1",
            mode: "code",
            responseContent: "ok",
            ttft: 10,
            totalTime: 100,
            inputTokens: 10,
            outputTokens: 20,
            cost: 0.001,
            evaluation: {
              qualityScore: 8,
              relevanceScore: 8,
              qualityRationale: "good",
              relevanceRationale: "good",
              speedScore: 8,
              costScore: 8,
              compositeScore: 8,
            },
          },
        ],
        aggregateScore: 8,
        modeScores: { code: 8 },
        totalCost: 0.001,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalTime: 100,
      },
    ],
  }
}

function makeCheckpoint(): BenchCheckpoint {
  return {
    runId: "run-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    models: ["model-a"],
    problemSet: {
      version: "1.0.0",
      generatedAt: "2026-01-01T00:00:00.000Z",
      generatorModel: "gen",
      workspacePath: ".",
      workspaceSummary: "summary",
      problems: [
        {
          id: "p1",
          mode: "code",
          title: "title",
          prompt: "prompt",
          contextFiles: [],
          evaluationCriteria: [],
          difficulty: "medium",
        },
      ],
    },
    config: {
      problemsPerMode: 1,
      activeModes: ["code"],
      generatorModel: "gen",
      evaluatorModel: "eval",
      maxParallelModels: 1,
      temperature: 0,
      weights: {
        quality: 0.5,
        relevance: 0.2,
        speed: 0.15,
        cost: 0.15,
      },
    },
    phase: "running",
    completedResponses: [],
    completedEvaluations: {},
    interruptReason: "test",
  }
}

async function withTempDir(fn: (cwd: string) => Promise<void>) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-bench-storage-"))
  try {
    await fn(cwd)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
}

describe("bench storage", () => {
  it("uses result id in filenames to avoid collisions", async () => {
    await withTempDir(async (cwd) => {
      const runAt = "2026-01-01T00:00:00.000Z"
      await saveRunResult(cwd, makeResult("run-a", runAt))
      await saveRunResult(cwd, makeResult("run-b", runAt))

      const files = await fs.readdir(path.join(cwd, ".kilocode", "bench", "results"))
      expect(files.filter((file) => file.endsWith(".json"))).toHaveLength(2)

      const all = await loadAllResults(cwd)
      expect(all.map((item) => item.id).sort()).toEqual(["run-a", "run-b"])
    })
  })

  it("skips malformed result files and returns the latest valid result", async () => {
    await withTempDir(async (cwd) => {
      const dir = path.join(cwd, ".kilocode", "bench", "results")
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(
        path.join(dir, "2026-01-03T00-00-00-000Z-invalid.json"),
        JSON.stringify({ id: "bad", runAt: "2026-01-03T00:00:00.000Z", models: "not-an-array" }),
        "utf-8",
      )
      await fs.writeFile(
        path.join(dir, "2026-01-02T00-00-00-000Z-valid.json"),
        JSON.stringify(makeResult("good", "2026-01-02T00:00:00.000Z")),
        "utf-8",
      )

      const latest = await loadLatestResult(cwd)
      expect(latest?.id).toBe("good")

      const all = await loadAllResults(cwd)
      expect(all).toHaveLength(1)
      expect(all[0]?.id).toBe("good")
    })
  })

  it("returns null for malformed checkpoint data", async () => {
    await withTempDir(async (cwd) => {
      const dir = path.join(cwd, ".kilocode", "bench")
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.join(dir, "checkpoint.json"),
        JSON.stringify({ runId: "bad", models: "not-an-array" }),
        "utf-8",
      )

      const checkpoint = await loadCheckpoint(cwd)
      expect(checkpoint).toBeNull()
    })
  })

  it("loads a valid checkpoint", async () => {
    await withTempDir(async (cwd) => {
      const checkpoint = makeCheckpoint()
      await saveCheckpoint(cwd, checkpoint)
      const loaded = await loadCheckpoint(cwd)
      expect(loaded?.runId).toBe(checkpoint.runId)
      expect(loaded?.phase).toBe("running")
      expect(loaded?.models).toEqual(["model-a"])
    })
  })
})
