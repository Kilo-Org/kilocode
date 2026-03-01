import { describe, expect, it } from "bun:test"
import { runModelBenchmark } from "../../src/bench/benchmark-runner"
import { BenchCreditError } from "../../src/bench/types"
import type { BenchApiHandler, BenchProblem, BenchRawResponse, BenchStreamChunk } from "../../src/bench/types"

function makeProblem(id: string, prompt: string): BenchProblem {
  return {
    id,
    mode: "code",
    title: id,
    prompt,
    contextFiles: [],
    evaluationCriteria: [],
    difficulty: "easy",
  }
}

function makeOk(text: string): AsyncIterable<BenchStreamChunk> {
  return (async function* () {
    yield { type: "text", text }
    yield { type: "usage", inputTokens: 5, outputTokens: 7, totalCost: 0.2 }
  })()
}

function makeCredit(message: string): AsyncIterable<BenchStreamChunk> {
  return (async function* () {
    throw new BenchCreditError(message)
  })()
}

describe("runModelBenchmark", () => {
  it("returns all responses when all problems succeed", async () => {
    const list = [makeProblem("p1", "one"), makeProblem("p2", "two")]
    const api: BenchApiHandler = {
      createMessage: (_sys, prompt) => makeOk(prompt),
      getModelId: () => "model-1",
    }

    const out = await runModelBenchmark(list, "model-1", api, null, () => {})

    expect(out).toHaveLength(2)
    expect(out.map((item) => item.problemId)).toEqual(["p1", "p2"])
  })

  it("emits completed responses through onResult before interruption", async () => {
    const list = [makeProblem("p1", "one"), makeProblem("p2", "two")]
    const seen: BenchRawResponse[] = []
    const api: BenchApiHandler = {
      createMessage: (_sys, prompt) => {
        if (prompt === "one") return makeOk("ok")
        return makeCredit("insufficient credits")
      },
      getModelId: () => "model-1",
    }

    const err = await runModelBenchmark(
      list,
      "model-1",
      api,
      null,
      () => {},
      undefined,
      (item) => {
        seen.push(item)
      },
    ).then(
      () => null,
      (x) => x,
    )

    expect(err).toBeInstanceOf(BenchCreditError)
    expect(err).toMatchObject({ message: "insufficient credits" })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.problemId).toBe("p1")
  })
})
