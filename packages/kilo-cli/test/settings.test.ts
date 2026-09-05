import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Layout } from "../src/paths"
import { createSettingsStore, SETTINGS_FIELD_KEYS, type SettingsFieldKey, type SettingsSnapshot } from "../src/settings"
import { createPrivacyStore } from "../src/privacy-settings"

const secret = "sk-planted-provider-secret"

test("native compaction controls preserve sibling fields and accept zero token budgets", async () => {
  await using host = await isolated()
  await host.writeProfile('{ "compaction": { "auto": false, "keep": { "tokens": 300 } } }')
  const store = createSettingsStore({ layout: host.layout, project: host.project(true) })
  await store.set({ scope: "profile", key: "compaction.buffer", value: 0 })
  await store.set({ scope: "project", key: "compaction.auto", value: true })
  await store.set({ scope: "project", key: "compaction.keep.tokens", value: 0 })
  const snapshot = await store.read()
  expect(snapshot.fields.find((field) => field.key === "compaction.buffer")).toMatchObject({
    minimum: 0,
    values: { profile: 0 },
    source: "profile",
  })
  expect(snapshot.fields.find((field) => field.key === "compaction.keep.tokens")).toMatchObject({
    values: { profile: 300, project: 0 },
    source: "project",
  })
  expect(await Bun.file(host.layout.config).json()).toEqual({
    compaction: { auto: false, keep: { tokens: 300 }, buffer: 0 },
  })
  for (const value of [-1, 0.5, "300", null])
    await expect(store.set({ scope: "profile", key: "compaction.buffer", value })).rejects.toThrow()
  await store.reset({ scope: "project", key: "compaction.keep.tokens" })
  expect((await store.read()).fields.find((field) => field.key === "compaction.keep.tokens")).toMatchObject({
    values: { profile: 300 },
    source: "profile",
  })
})

test("dialog revisions refuse stale set/reset and first-write collisions", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })
  const absent = (await store.read()).scopes[0].expected!
  expect(absent).toEqual({ path: host.layout.config, revision: null })
  await host.writeProfile('{ "snapshots": false }')
  await expect(store.set({ scope: "profile", key: "snapshots", value: true, expected: absent })).rejects.toThrow(
    "Configuration changed",
  )

  const expected = (await store.read()).scopes[0].expected!
  expect(expected.revision).toMatch(/^[a-f0-9]{64}$/)
  await host.writeProfile('{ "snapshots": true, "shell": "/bin/sh" }')
  await expect(store.reset({ scope: "profile", key: "snapshots", expected })).rejects.toThrow("Configuration changed")
  expect(await Bun.file(host.layout.config).json()).toEqual({ snapshots: true, shell: "/bin/sh" })

  const current = (await store.read()).scopes[0].expected!
  expect(await store.set({ scope: "profile", key: "snapshots", value: false, expected: current })).toMatchObject({
    changed: true,
  })
  expect(await Bun.file(host.layout.config).json()).toEqual({ snapshots: false, shell: "/bin/sh" })
})

test("a changed project target refuses a dialog edit instead of writing a different file", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(true) })
  const expected = (await store.read()).scopes[1].expected!
  await Bun.write(path.join(host.directory, "kilo.jsonc"), '{ "snapshots": false }')
  await expect(store.set({ scope: "project", key: "snapshots", value: true, expected })).rejects.toThrow(
    "Configuration changed",
  )
  expect(await Bun.file(path.join(host.directory, "kilo.jsonc")).json()).toEqual({ snapshots: false })
  expect(await Bun.file(expected.path).exists()).toBe(false)
})

test("concurrent settings locations and privacy preserve each other's profile edits", async () => {
  await using host = await isolated()
  await host.writeProfile('{ "shell": "/bin/sh" }')
  const first = createSettingsStore({ layout: host.layout, project: host.project(false) })
  const second = createSettingsStore({ layout: host.layout, project: host.project(false) })
  const privacy = createPrivacyStore({ layout: host.layout })
  await Promise.all([
    first.set({ scope: "profile", key: "snapshots", value: false }),
    second.set({ scope: "profile", key: "tool_output.max_lines", value: 120 }),
    privacy.set(true),
  ])
  expect(await Bun.file(host.layout.config).json()).toMatchObject({
    shell: "/bin/sh",
    snapshots: false,
    tool_output: { max_lines: 120 },
    privacy_mode: true,
  })
  await expect(first.set({ scope: "profile", key: "snapshots", value: "invalid" })).rejects.toThrow()
  await privacy.set(false)
  expect(await privacy.read()).toMatchObject({ enabled: false })
})

