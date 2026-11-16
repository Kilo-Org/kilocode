// The global config part of `import v1 --config`: copies the Kilo v1 global config directory into the kilo2 one. It
// only adds what is missing and never overwrites a kilo2 file, so it is safe to run again. Plugins are left out, also
// the `plugin` and `plugins` lists of the config file: they target the v1 plugin API and their dependencies are
// installed per version.
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { applyEdits, modify } from "jsonc-parser"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const entries = ["AGENTS.md", "skill", "skills", "agent", "agents", "command", "commands", "mode", "modes", "rules"]

/** Copies the v1 config at `from` into `to` and returns the names it copied. */
export function copyConfig(from: string, to: string) {
  if (path.resolve(from) === path.resolve(to)) return []
  const files = KiloConfigFiles.names.map((name) => path.join(to, name))
  // The kilo2 config file is the user's own once it exists, so the v1 file is only copied into an empty directory.
  const config = files.some(existsSync)
    ? []
    : (["kilo.json", "kilo.jsonc"] as const).flatMap((name, index) =>
        existsSync(path.join(from, name)) ? [{ source: name, target: KiloConfigFiles.names[index] }] : [],
      )
  const directories = entries
    .filter((name) => existsSync(path.join(from, name)))
    .map((name) => ({ source: name, target: name }))
  mkdirSync(to, { recursive: true })
  // The config files are written as new regular files, so a symlinked or read-only v1 file is never followed or
  // left read-only, and its plugin lists are removed before the file exists.
  for (const entry of config)
    writeFileSync(path.join(to, entry.target), withoutPlugins(readFileSync(path.join(from, entry.source), "utf8")), {
      mode: 0o600,
      flag: "wx",
    })
  for (const entry of directories)
    cpSync(path.join(from, entry.source), path.join(to, entry.target), {
      recursive: true,
      force: false,
      errorOnExist: false,
    })
  return [...config, ...directories].map((entry) => entry.source)
}

/** The config text without its plugin lists, with its comments and formatting kept. */
function withoutPlugins(text: string) {
  return ["plugin", "plugins"].reduce(
    (current, key) => applyEdits(current, modify(current, [key], undefined, {})),
    text,
  )
}
