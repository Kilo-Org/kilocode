import path from "path"
import z from "zod"
import { Effect, Layer, Schema } from "effect"
import { applyEdits, modify } from "jsonc-parser"
import { mergeDeep } from "remeda"
import { Global } from "@opencode-ai/core/global"
import { ConfigParse } from "@/config/parse"
import { CurrentWorkingDirectory } from "@/config/tui-cwd"
import { TuiConfig } from "@/config/tui"
import { KilocodeKeybinds } from "./keybinds"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { GlobalBus } from "@/bus/global"
import { Event } from "@/server/event"

export namespace KilocodeTuiConfig {
  export const Scope = z.enum(["project", "global"])
  export type Scope = z.infer<typeof Scope>

  export const Patch = TuiConfig.Info
  export type Patch = Schema.Schema.Type<typeof Patch>
  export type Editable = Omit<Patch, "keybinds"> & { keybinds?: Record<string, string> }

  const files = ["tui.jsonc", "tui.json"] as const
  const dirs = [".kilo", ".kilocode"] as const

  export async function get(input: { directory: string }) {
    const cfg = await Effect.runPromise(
      TuiConfig.Service.use((svc) => svc.info()).pipe(
        Effect.provide(
          TuiConfig.defaultLayer.pipe(Layer.provide(Layer.succeed(CurrentWorkingDirectory, input.directory))),
        ),
      ),
    )
    return writable(cfg)
  }

  export async function update(input: { directory: string; worktree?: string; scope: Scope; patch: Patch }) {
    const file = await target(input)
    const source = await read(file)
    const before = source ?? "{}"
    const existing = parse(before, file)
    const next = merge(existing, input.patch)
    const output = file.endsWith(".jsonc") ? patchJsonc(before, next) : JSON.stringify(next, null, 2)

    await Filesystem.write(file, output)
    // Notify connected TUIs so they hot-reload keybinds/theme/ui settings. Mirrors
    // Config.updateGlobal; directory "global" routes it to the TUI's global event handler.
    GlobalBus.emit("event", {
      directory: "global",
      payload: { type: Event.ConfigUpdated.type, properties: {} },
    })
    return get({ directory: input.directory })
  }

  async function target(input: { directory: string; worktree?: string; scope: Scope }) {
    if (input.scope === "global") return globalTarget()
    return projectTarget(input)
  }

  async function globalTarget() {
    for (const name of files) {
      const file = path.join(Global.Path.config, name)
      if (await Bun.file(file).exists()) return file
    }
    return path.join(Global.Path.config, "tui.jsonc")
  }

  async function projectTarget(input: { directory: string; worktree?: string }) {
    const found = await Filesystem.findUp([...dirs], input.directory, input.worktree)
    for (const dir of found) {
      for (const name of files) {
        const file = path.join(dir, name)
        if (await Bun.file(file).exists()) return file
      }
    }

    const roots = await Filesystem.findUp([...files], input.directory, input.worktree)
    if (roots[0]) return roots[0]
    return path.join(input.directory, ".kilo", "tui.json")
  }

  async function read(file: string) {
    const target = Bun.file(file)
    if (!(await target.exists())) return undefined
    return target.text()
  }

  function parse(input: string, file: string): Patch {
    const data = ConfigParse.jsonc(input, file)
    if (!isRecord(data)) return {}
    return writable(ConfigParse.schema(TuiConfig.Info, normalize(data), file))
  }

  function normalize(raw: Record<string, unknown>) {
    const data = { ...raw }
    if (!isRecord(data.tui)) {
      delete data.tui
      return data
    }

    const tui = data.tui
    delete data.tui
    return {
      ...tui,
      ...data,
    }
  }

  function merge(base: Patch, patch: Patch): Patch {
    return writable(mergeDeep(base, patch), false)
  }

  function writable(config: Patch | TuiConfig.Info, defaults = true): Editable {
    const result = { ...config } as Record<string, unknown>
    delete result.plugin_origins
    delete result.instruction_origins
    delete result.skill_path_origins
    delete result.permission_origins
    const keybinds: Record<string, string> = defaults
      ? Object.fromEntries(KilocodeKeybinds.list().map((item) => [item.id, item.default]))
      : {}
    for (const [key, value] of Object.entries(config.keybinds ?? {})) {
      if (typeof value === "string") keybinds[key] = value
      if (value === false) keybinds[key] = "none"
    }
    if (defaults || config.keybinds) result.keybinds = keybinds
    else delete result.keybinds

    for (const key of Object.keys(result)) {
      if (result[key] === undefined) delete result[key]
    }

    return result as Editable
  }

  function patchJsonc(input: string, patch: Patch) {
    return Object.entries(patch).reduce((out, [key, value]) => {
      const edits = modify(out, [key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      return applyEdits(out, edits)
    }, input)
  }
}