test("reports both scopes and leaves the project scope unwritable without the explicit opt-in", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  const snapshot = await store.read()

  expect(snapshot.scopes[0]).toMatchObject({
    scope: "profile",
    path: host.layout.config,
    exists: false,
    writable: true,
  })
  expect(snapshot.scopes[1]).toMatchObject({
    scope: "project",
    path: path.join(host.directory, ".kilo", "kilo.jsonc"),
    exists: false,
    writable: false,
  })
  expect(snapshot.scopes[1].reason).toContain("--project-config")
  expect(snapshot.restartRequired).toBe(true)
  expect(snapshot.fields.map((field) => field.key)).toEqual([...SETTINGS_FIELD_KEYS])
  expect(snapshot.fields.every((field) => field.source === "unset")).toBe(true)
  expect(snapshot.fields.every((field) => field.values.profile === undefined)).toBe(true)
  await expect(store.set({ scope: "project", key: "snapshots", value: true })).rejects.toThrow(/--project-config/)
  expect(await Bun.file(path.join(host.directory, ".kilo", "kilo.jsonc")).exists()).toBe(false)
})

test("writes profile fields while preserving comments, unrelated keys, and the file mode", async () => {
  await using host = await isolated()
  await host.writeProfile(`{
  // kilo profile settings
  "agents": { "build": { "description": "keep me" } },
  "providers": { "openai": { "settings": { "apiKey": "${secret}" } } },
  "tool_output": { "max_bytes": 4096 }
}
`)
  await chmod(host.layout.config, 0o644)
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  expect(await store.set({ scope: "profile", key: "tool_output.max_lines", value: 200 })).toMatchObject({
    scope: "profile",
    key: "tool_output.max_lines",
    path: host.layout.config,
    changed: true,
  })
  await store.set({ scope: "profile", key: "model", value: "anthropic/claude-sonnet-4" })
  await store.set({ scope: "profile", key: "snapshots", value: false })
  await store.set({ scope: "profile", key: "websearch", value: { provider: "random" } })

  const text = await Bun.file(host.layout.config).text()
  expect(text).toContain("// kilo profile settings")
  expect(text).toContain('"description": "keep me"')
  expect(text).toContain(secret)

  const snapshot = await store.read()
  // Values are the canonical form the host resolves, not the raw literal.
  expect(profileValues(snapshot)).toMatchObject({
    "tool_output.max_lines": 200,
    "tool_output.max_bytes": 4096,
    model: { providerID: "anthropic", model: "claude-sonnet-4" },
    snapshots: false,
    websearch: { provider: "random" },
  })
  expect(fieldOf(snapshot, "model").source).toBe("profile")
  expect(snapshot.scopes[0]).toMatchObject({ scope: "profile", path: host.layout.config, exists: true, writable: true })
  expect((await stat(host.layout.config)).mode & 0o777).toBe(0o644)
  // Only managed fields are ever reported, so unrelated secrets never leave the file.
  expect(JSON.stringify(snapshot)).not.toContain(secret)
})

test("creates a new profile document owner-only and repeats are reported as unchanged", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  await store.set({ scope: "profile", key: "shell", value: "/bin/zsh" })

  expect((await stat(host.layout.config)).mode & 0o777).toBe(0o600)
  expect(await Bun.file(host.layout.config).json()).toEqual({ shell: "/bin/zsh" })
  expect(await store.set({ scope: "profile", key: "shell", value: "/bin/zsh" })).toMatchObject({ changed: false })
})

test("a rejected edit does not poison later edits on the same store", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  await expect(store.set({ scope: "profile", key: "tool_output.max_lines", value: -1 })).rejects.toThrow(
    "The supplied value is not valid for tool_output.max_lines",
  )
  expect(await Bun.file(host.layout.config).exists()).toBe(false)

  expect(await store.set({ scope: "profile", key: "tool_output.max_lines", value: 42 })).toMatchObject({
    changed: true,
  })
  await expect(store.set({ scope: "project", key: "shell", value: "/bin/sh" })).rejects.toThrow(/--project-config/)
  expect(await store.set({ scope: "profile", key: "shell", value: "/bin/zsh" })).toMatchObject({ changed: true })
  expect(profileValues(await store.read())).toMatchObject({ "tool_output.max_lines": 42, shell: "/bin/zsh" })
})

