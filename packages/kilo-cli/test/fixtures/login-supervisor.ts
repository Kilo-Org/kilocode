import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const supervisor = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
const [log, store, tool, ...args] = process.argv.slice(2)
appendFileSync(log, JSON.stringify([tool, ...args]) + "\\n")
if (tool !== "schtasks") process.exit(0)
const tasks = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {}
const index = args.indexOf("/TN")
const name = index >= 0 ? (args.at(index + 1) ?? "") : ""
if (args.at(0) === "/Create") {
  const tr = args.at(args.indexOf("/TR") + 1) ?? ""
  const quoted = /^"([^"]+)"/.exec(tr)
  tasks[name] = quoted ? quoted[1] : tr
  writeFileSync(store, JSON.stringify(tasks))
  process.exit(0)
}
if (args.at(0) === "/Run") process.exit(Object.hasOwn(tasks, name) ? 0 : 1)
if (args.at(0) === "/Delete") {
  if (!Object.hasOwn(tasks, name)) process.exit(1)
  delete tasks[name]
  writeFileSync(store, JSON.stringify(tasks))
  process.exit(0)
}
if (args.at(0) === "/Query") {
  if (!Object.hasOwn(tasks, name)) {
    process.stderr.write("ERROR: The system cannot find the file specified.\\n")
    process.exit(1)
  }
  if (args.includes("/XML")) {
    const escaped = String(tasks[name]).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    const xml = \`<?xml version="1.0" encoding="UTF-16"?><Task version="1.2"><Actions Context="Author"><Exec><Command>&quot;\${escaped}&quot;</Command><Arguments>serve --service</Arguments></Exec></Actions></Task>\\r\\n\`
    process.stdout.write(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]))
  }
  process.exit(0)
}
`

export async function fakeSupervisor(root: string) {
  const bin = path.join(root, "bin")
  const dir = path.join(root, "supervisor")
  await mkdir(bin, { recursive: true })
  await mkdir(dir, { recursive: true })
  const cfg = path.join(dir, "bunfig.toml")
  const script = path.join(dir, "supervisor.mjs")
  const log = path.join(dir, "calls.jsonl")
  const store = path.join(dir, "tasks.json")
  await writeFile(cfg, "")
  await writeFile(script, supervisor)
  await Promise.all(
    ["launchctl", "systemctl", "schtasks"].map((tool) =>
      process.platform === "win32"
        ? writeFile(
            path.join(bin, `${tool}.cmd`),
            `@echo off\r\n"${process.execPath}" "--config=${cfg}" "${script}" "${log}" "${store}" "${tool}" %*\r\n`,
          )
        : writeFile(
            path.join(bin, tool),
            `#!/bin/sh\nexec "${process.execPath}" "--config=${cfg}" "${script}" "${log}" "${store}" "${tool}" "$@"\n`,
            { mode: 0o755 },
          ),
    ),
  )
  return {
    bin,
    calls: async () => {
      const file = Bun.file(log)
      if (!(await file.exists())) return [] as string[][]
      return (await file.text())
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    },
  }
}

export function prependPath(env: Record<string, string | undefined>, dir: string) {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH"
  const current = env[key]
  const base = Object.fromEntries(Object.entries(env).filter(([name]) => name.toLowerCase() !== "path"))
  return { ...base, [key]: current ? `${dir}${path.delimiter}${current}` : dir }
}
