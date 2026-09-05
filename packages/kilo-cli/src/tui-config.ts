import { Config } from "@opencode-ai/tui/config"
import { Option, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { preflight, type Layout } from "./paths"

type PresentationInfo = Omit<Config.Info, "plugins" | "experimental">

const Presentation = Schema.Struct({
  theme: Config.Info.fields.theme,
  keybinds: Config.Info.fields.keybinds,
  leader: Config.Info.fields.leader,
  scroll: Config.Info.fields.scroll,
  attention: Config.Info.fields.attention,
  diffs: Config.Info.fields.diffs,
  terminal: Config.Info.fields.terminal,
  prompt: Config.Info.fields.prompt,
  session: Config.Info.fields.session,
  tabs: Config.Info.fields.tabs,
  mini: Config.Info.fields.mini,
  debug: Config.Info.fields.debug,
  animations: Config.Info.fields.animations,
  mouse: Config.Info.fields.mouse,
  cursor: Config.Info.fields.cursor,
})
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Presentation))
const decodeValue = Schema.decodeUnknownOption(Presentation)

export function createTuiConfig(input: Layout, defaults: Config.Info): Config.Interface {
  const file = input.tuiConfig
  const hostPlugins = structuredClone(defaults.plugins)
  const baseline = project(defaults)
  let pending = Promise.resolve()

  const read = async () => {
    preflight(input)
    if (!lstatSync(file, { throwIfNoEntry: false })) return withDefaults(baseline, {}, hostPlugins)
    const source = Bun.file(file)
    const text = await source.text().catch((cause) => {
      throw new Error(`Failed to read preview TUI config: ${file}`, { cause })
    })
    const decoded = decode(text)
    if (Option.isNone(decoded)) throw new Error(`Invalid preview TUI config: ${file}`)
    const stored = decoded.value
    return withDefaults(baseline, project(stored), hostPlugins)
  }

  const update: Config.Interface["update"] = (change) => {
    const operation = pending.then(async () => {
      const current = await read()
      const draft = structuredClone(current)
      change(draft)
      const projected = project(draft)
      const decoded = decodeValue(projected)
      if (Option.isNone(decoded)) throw new Error(`Invalid preview TUI config update: ${file}`)
      const next = withDefaults(baseline, decoded.value, hostPlugins)
      if (JSON.stringify(project(current)) !== JSON.stringify(project(next))) await write(project(next))
      return structuredClone(next)
    })
    pending = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  return {
    path: file,
    get: async () => structuredClone(await read()),
    update,
  }

  async function write(value: PresentationInfo) {
    preflight(input)
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })
      preflight(input)
      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}

function project(info: Config.Info): PresentationInfo {
  return {
    theme: info.theme,
    keybinds: info.keybinds,
    leader: info.leader,
    scroll: info.scroll,
    attention: info.attention,
    diffs: info.diffs,
    terminal: info.terminal,
    prompt: info.prompt,
    session: info.session,
    tabs: info.tabs,
    mini: info.mini,
    debug: info.debug,
    animations: info.animations,
    mouse: info.mouse,
    cursor: info.cursor,
  }
}

function withDefaults(
  defaults: PresentationInfo,
  stored: PresentationInfo,
  hostPlugins: Config.Info["plugins"],
): Config.Info {
  return dropUndefined({
    theme: stored.theme === undefined ? defaults.theme : { ...defaults.theme, ...stored.theme },
    keybinds: stored.keybinds === undefined ? defaults.keybinds : { ...defaults.keybinds, ...stored.keybinds },
    leader: stored.leader === undefined ? defaults.leader : { ...defaults.leader, ...stored.leader },
    scroll: stored.scroll === undefined ? defaults.scroll : { ...defaults.scroll, ...stored.scroll },
    attention: stored.attention === undefined ? defaults.attention : { ...defaults.attention, ...stored.attention },
    diffs: stored.diffs === undefined ? defaults.diffs : { ...defaults.diffs, ...stored.diffs },
    terminal: stored.terminal === undefined ? defaults.terminal : { ...defaults.terminal, ...stored.terminal },
    prompt: stored.prompt === undefined ? defaults.prompt : { ...defaults.prompt, ...stored.prompt },
    session: stored.session === undefined ? defaults.session : { ...defaults.session, ...stored.session },
    tabs: stored.tabs === undefined ? defaults.tabs : { ...defaults.tabs, ...stored.tabs },
    mini: stored.mini === undefined ? defaults.mini : { ...defaults.mini, ...stored.mini },
    debug: stored.debug === undefined ? defaults.debug : { ...defaults.debug, ...stored.debug },
    animations: stored.animations ?? defaults.animations,
    mouse: stored.mouse ?? defaults.mouse,
    cursor: stored.cursor === undefined ? defaults.cursor : { ...defaults.cursor, ...stored.cursor },
    plugins: structuredClone(hostPlugins),
  })
}

function dropUndefined<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(dropUndefined) as T
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, dropUndefined(item)]),
  ) as T
}