test("project values fold every loaded document and writes target the highest-priority one", async () => {
  await using host = await isolated()
  const nested = path.join(host.directory, "nested")
  await mkdir(path.join(nested, ".kilo"), { recursive: true })
  await Bun.write(
    path.join(host.directory, "kilo.jsonc"),
    '{ "shell": "/bin/from-ancestor", "tool_output": { "max_bytes": 111 } }\n',
  )
  await Bun.write(path.join(nested, ".kilo", "kilo.jsonc"), '{ "tool_output": { "max_bytes": 222 } }\n')
  const store = createSettingsStore({
    layout: host.layout,
    project: { enabled: true, directory: nested, boundary: host.directory },
  })
  const target = path.join(nested, ".kilo", "kilo.jsonc")

  const snapshot = await store.read()
  expect(snapshot.scopes[1]).toMatchObject({ scope: "project", path: target, exists: true, writable: true })
  // An ancestor document contributes shell even though it is not the write target.
  expect(fieldOf(snapshot, "shell").values).toEqual({ project: "/bin/from-ancestor" })
  expect(fieldOf(snapshot, "tool_output.max_bytes").values).toEqual({ project: 222 })

  // Resetting a key the target does not define changes nothing and does not
  // remove the ancestor's contribution.
  expect(await store.reset({ scope: "project", key: "shell" })).toMatchObject({ changed: false, path: target })
  expect(fieldOf(await store.read(), "shell").values).toEqual({ project: "/bin/from-ancestor" })

  expect(await store.set({ scope: "project", key: "shell", value: "/bin/from-target" })).toMatchObject({
    changed: true,
    path: target,
  })
  expect(fieldOf(await store.read(), "shell").values).toEqual({ project: "/bin/from-target" })
  expect(await Bun.file(path.join(host.directory, "kilo.jsonc")).text()).toContain("/bin/from-ancestor")
})

test("project values override the profile and reset falls back to the profile", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project(true) })
  await store.set({ scope: "profile", key: "tool_output.max_lines", value: 100 })
  const created = await store.set({ scope: "project", key: "tool_output.max_lines", value: 50 })
  await store.set({ scope: "project", key: "tool_output.max_bytes", value: 2048 })

  expect(created.path).toBe(path.join(host.directory, ".kilo", "kilo.jsonc"))
  const before = fieldOf(await store.read(), "tool_output.max_lines")
  expect(before.values).toEqual({ profile: 100, project: 50 })
  expect(before.source).toBe("project")

  expect(await store.reset({ scope: "project", key: "tool_output.max_lines" })).toMatchObject({ changed: true })

  const snapshot = await store.read()
  expect(fieldOf(snapshot, "tool_output.max_lines").values).toEqual({ profile: 100 })
  expect(fieldOf(snapshot, "tool_output.max_lines").source).toBe("profile")
  expect(fieldOf(snapshot, "tool_output.max_bytes").values).toEqual({ project: 2048 })
  expect(await store.reset({ scope: "project", key: "tool_output.max_lines" })).toMatchObject({ changed: false })
  expect(await store.reset({ scope: "profile", key: "tool_output.max_lines" })).toMatchObject({ changed: true })
  expect(fieldOf(await store.read(), "tool_output.max_lines").source).toBe("unset")
})

test("rejects values the native schema refuses without touching the document or echoing its content", async () => {
  await using host = await isolated()
  await host.writeProfile(`{ "providers": { "openai": { "settings": { "apiKey": "${secret}" } } } }\n`)
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })
  await store.set({ scope: "profile", key: "tool_output.max_lines", value: 200 })
  const before = await Bun.file(host.layout.config).text()

  const rejected = [
    { key: "tool_output.max_lines", value: -1 },
    { key: "tool_output.max_lines", value: 1.5 },
    { key: "model", value: "not-a-model-ref" },
    { key: "websearch", value: "maybe" },
    { key: "default_agent", value: "" },
    { key: "snapshots", value: "yes" },
  ] as const

  for (const attempt of rejected) {
    const failure = await store.set({ scope: "profile", key: attempt.key, value: attempt.value }).then(
      () => undefined,
      (error: Error) => error,
    )
    expect(failure?.message, `${attempt.key} must be rejected`).toBe(
      `The supplied value is not valid for ${attempt.key}`,
    )
    expect(String(failure)).not.toContain(secret)
  }
  expect(await Bun.file(host.layout.config).text()).toBe(before)
})

test("refuses a nested write when the stored parent is not an object", async () => {
  await using host = await isolated()
  await host.writeProfile('{ "tool_output": 5 }\n')
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  await expect(store.set({ scope: "profile", key: "tool_output.max_lines", value: 10 })).rejects.toThrow(
    /"tool_output" value in .* is not an object/,
  )
  expect(await Bun.file(host.layout.config).text()).toBe('{ "tool_output": 5 }\n')
})

