#!/usr/bin/env bun
// kilocode_change - new file

// Workaround for Bun runtime plugin bug (oven-sh/bun#9446) where plugin.onLoad()
// does not fire. The @opentui/solid preload plugin relies on onLoad to transform
// SolidJS JSX via Babel. Since Bun.build() plugins work correctly, this script
// bundles the app first, then runs the output.

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")

process.chdir(dir)

const outdir = path.join(dir, "dist-dev")
const entry = path.join(outdir, "index.js")

console.log("Building with Bun.build()...")
const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  entrypoints: ["./src/index.ts"],
  outdir,
  target: "bun",
  sourcemap: "inline",
})

if (!result.success) {
  console.error("Build failed:")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("Build succeeded, launching...")

const args = process.argv.slice(2)
const child = Bun.spawn(["bun", "run", entry, ...args], {
  cwd: dir,
  stdio: ["inherit", "inherit", "inherit"],
})

const code = await child.exited
process.exit(code ?? 0)
