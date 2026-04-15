import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { HPC_AI_BASE, HPC_AI_ID, HPC_AI_MODELS } from "../../src/kilocode/provider/hpc-ai"

const pid = ProviderID.make(HPC_AI_ID)

async function run<T>(fn: () => Promise<T>) {
  await using base = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "kilo.json"),
        JSON.stringify({
          $schema: "https://app.kilo.ai/config.json",
        }),
      )
    },
  })

  return Instance.provide({
    directory: base.path,
    fn,
  })
}

async function reset() {
  delete process.env["HPC_AI_API_KEY"]
  delete process.env["HPC_AI_BASE_URL"]
  await Auth.remove(HPC_AI_ID)
  ModelsDev.Data.reset()
}

beforeEach(reset)
afterEach(reset)

test("hpc-ai is injected into the models.dev provider list", async () => {
  const providers = await run(() => ModelsDev.get())
  const hpc = providers[HPC_AI_ID]

  expect(hpc).toBeDefined()
  expect(hpc.id).toBe(HPC_AI_ID)
  expect(hpc.name).toBe("HPC-AI")
  expect(hpc.env).toContain("HPC_AI_API_KEY")
  expect(hpc.api).toBe(HPC_AI_BASE)
  expect(hpc.npm).toBe("@ai-sdk/openai-compatible")

  for (const id of HPC_AI_MODELS) {
    expect(hpc.models[id]).toBeDefined()
    expect(hpc.models[id].id).toBe(id)
    expect(hpc.models[id].provider).toBeUndefined()
  }
})

test("hpc-ai connects through env api key and base url override", async () => {
  process.env["HPC_AI_API_KEY"] = "test-key"
  process.env["HPC_AI_BASE_URL"] = "https://example.test/inference/v1"
  ModelsDev.Data.reset()

  const providers = await run(() => Provider.list())
  const hpc = providers[pid]

  expect(hpc).toBeDefined()
  expect(hpc.source).toBe("env")
  expect(hpc.key).toBe("test-key")
  expect(hpc.options.baseURL).toBe("https://example.test/inference/v1")

  for (const id of HPC_AI_MODELS) {
    const model = hpc.models[ModelID.make(id)]
    expect(model).toBeDefined()
    expect(model.api.id).toBe(id)
    expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
    expect(model.api.url).toBe(HPC_AI_BASE)
  }
})
