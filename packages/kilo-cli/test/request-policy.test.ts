import { expect, test } from "bun:test"
import { ProjectID } from "@opencode-ai/schema/project-id"
import { Location } from "@opencode-ai/schema/location"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Effect } from "effect"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Layout } from "../src/paths"
import { readDataCollectionPolicy } from "../src/request-policy"
import { createSettingsStore } from "../src/settings"

// The reader reuses the real settings fold, so its cases are the fold's: profile/project
// scope precedence, explicit true/false, reset fall-through, and invalid stored values.
// "deny" is returned only for an effective explicit true; everything else is undefined.

test("data-collection policy resolves only an explicit effective true", async () => {
  await using host = await isolated()
  const read = () => Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: true }, host.location))

  expect(await read()).toBeUndefined()

  await host.writeProfile('{ "hide_prompt_training_models": false }\n')
  expect(await read()).toBeUndefined()

  await host.writeProfile('{ "hide_prompt_training_models": true }\n')
  expect(await read()).toBe("deny")

  // Project wins over profile in both directions.
  await host.writeProject(".kilo/kilo.jsonc", '{ "hide_prompt_training_models": false }\n')
  expect(await read()).toBeUndefined()
  await host.writeProject(".kilo/kilo.jsonc", '{ "hide_prompt_training_models": true }\n')
  expect(await read()).toBe("deny")

  // Every loaded project document folds in, lowest to highest priority: the root document
  // contributes but the higher-priority `.kilo` document still wins.
  await host.writeProject("kilo.jsonc", '{ "hide_prompt_training_models": false }\n')
  expect(await read()).toBe("deny")
})

test("data-collection policy follows settings edits including reset fall-through", async () => {
  await using host = await isolated()
  const store = createSettingsStore({ layout: host.layout, project: host.project })
  const read = () => Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: true }, host.location))

  await store.set({ scope: "profile", key: "hide_prompt_training_models", value: true })
  expect(await read()).toBe("deny")

  // Reset falls back to the lower-priority contribution, then to unset.
  await store.set({ scope: "project", key: "hide_prompt_training_models", value: false })
  expect(await read()).toBeUndefined()
  await store.reset({ scope: "project", key: "hide_prompt_training_models" })
  expect(await read()).toBe("deny")
  await store.reset({ scope: "profile", key: "hide_prompt_training_models" })
  expect(await read()).toBeUndefined()
})

test("data-collection policy treats invalid stored values as unset and never invents a restriction", async () => {
  await using host = await isolated()
  const read = () => Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: true }, host.location))

  // A wrong-typed stored value resolves as unset; the settings snapshot reports it invalid.
  await host.writeProfile('{ "hide_prompt_training_models": "sk-private-value" }\n')
  expect(await read()).toBeUndefined()
  const field = (await createSettingsStore({ layout: host.layout, project: host.project }).read()).fields.find(
    (item) => item.key === "hide_prompt_training_models",
  )
  expect(field?.invalid).toBe("The stored hide_prompt_training_models value is not a boolean and is ignored")

  // An invalid project value does not shadow a valid profile opt-in, matching the fold the
  // dialog and picker display.
  await host.writeProfile('{ "hide_prompt_training_models": true }\n')
  await host.writeProject(".kilo/kilo.jsonc", '{ "hide_prompt_training_models": "sk-private-value" }\n')
  expect(await read()).toBe("deny")
})

test("data-collection policy treats a stored null as invalid, never absent-shadowing", async () => {
  await using host = await isolated()
  const read = () => Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: true }, host.location))
  const field = async () =>
    (await createSettingsStore({ layout: host.layout, project: host.project }).read()).fields.find(
      (item) => item.key === "hide_prompt_training_models",
    )

  // Sole null: invalid stored value, resolves unset — no deny, with the notice reported.
  await host.writeProfile('{ "hide_prompt_training_models": null }\n')
  expect(await read()).toBeUndefined()
  expect((await field())?.invalid).toBe("The stored hide_prompt_training_models value is not a boolean and is ignored")

  // An invalid (null) project value does not shadow a valid profile opt-in; the
  // profile still wins per the existing invalid-scope fallback, and the notice stays.
  await host.writeProfile('{ "hide_prompt_training_models": true }\n')
  await host.writeProject(".kilo/kilo.jsonc", '{ "hide_prompt_training_models": null }\n')
  expect(await read()).toBe("deny")
  expect((await field())?.invalid).toBeDefined()

  // A project null with no profile value resolves unset — nothing is invented.
  await host.writeProfile('{ "shell": "/bin/dash" }\n')
  expect(await read()).toBeUndefined()
})

test("data-collection policy honors a raw Kilo-only value from a natively ignored profile", async () => {
  await using host = await isolated()
  // A missing {file:...} reference fails the host substitution pipeline: the document
  // contributes no native configuration, while the separately parsed raw Kilo-only
  // value still applies. This pins the inherited, checkpoint-accepted raw-fold behavior.
  await host.writeProfile(
    '{ "hide_prompt_training_models": true, "shell": "{file:/nonexistent/kilo-request-policy-test-missing.json}" }\n',
  )
  expect(await Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: true }, host.location))).toBe(
    "deny",
  )
  const snapshot = await createSettingsStore({ layout: host.layout, project: host.project }).read()
  expect(snapshot.scopes[0].reason).toContain("the host ignores it")
  expect(snapshot.fields.find((item) => item.key === "shell")?.values).toEqual({})
})

test("data-collection policy is unavailable when project documents are disabled", async () => {
  await using host = await isolated()
  await host.writeProject(".kilo/kilo.jsonc", '{ "hide_prompt_training_models": true }\n')
  const read = () => Effect.runPromise(readDataCollectionPolicy({ layout: host.layout, project: false }, host.location))
  expect(await read()).toBeUndefined()
  await host.writeProfile('{ "hide_prompt_training_models": true }\n')
  expect(await read()).toBe("deny")
})

async function isolated() {
  const created = await mkdtemp(path.join(os.tmpdir(), "kilo2-request-policy-test-"))
  // Canonical paths: the host resolves project documents through realpath.
  const root = await realpath(created)
  const directory = path.join(root, "project")
  await mkdir(directory, { recursive: true })
  const layout = makeLayout(root)
  const location = new Location.Info({
    directory: AbsolutePath.make(directory),
    project: {
      id: ProjectID.make("request-policy-test"),
      directory: AbsolutePath.make(directory),
      canonical: AbsolutePath.make(directory),
    },
  })
  return {
    root,
    directory,
    layout,
    location,
    project: { enabled: true, directory, boundary: directory },
    writeProfile: async (text: string) => {
      await mkdir(path.dirname(layout.config), { recursive: true })
      await Bun.write(layout.config, text)
    },
    writeProject: async (relative: string, text: string) => {
      const target = path.join(directory, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await Bun.write(target, text)
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