test("follows the host and drops an invalid field instead of reporting it as configuration", async () => {
  await using host = await isolated()
  await host.writeProfile('{ "model": 5, "shell": "/bin/dash" }\n')
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  const snapshot = await store.read()
  expect(snapshot.scopes[0]).toMatchObject({ scope: "profile", path: host.layout.config, exists: true, writable: true })
  expect(fieldOf(snapshot, "model").values).toEqual({})
  expect(fieldOf(snapshot, "model").source).toBe("unset")
  expect(fieldOf(snapshot, "shell").values).toEqual({ profile: "/bin/dash" })
  expect(await store.set({ scope: "profile", key: "model", value: "anthropic/claude" })).toMatchObject({
    changed: true,
  })
  expect(fieldOf(await store.read(), "model").values).toEqual({
    profile: { providerID: "anthropic", model: "claude" },
  })
})

test("reports an ignored profile document and an unreadable project scope instead of guessing values", async () => {
  await using host = await isolated()
  await host.writeProfile('{ "shell": "/bin/dash"\n')
  await Bun.write(path.join(host.directory, "kilo.jsonc"), '{ "shell": \n')
  const store = createSettingsStore({ layout: host.layout, project: host.project(true) })

  const snapshot = await store.read()
  expect(snapshot.scopes[0]).toMatchObject({ exists: true, writable: true })
  expect(snapshot.scopes[0].reason).toContain("the host ignores it")
  expect(snapshot.scopes[1]).toMatchObject({ writable: false, reason: "Project configuration could not be read" })
  expect(snapshot.fields.every((field) => field.source === "unset")).toBe(true)
  // A malformed document is never rewritten from a partial parse.
  await expect(store.set({ scope: "profile", key: "shell", value: "/bin/zsh" })).rejects.toThrow(
    /not a JSON or JSONC object/,
  )
  expect(await Bun.file(host.layout.config).text()).toBe('{ "shell": "/bin/dash"\n')
})

test("a failed profile preflight stops reads of that path and refuses writes", async () => {
  await using host = await isolated()
  await mkdir(path.dirname(host.layout.config), { recursive: true })
  await Bun.write(path.join(host.root, "outside.jsonc"), `{ "shell": "${secret}" }\n`)
  await symlink(path.join(host.root, "outside.jsonc"), host.layout.config)
  const store = createSettingsStore({ layout: host.layout, project: host.project(false) })

  const snapshot = await store.read()
  expect(snapshot.scopes[0]).toMatchObject({ exists: false, writable: false })
  expect(snapshot.scopes[0].reason).toContain("symlink")
  expect(JSON.stringify(snapshot)).not.toContain(secret)
  await expect(store.set({ scope: "profile", key: "shell", value: "/bin/sh" })).rejects.toThrow(/symlink/)
  expect(await Bun.file(path.join(host.root, "outside.jsonc")).text()).toBe(`{ "shell": "${secret}" }\n`)
})

test("refuses symlinked or out-of-boundary project targets", async () => {
  await using host = await isolated()
  await mkdir(path.join(host.directory, ".kilo"), { recursive: true })
  await Bun.write(path.join(host.root, "outside.jsonc"), "{}\n")
  await symlink(path.join(host.root, "outside.jsonc"), path.join(host.directory, ".kilo", "kilo.jsonc"))
  const linked = createSettingsStore({ layout: host.layout, project: host.project(true) })

  const scope = (await linked.read()).scopes[1]
  expect(scope.writable).toBe(false)
  expect(scope.reason).toContain("symlink")
  await expect(linked.set({ scope: "project", key: "shell", value: "/bin/sh" })).rejects.toThrow(/symlink/)
  expect(await Bun.file(path.join(host.root, "outside.jsonc")).text()).toBe("{}\n")

  const escaped = createSettingsStore({
    layout: host.layout,
    project: { enabled: true, directory: host.root, boundary: host.directory },
  })
  const outside = (await escaped.read()).scopes[1]
  expect(outside.writable).toBe(false)
  expect(outside.reason).toContain("outside its project boundary")
})

function profileValues(snapshot: SettingsSnapshot) {
  return Object.fromEntries(snapshot.fields.map((field) => [field.key, field.values.profile]))
}

function fieldOf(snapshot: SettingsSnapshot, key: SettingsFieldKey) {
  const field = snapshot.fields.find((item) => item.key === key)
  if (!field) throw new Error(`Missing settings field: ${key}`)
  return field
}

async function isolated() {
  const created = await mkdtemp(path.join(os.tmpdir(), "kilo2-settings-test-"))
  // Canonical paths: the host resolves project documents through realpath.
  const root = await realpath(created)
  const directory = path.join(root, "project")
  await mkdir(directory, { recursive: true })
  const layout = makeLayout(root)
  return {
    root,
    directory,
    layout,
    project: (enabled: boolean) => ({ enabled, directory, boundary: directory }),
    writeProfile: async (text: string) => {
      await mkdir(path.dirname(layout.config), { recursive: true })
      await Bun.write(layout.config, text)
    },
    [Symbol.asyncDispose]: () => rm(created, { recursive: true, force: true }),
  }
}

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}
