import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { prepareModelsSnapshot } from "../../../script/kilocode/models-snapshot"
import { loadModelsSnapshotFrom } from "../../../src/kilocode/provider/models-snapshot"

const fixture = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-test": {
        id: "claude-test",
        name: "Claude Test",
        release_date: "2026-01-01",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        limit: {
          context: 200_000,
          output: 8_192,
        },
      },
    },
  },
}

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "models-snapshot-test-"))
}

describe("models snapshot preparation", () => {
  test("accepts and canonicalizes a valid snapshot", async () => {
    const root = await tmp()
    try {
      const input = path.join(root, "api.json")
      const out = path.join(root, "models-snapshot.json")
      await Bun.write(input, JSON.stringify(fixture, null, 2))

      const info = await prepareModelsSnapshot({ input, output: out })

      expect(info.providers).toBe(1)
      expect(info.models).toBe(1)
      expect(await Bun.file(out).text()).toBe(`${JSON.stringify(fixture)}\n`)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fails invalid JSON before replacing the output", async () => {
    const root = await tmp()
    try {
      const input = path.join(root, "api.json")
      const out = path.join(root, "models-snapshot.json")
      await Bun.write(input, "{")
      await Bun.write(out, "previous")

      await expect(prepareModelsSnapshot({ input, output: out })).rejects.toThrow("not valid JSON")
      expect(await Bun.file(out).text()).toBe("previous")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fails empty snapshots", async () => {
    const root = await tmp()
    try {
      const input = path.join(root, "api.json")
      const out = path.join(root, "models-snapshot.json")
      await Bun.write(input, "{}")

      await expect(prepareModelsSnapshot({ input, output: out })).rejects.toThrow("at least one provider")
      expect(await Bun.file(out).exists()).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fails malformed provider data", async () => {
    const root = await tmp()
    try {
      const input = path.join(root, "api.json")
      const out = path.join(root, "models-snapshot.json")
      await Bun.write(
        input,
        JSON.stringify({
          anthropic: {
            id: "anthropic",
            name: "Anthropic",
            env: ["ANTHROPIC_API_KEY"],
            models: {
              broken: {
                id: "broken",
                name: "Broken",
                limit: {
                  context: 100,
                },
              },
            },
          },
        }),
      )

      await expect(prepareModelsSnapshot({ input, output: out })).rejects.toThrow("limit.output")
      expect(await Bun.file(out).exists()).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("models snapshot runtime loader", () => {
  test("loads the first valid snapshot file", async () => {
    const root = await tmp()
    try {
      const missing = path.join(root, "missing.json")
      const file = path.join(root, "models-snapshot.json")
      await Bun.write(file, JSON.stringify(fixture))

      await expect(loadModelsSnapshotFrom([missing, file])).resolves.toEqual(fixture)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
