import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fixture, type Fixture } from "./fixture"

const claudeID = "550e8400-e29b-41d4-a716-446655440000"
const claudeNewerID = "550e8400-e29b-41d4-a716-446655440001"
const codexID = "650e8400-e29b-41d4-a716-446655440000"
const codexInvalidID = "650e8400-e29b-41d4-a716-446655440001"

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.0"))(
  "external-sessions lists explicit Claude and Codex fixtures before opening the host or store",
  async () => {
    await using input = await fixture()
    const claudeSource = path.join(input.directory, "claude-source")
    const codexSource = path.join(input.directory, "codex-source")
    await Promise.all([mkdir(claudeSource), mkdir(codexSource)])
    const fixtureText = await Bun.file(path.join(import.meta.dir, "fixtures/external/claude.jsonl")).text()
    const valid = path.join(claudeSource, `${claudeID}.jsonl`)
    const invalid = path.join(claudeSource, `${claudeNewerID}.jsonl`)
    const secret = "SYNTHETIC_TRANSCRIPT_SECRET"
    const invalidText = `${fixtureText}\n${JSON.stringify({
      type: "assistant",
      version: "2.42.0",
      message: { role: "assistant", content: [{ type: "opaque_block", text: secret }] },
    })}`
    await writeFile(valid, fixtureText)
    await writeFile(invalid, invalidText)
    await writeFile(path.join(claudeSource, "not-a-session.jsonl"), fixtureText)
    const before = await Promise.all([valid, invalid].map(async (file) => Bun.file(file).arrayBuffer()))

    expect(await Bun.file(input.layout.database).exists()).toBe(false)
    expect(await Bun.file(input.layout.password).exists()).toBe(false)
    const result = await invoke(input, [
      "external-sessions",
      "--source",
      "claude",
      "--directory",
      claudeSource,
      "--limit",
      "2",
    ])
    expect(result.code, result.stderr).toBe(0)
    const entries = JSON.parse(result.stdout) as ReadonlyArray<{
      id: string
      file: string
      valid: boolean
      error?: string
      sourceModel?: unknown
    }>
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.id).sort()).toEqual([claudeID, claudeNewerID].sort())
    expect(entries.find((entry) => entry.id === claudeID)).toMatchObject({
      file: valid,
      valid: true,
      sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
    })
    const invalidEntry = entries.find((entry) => entry.id === claudeNewerID)
    expect(invalidEntry).toMatchObject({ file: invalid, valid: false })
    expect(invalidEntry?.error).toContain("unsupported Claude assistant content block")
    expect(result.stdout).not.toContain("Read src/index.ts and report back.")
    expect(result.stdout).not.toContain(secret)
    expect(await Promise.all([valid, invalid].map(async (file) => Bun.file(file).arrayBuffer()))).toEqual(before)
    expect(await Bun.file(input.layout.database).exists()).toBe(false)
    expect(await Bun.file(input.layout.password).exists()).toBe(false)

    const codexFixtureText = await Bun.file(path.join(import.meta.dir, "fixtures/external/codex.jsonl")).text()
    const codexValid = path.join(codexSource, `rollout-2026-08-04T10-00-00-${codexID}.jsonl`)
    const codexInvalid = path.join(codexSource, `rollout-2026-08-05T10-00-00-${codexInvalidID}.jsonl`)
    await writeFile(codexValid, codexFixtureText)
    await writeFile(codexInvalid, `${codexFixtureText}\nnot-json ${secret}`)
    const codexBefore = await Promise.all([codexValid, codexInvalid].map(async (file) => Bun.file(file).arrayBuffer()))
    const codexResult = await invoke(input, [
      "external-sessions",
      "--source",
      "codex",
      "--directory",
      codexSource,
      "--limit",
      "2",
    ])
    expect(codexResult.code, codexResult.stderr).toBe(0)
    const codexEntries = JSON.parse(codexResult.stdout) as ReadonlyArray<{
      id: string
      file: string
      valid: boolean
      sourceSessionID?: string
    }>
    expect(codexEntries).toHaveLength(2)
    expect(codexEntries.find((entry) => entry.id === codexID)).toMatchObject({
      file: codexValid,
      valid: true,
      sourceSessionID: "codex_fixture_session",
    })
    expect(codexEntries.find((entry) => entry.id === codexInvalidID)).toMatchObject({
      file: codexInvalid,
      valid: false,
    })
    expect(codexResult.stdout).not.toContain("The file exports answer = 42.")
    expect(codexResult.stdout).not.toContain(secret)
    expect(await Promise.all([codexValid, codexInvalid].map(async (file) => Bun.file(file).arrayBuffer()))).toEqual(
      codexBefore,
    )
    expect(await Bun.file(input.layout.database).exists()).toBe(false)

    const limited = await invoke(input, [
      "external-sessions",
      "--source",
      "claude",
      "--directory",
      claudeSource,
      "--limit",
      "1",
    ])
    expect(limited.code, limited.stderr).toBe(0)
    expect(JSON.parse(limited.stdout)).toHaveLength(1)
    expect(await Promise.all([valid, invalid].map(async (file) => Bun.file(file).arrayBuffer()))).toEqual(before)
  },
)

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.0"))(
  "external-sessions validates source and limit arguments without opening the host",
  async () => {
    await using input = await fixture()
    const source = path.join(input.directory, "empty-source")
    await mkdir(source)
    for (const args of [
      ["external-sessions", "--directory", source],
      ["external-sessions", "--source", "claude", "--directory", source, "--limit", "0"],
      ["external-sessions", "--source", "claude", "--directory", source, "--limit", "not-a-number"],
    ]) {
      const result = await invoke(input, args)
      expect(result.code).toBe(1)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("external-sessions")
      expect(result.stderr).not.toContain("SYNTHETIC_TRANSCRIPT_SECRET")
      expect(await Bun.file(input.layout.database).exists()).toBe(false)
    }
  },
)

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.0"))(
  "import-external returns an ID that the actual CLI exports without changing its source",
  async () => {
    await using input = await fixture()
    const source = path.join(input.directory, "claude.jsonl")
    const content = await Bun.file(path.join(import.meta.dir, "fixtures/external/claude.jsonl")).arrayBuffer()
    await Bun.write(source, content)
    const before = new Uint8Array(content)

    const imported = await invoke(input, [
      "import-external",
      source,
      "--model",
      "fixture/chat",
      "--agent",
      "build",
      "--directory",
      input.cwd,
    ])
    expect(imported.code, imported.stderr).toBe(0)
    expect(imported.stderr).toBe("")
    const result = JSON.parse(imported.stdout) as { sessionID: string }
    expect(Object.keys(result)).toEqual(["sessionID"])
    expect(result.sessionID).toStartWith("ses_")
    expect(new Uint8Array(await Bun.file(source).arrayBuffer())).toEqual(before)

    const exported = await invoke(input, ["export", result.sessionID])
    expect(exported.code, exported.stderr).toBe(0)
    const transcript = JSON.parse(exported.stdout)
    expect(transcript.info.id).toBe(result.sessionID)
    expect(transcript.info.metadata.externalResume).toMatchObject({
      format: "claude",
      sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
    })
    expect(JSON.stringify(transcript.messages)).toContain("Read src/index.ts and report back.")
    expect(new Uint8Array(await Bun.file(source).arrayBuffer())).toEqual(before)
  },
)

async function invoke(input: Fixture, args: ReadonlyArray<string>) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      "@opentui/solid/preload",
      path.resolve(import.meta.dir, "../src/tui-preview.ts"),
      ...args,
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}
