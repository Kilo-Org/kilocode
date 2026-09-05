import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { INDEXING_CONFIG_MAX_BYTES, readIndexingConfig } from "../src/indexing-input"

const secret = "sk-do-not-echo-this-value"

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo2-indexing-input-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function file(directory: string, name: string, content: string) {
  const target = path.join(directory, name)
  await writeFile(target, content, "utf8")
  return target
}

test("reads an explicit JSONC indexing configuration", async () => {
  await withDirectory(async (directory) => {
    const target = await file(
      directory,
      "indexing.jsonc",
      `{
  // Comments and trailing commas are allowed, as in kilo.jsonc.
  "enabled": true,
  "provider": "openai-compatible",
  "model": "local-test-embed",
  "dimension": 32,
  "vectorStore": "lancedb",
  "openai-compatible": { "baseUrl": "http://127.0.0.1:1/v1/embeddings", "apiKey": "${secret}" },
  "fileExtensions": [".ts", ".tsx"],
}`,
    )

    const config = await readIndexingConfig(target)
    expect(config.enabled).toBe(true)
    expect(config.provider).toBe("openai-compatible")
    expect(config.dimension).toBe(32)
    expect(config.vectorStore).toBe("lancedb")
    expect(config["openai-compatible"]?.apiKey).toBe(secret)
    expect(config.fileExtensions).toEqual([".ts", ".tsx"])
  })
})

test("defaults to disabled configuration rather than inferring an opt-in", async () => {
  await withDirectory(async (directory) => {
    const config = await readIndexingConfig(await file(directory, "empty.json", "{}"))
    expect(config.enabled).toBeUndefined()
  })
})

test("rejects unreadable, irregular, symlinked, and oversized configuration files", async () => {
  await withDirectory(async (directory) => {
    await expect(readIndexingConfig("  ")).rejects.toThrow("Indexing configuration file is required")
    await expect(readIndexingConfig(path.join(directory, "missing.json"))).rejects.toThrow("does not exist")

    const folder = path.join(directory, "folder")
    await mkdir(folder)
    await expect(readIndexingConfig(folder)).rejects.toThrow("must be a regular file")

    const target = await file(directory, "real.json", "{}")
    const link = path.join(directory, "link.json")
    await symlink(target, link)
    await expect(readIndexingConfig(link)).rejects.toThrow("must not be a symlink")

    const big = await file(directory, "big.json", `{"enabled": true}${" ".repeat(INDEXING_CONFIG_MAX_BYTES)}`)
    await expect(readIndexingConfig(big)).rejects.toThrow(`exceeds ${INDEXING_CONFIG_MAX_BYTES} bytes`)
  })
})

test("rejects malformed and non-object configuration documents", async () => {
  await withDirectory(async (directory) => {
    await expect(readIndexingConfig(await file(directory, "broken.json", "{\n"))).rejects.toThrow(
      "not valid JSON or JSONC",
    )
    await expect(readIndexingConfig(await file(directory, "array.json", "[]"))).rejects.toThrow(
      "must be a JSON object",
    )
    await expect(readIndexingConfig(await file(directory, "scalar.json", '"enabled"'))).rejects.toThrow(
      "must be a JSON object",
    )
  })
})

test("validates against the engine schema and never echoes keys, values, or file content", async () => {
  await withDirectory(async (directory) => {
    const cases = [
      // Unknown keys are rejected so a typo cannot silently disable a setting.
      `{"enabled": true, "provdier": "openai", "openai": { "apiKey": "${secret}" }}`,
      `{"enabled": "yes", "openai": { "apiKey": "${secret}" }}`,
      `{"provider": "not-a-provider", "openai": { "apiKey": "${secret}" }}`,
      `{"dimension": -4, "openai": { "apiKey": "${secret}" }}`,
      `{"searchMinScore": 2, "openai": { "apiKey": "${secret}" }}`,
      `{"fileExtensions": [], "openai": { "apiKey": "${secret}" }}`,
      `{"openai": { "apiKey": "${secret}", "unexpected": true }}`,
    ]

    for (const [index, content] of cases.entries()) {
      const target = await file(directory, `case-${index}.json`, content)
      const error = await readIndexingConfig(target).then(
        () => undefined,
        (failure: unknown) => failure,
      )
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toBe("Indexing configuration does not match the indexing schema")
      expect(message).not.toContain(secret)
      expect(message).not.toContain("apiKey")
      expect(message).not.toContain("provdier")
      expect(message).not.toContain(target)
    }
  })
})
