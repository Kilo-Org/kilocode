#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { createRequire } from "module" // kilocode_change

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url) // kilocode_change

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"
import { LanceDBRuntime } from "../src/kilocode/lancedb" // kilocode_change

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
// kilocode_change - packages/app was removed; the web UI embed step is no longer applicable

// kilocode_change start - codebase indexing
async function copyTreeSitterWasms(outputDir: string) {
  const runtimeWasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
  const languagePackagePath = require.resolve("tree-sitter-wasms/package.json")
  const languageWasmDir = path.join(path.dirname(languagePackagePath), "out")
  const targetDir = path.join(outputDir, "tree-sitter")

  await fs.promises.mkdir(targetDir, { recursive: true })
  await fs.promises.copyFile(runtimeWasmPath, path.join(targetDir, "tree-sitter.wasm"))

  const languageWasmFiles = (await fs.promises.readdir(languageWasmDir)).filter((file) => file.endsWith(".wasm"))

  await Promise.all(
    languageWasmFiles.map((file) => fs.promises.copyFile(path.join(languageWasmDir, file), path.join(targetDir, file))),
  )

  console.log(`copied ${languageWasmFiles.length + 1} tree-sitter wasm files to ${targetDir}`)
}
// kilocode_change end

// kilocode_change start - embed Kilo Console static assets
async function buildKiloConsole() {
  const app = path.resolve(dir, "../kilo-console")
  const out = path.join(app, "dist")
  console.log("building Kilo Console")
  const proc = Bun.spawn([process.execPath, "run", "build"], {
    cwd: app,
    env: { ...process.env, KILO_CONSOLE_BASE: "/console/" },
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`Kilo Console build failed with exit code ${code}`)
  return out
}

async function copyKiloConsole(input: string, outputDir: string) {
  const target = path.join(outputDir, "console")
  await fs.promises.rm(target, { recursive: true, force: true })
  await fs.promises.cp(input, target, { recursive: true })
  console.log(`copied Kilo Console assets to ${target}`)
}
// kilocode_change end

// kilocode_change start - upstream's createEmbeddedWebUIBundle is intentionally removed because
// Kilo dropped the packages/app web UI. Kept here as a commented reference so future upstream merges
// can see the deliberate divergence rather than treating a re-add as a clean re-introduction.
// const createEmbeddedWebUIBundle = async () => {
//   console.log(`Building Web UI to embed in the binary`)
//   const appDir = path.join(import.meta.dirname, "../../app")
//   const dist = path.join(appDir, "dist")
//   await $`bun run --cwd ${appDir} build`
//   const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
//     .map((file) => file.replaceAll("\\", "/"))
//     .filter((file) => !file.endsWith(".map"))
//     .sort()
//   const imports = files.map((file, i) => {
//     const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
//     return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
//   })
//   const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
//   return [
//     `// Import all files as file_$i with type: "file"`,
//     ...imports,
//     `// Export with original mappings`,
//     `export default {`,
//     ...entries,
//     `}`,
//   ].join("\n")
// }
// kilocode_change end

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

// kilocode_change start - isolate target builds because repeated Bun.build calls can corrupt shared chunks
const arg = process.argv.find((item) => item.startsWith("--target="))
const value = arg?.slice("--target=".length)
const selection = value !== undefined && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : -1
const isolated = selection >= 0 && selection < allTargets.length
if (arg !== undefined && !isolated) throw new Error(`Invalid isolated build target: ${arg}`)
// kilocode_change end

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets
if (isolated) targets.splice(0, targets.length, allTargets[selection]!) // kilocode_change - select one target in child

// kilocode_change start - isolated children reuse the parent's prepared output tree
if (!isolated) await $`rm -rf dist`
const kiloConsoleDist = isolated ? path.resolve(dir, "../kilo-console/dist") : await buildKiloConsole()
// kilocode_change end

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")

  // kilocode_change start - isolate Bun's shared-chunk state between cross-platform targets
  if (!isolated && targets.length > 1) {
    await $`${process.execPath} run script/build.ts --target=${allTargets.indexOf(item)} --skip-install`
    binaries[name] = Script.version
    continue
  }
  // kilocode_change end

  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"
  const sessionExportWorkerPath = "./src/kilocode/session-export/worker.ts" // kilocode_change
  const indexingWorkerPath = "./src/kilocode/indexing-worker.ts" // kilocode_change

  // Use platform-specific bunfs root path based on target OS // kilocode_change
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin], // kilocode_change
    // kilocode_change start - skip sourcemaps for release builds (each .js.map adds ~50 MB per target → ~600 MB total)
    sourcemap: Script.release ? "none" : "external",
    // kilocode_change end
    external: ["node-gyp", ...LanceDBRuntime.external], // kilocode_change
    format: "esm",
    minify: true,
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/kilo`, // kilocode_change
      execArgv: [`--user-agent=kilo/${Script.version}`, "--use-system-ca", "--"], // kilocode_change
      windows: {},
    },
    // kilocode_change start - packages/app was removed; no embedded web UI
    files: {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, sessionExportWorkerPath, indexingWorkerPath],
    // kilocode_change end
    define: {
      KILO_VERSION: `'${Script.version}'`,
      KILO_MIGRATIONS: JSON.stringify(migrations),
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      KILO_WORKER_PATH: workerPath,
      KILO_SESSION_EXPORT_WORKER_PATH: sessionExportWorkerPath, // kilocode_change
      KILO_INDEXING_WORKER_PATH: indexingWorkerPath, // kilocode_change
      KILO_CHANNEL: `'${Script.channel}'`,
      KILO_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      KILO_BUILD_KIND: Script.release ? `'release'` : `'source'`, // kilocode_change
    },
  })

  await copyTreeSitterWasms(path.resolve(dir, `dist/${name}/bin`)) // kilocode_change
  await copyKiloConsole(kiloConsoleDist, path.resolve(dir, `dist/${name}/bin`)) // kilocode_change

  // kilocode_change start - fix Nix-specific ELF interpreter paths for Linux binaries
  if (item.os === "linux") {
    const interpreters: Record<string, string> = {
      x64: "/lib64/ld-linux-x86-64.so.2",
      arm64: "/lib/ld-linux-aarch64.so.1",
      "x64-musl": "/lib/ld-musl-x86_64.so.1",
      "arm64-musl": "/lib/ld-musl-aarch64.so.1",
    }
    const key = item.abi === "musl" ? `${item.arch}-musl` : item.arch
    const interpreter = interpreters[key]
    if (interpreter) {
      try {
        await $`patchelf --set-interpreter ${interpreter} dist/${name}/bin/kilo`
        console.log(`patched interpreter for ${name} -> ${interpreter}`)
      } catch {
        console.warn(`patchelf not available, skipping interpreter fix for ${name}`)
      }
    }
  }
  // kilocode_change end

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/kilo` // kilocode_change
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
        keywords: pkg.keywords, // kilocode_change
        private: pkg.private, // kilocode_change
        // kilocode_change start
        repository: {
          type: "git",
          url: "https://github.com/Kilo-Org/kilocode",
        },
        // kilocode_change end
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (isolated) process.exit(0) // kilocode_change - isolated target children leave archive upload to parent

if (Script.release) {
  const archives: string[] = [] // kilocode_change
  for (const key of Object.keys(binaries)) {
    const archive = key.replace(pkg.name, "kilo") // kilocode_change
    if (key.includes("linux")) {
      const out = path.resolve("dist", `${archive}.tar.gz`) // kilocode_change
      await $`tar -czf ${out} *`.cwd(`dist/${key}/bin`) // kilocode_change
      archives.push(out) // kilocode_change
    } else {
      const out = path.resolve("dist", `${archive}.zip`) // kilocode_change
      await $`zip -r ${out} *`.cwd(`dist/${key}/bin`) // kilocode_change
      archives.push(out) // kilocode_change
    }
  }
  await $`gh release upload v${Script.version} ${archives} --clobber` // kilocode_change
}

export { binaries }
