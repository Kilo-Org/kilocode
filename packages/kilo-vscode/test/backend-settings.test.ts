import { expect, test } from "bun:test"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import os from "node:os"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { SettingsRpc } from "@opencode-ai/schema/kilocode/settings"
import type { Layout } from "../../kilo-cli/src/paths"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createSettingsMethods } from "../src/backend/settings"

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

const PROJECT_CONFIG_RELATIVE = path.join(".kilo", "kilo.jsonc")

test("config adapter translates v1 config calls through native reads and the settings RPC", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "kilo-settings-adapter-"))
  const created = await mkdtemp(path.join(tmpdir(), "kilo2-vscode-settings-"))
  // Canonical paths: the host resolves locations through realpath.
  const [realProject, realRoot] = await Promise.all([realpath(project), realpath(created)])
  const layout = makeLayout(realRoot)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, { models: false, recover: false, projectConfig: true })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          yield* Effect.promise(async () => {
            const methods = createSettingsMethods(verified.client, realProject)
            await expect(
              methods.config.get({ workspace: "missing-workspace" }, { throwOnError: true }),
            ).rejects.toBeDefined()

            const overlay = (await methods.config.overlay({ scope: "project" }, { throwOnError: true })).data!
            expect(overlay.scope).toBe("project")
            expect(overlay.targets.project).toMatchObject({
              scope: "project",
              path: path.join(realProject, PROJECT_CONFIG_RELATIVE),
              exists: false,
              writable: true,
              revision: null,
              raw: {},
            })
            expect(overlay.targets.global).toMatchObject({
              scope: "global",
              path: layout.config,
              exists: false,
              writable: true,
              revision: null,
              raw: {},
            })
            expect(overlay.targets.active).toEqual(overlay.targets.project)
            expect(Object.keys(overlay.fields)).toContain("model")
            expect(overlay.fields.model.editable).toBe(true)
            expect(overlay.collections).toEqual({})

            // Managed authored keys land through the settings RPC with the
            // caller's revision guarding the first write.
            const first = (
              await methods.config.overlayUpdate(
                {
                  scope: "project",
                  set: { tool_output: { max_lines: 200 }, snapshot: false, hide_prompt_training_models: true },
                  expected: { path: overlay.targets.project.path, revision: null },
                },
                { throwOnError: true },
              )
            ).data!
            expect(first.effective).toMatchObject({
              tool_output: { max_lines: 200 },
              snapshots: false,
              hide_prompt_training_models: true,
            })
            expect(first.targets.project.exists).toBe(true)
            expect(first.targets.project.revision).toMatch(/^[a-f0-9]{64}$/)
            const written = JSON.parse(await readFile(first.targets.project.path, "utf8"))
            expect(written).toEqual({
              snapshots: false,
              tool_output: { max_lines: 200 },
              hide_prompt_training_models: true,
            })

            // The v1 runtime consumed top-level subagent_depth, so it wins over
            // an experimental value authored in the same patch.
            const precedence = (
              await methods.config.overlayUpdate(
                {
                  scope: "project",
                  set: { subagent_depth: 3, experimental: { subagent_depth: 2 } },
                  expected: { path: first.targets.project.path, revision: first.targets.project.revision! },
                },
                { throwOnError: true },
              )
            ).data!
            expect(precedence.effective.experimental).toMatchObject({ subagent_depth: 3 })

            // The native settings RPC sees the same authoritative state.
            const snapshot = await verified.client.rpc(SettingsRpc.Definition).read(
              {},
              {
                location: { directory: realProject },
              },
            )
            const depth = snapshot.fields.find((field) => field.key === "experimental.subagent_depth")
            expect(depth?.values.project).toBe(3)
            const hide = snapshot.fields.find((field) => field.key === "hide_prompt_training_models")
            expect(hide?.values.project).toBe(true)

            // Unset removes the managed leaf through the reset path.
            const fresh = (await methods.config.overlay({ scope: "project" }, { throwOnError: true })).data!
            const removed = (
              await methods.config.overlayUpdate(
                {
                  scope: "project",
                  unset: [["tool_output", "max_lines"]],
                  expected: { path: fresh.targets.project.path, revision: fresh.targets.project.revision! },
                },
                { throwOnError: true },
              )
            ).data!
            const afterUnset = JSON.parse(await readFile(fresh.targets.project.path, "utf8"))
            expect(afterUnset.tool_output?.max_lines).toBeUndefined()
            expect(removed.effective.tool_output?.max_lines).toBeUndefined()

            // A stale revision refuses the whole patch instead of writing a
            // different file, matching the store's conflict authority.
            await expect(
              methods.config.overlayUpdate(
                {
                  scope: "project",
                  set: { shell: "/bin/sh" },
                  expected: { path: fresh.targets.project.path, revision: null },
                },
                { throwOnError: true },
              ),
            ).rejects.toThrow("Configuration changed")

            // Unsupported authored fields are refused before any write; no
            // partial application and never a silent success.
            const beforeText = await readFile(fresh.targets.project.path, "utf8")
            // Collections outside the closed set stay refused even though the
            // provider/agents/permission collections are writable now.
            await expect(
              methods.config.overlayUpdate(
                {
                  scope: "project",
                  set: { shell: "/bin/sh", formatter: { shorthand: {} } },
                  expected: { path: fresh.targets.project.path, revision: fresh.targets.project.revision! },
                },
                { throwOnError: true },
              ),
            ).rejects.toThrow("unsupported config keys: formatter")
            expect(await readFile(fresh.targets.project.path, "utf8")).toBe(beforeText)

            // config.update applies managed leaves to the project scope.
            const updated = (await methods.config.update({ config: { shell: "/bin/sh" } }, { throwOnError: true }))
              .data!
            expect(updated.shell).toBe("/bin/sh")
            await expect(
              methods.config.update({ config: { nope_provider: { name: "nope" } } }, { throwOnError: true }),
            ).rejects.toThrow("unsupported config keys: nope_provider")

            // Global writes route to the profile scope; the project scope keeps
            // its own values and the merged read resolves project over global.
            const globalOverlay = (await methods.config.overlay({ scope: "global" }, { throwOnError: true })).data!
            const globalWritten = (
              await methods.config.overlayUpdate(
                {
                  scope: "global",
                  set: { hide_prompt_training_models: true, shell: "/bin/global-shell" },
                  expected: {
                    path: globalOverlay.targets.global.path,
                    revision: globalOverlay.targets.global.revision,
                  },
                },
                { throwOnError: true },
              )
            ).data!
            expect(JSON.parse(await readFile(layout.config, "utf8"))).toMatchObject({
              hide_prompt_training_models: true,
              shell: "/bin/global-shell",
            })
            expect(globalWritten.global.shell).toBe("/bin/global-shell")
            expect(globalWritten.effective.shell).toBe("/bin/sh")

            const globalGet = (await methods.global.config.get({}, { throwOnError: true })).data!
            expect(globalGet.shell).toBe("/bin/global-shell")
            expect(globalGet.tool_output?.max_lines).toBeUndefined()
            expect((await methods.config.get({}, { throwOnError: true })).data!.shell).toBe("/bin/sh")
            expect((await methods.config.get({}, { throwOnError: true })).data!.hide_prompt_training_models).toBe(true)

            // The native settings RPC is the authority; the adapter exposes no
            // raw file-write bypass.
            const native = await verified.client
              .rpc(SettingsRpc.Definition)
              .read({}, { location: { directory: realProject } })
            expect(native.scopes.map((scope) => scope.scope)).toEqual(["profile", "project"])
          })
        }),
      ),
    )
  } finally {
    await rm(project, { recursive: true, force: true })
    await rm(created, { recursive: true, force: true })
  }
}, 30_000)
