import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ExternalSessionError, listExternalSessions, selectExternalSession } from "../src/external-sessions"

const claudeID = "550e8400-e29b-41d4-a716-446655440000"
const claudeNewerID = "550e8400-e29b-41d4-a716-446655440001"
const claudeInvalidID = "550e8400-e29b-41d4-a716-446655440002"
const codexID = "650e8400-e29b-41d4-a716-446655440000"
const codexOlderID = "650e8400-e29b-41d4-a716-446655440001"
const codexInvalidID = "650e8400-e29b-41d4-a716-446655440002"

function claude(lines: ReadonlyArray<unknown>) {
  return lines.map((value) => JSON.stringify(value)).join("\n")
}

function codex(lines: ReadonlyArray<unknown>) {
  return lines.map((value) => JSON.stringify(value)).join("\n")
}

function claudeTranscript() {
  return claude([
    { type: "user", version: "2.42.0", message: { role: "user", content: "Read the file" } },
    {
      type: "assistant",
      version: "2.42.0",
      message: {
        role: "assistant",
        model: "claude-sonnet-fixture",
        content: [{ type: "text", text: "The file is ready." }],
      },
    },
  ])
}

function codexTranscript() {
  return codex([
    { type: "session_meta", payload: { cli_version: "0.8.0", model_provider: "openai", session_id: "codex-list" } },
    {
      type: "turn_context",
      payload: { model: "gpt-5-fixture" },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Read the file" }] },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "The file is ready." }] },
    },
  ])
}

test("lists only v1-shaped Claude files from the explicit directory and reports invalid candidates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-external-sessions-"))
  try {
    const older = path.join(directory, `${claudeID}.jsonl`)
    const newer = path.join(directory, `${claudeNewerID}.jsonl`)
    const invalid = path.join(directory, `${claudeInvalidID}.jsonl`)
    await writeFile(older, claudeTranscript())
    await writeFile(newer, claudeTranscript())
    await writeFile(
      invalid,
      `${claudeTranscript()}\n${JSON.stringify({
        type: "assistant",
        version: "2.42.0",
        message: { role: "assistant", content: [{ type: "opaque_block" }] },
      })}`,
    )
    await writeFile(path.join(directory, "notes.jsonl"), claudeTranscript())
    await mkdir(path.join(directory, "nested"))
    await writeFile(path.join(directory, "nested", `${claudeNewerID}.jsonl`), claudeTranscript())
    await utimes(older, new Date(1000), new Date(1000))
    await utimes(newer, new Date(2000), new Date(2000))
    await utimes(invalid, new Date(3000), new Date(3000))
    const before = await Promise.all([older, newer, invalid].map(async (file) => Bun.file(file).text()))

    const entries = await listExternalSessions({ directory, source: "claude" })

    expect(entries.map((entry) => entry.id)).toEqual([claudeInvalidID, claudeNewerID, claudeID])
    expect(entries[0]).toMatchObject({
      source: "claude",
      file: invalid,
      valid: false,
    })
    expect(entries[0]?.error).toContain("unsupported Claude assistant content block")
    expect(entries[1]).toMatchObject({
      source: "claude",
      file: newer,
      valid: true,
      version: 2,
      sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
    })
    expect(entries.every((entry) => entry.file !== path.join(directory, "notes.jsonl"))).toBe(true)
    expect(entries.every((entry) => !entry.file.includes(`${path.sep}nested${path.sep}`))).toBe(true)
    expect(await Promise.all([older, newer, invalid].map(async (file) => Bun.file(file).text()))).toEqual(before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("lists Codex rollouts recursively in source timestamp order and selects older IDs beyond the display limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-external-sessions-"))
  try {
    const nested = path.join(directory, "2026", "08", "03")
    await mkdir(nested, { recursive: true })
    const newer = path.join(directory, `rollout-2026-08-04T10-00-00-${codexID}.jsonl`)
    const older = path.join(nested, `rollout-2026-08-03T10-00-00-${codexOlderID}.jsonl`)
    const invalid = path.join(directory, `rollout-2026-08-05T10-00-00-${codexInvalidID}.jsonl`)
    await writeFile(newer, codexTranscript())
    await writeFile(older, codexTranscript())
    await writeFile(invalid, `${codexTranscript()}\nnot-json`)
    await writeFile(path.join(directory, "rollout-not-a-session.jsonl"), codexTranscript())
    const before = await Promise.all([newer, older, invalid].map(async (file) => Bun.file(file).text()))

    const listed = await listExternalSessions({ directory, source: "codex", limit: 2 })
    expect(listed.map((entry) => entry.id)).toEqual([codexInvalidID, codexID])
    expect(listed[0]).toMatchObject({ valid: false, file: invalid })
    expect(listed[0]?.error).toContain("line 5 is not valid JSON")
    expect(listed[1]).toMatchObject({
      valid: true,
      file: newer,
      version: 0,
      sourceSessionID: "codex-list",
      sourceModel: { providerID: "openai", id: "gpt-5-fixture" },
    })

    const selected = await selectExternalSession({ directory, source: "codex", id: codexOlderID, limit: 1 })
    expect(selected).toMatchObject({ valid: true, id: codexOlderID, file: older })
    expect(await Promise.all([newer, older, invalid].map(async (file) => Bun.file(file).text()))).toEqual(before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("selection rejects missing, malformed, and non-absolute directories without consulting provider defaults", async () => {
  await expect(listExternalSessions({ directory: ".", source: "claude" })).rejects.toThrow(
    "explicit absolute directory",
  )
  await expect(
    listExternalSessions({ directory: path.join(os.tmpdir(), "kilo-external-sessions-missing"), source: "claude" }),
  ).rejects.toThrow(ExternalSessionError)

  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-external-sessions-"))
  try {
    await writeFile(path.join(directory, `${claudeID}.jsonl`), "{broken")
    await expect(selectExternalSession({ directory, source: "claude", id: claudeID })).rejects.toThrow(
      "is not importable",
    )
    await expect(selectExternalSession({ directory, source: "claude", id: claudeNewerID })).rejects.toThrow(
      "No claude transcript found",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
