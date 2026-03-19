// kilocode_change - new file
import type { Diagnostic } from "vscode-languageserver-types"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import path from "path"
import fs from "fs/promises"

export namespace TsCheck {
  const log = Log.create({ service: "ts-check" })

  // Match: file(line,col): error TSxxxx: message
  const DIAG_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/

  export async function run(root: string): Promise<Map<string, Diagnostic[]>> {
    const result = new Map<string, Diagnostic[]>()
    const bin = await resolve(root)
    if (!bin) {
      log.info("no typescript checker found", { root })
      return result
    }

    log.info("running ts check", { bin, root })
    const start = Date.now()

    // --incremental writes a .tsbuildinfo cache so subsequent runs only
    // re-check changed files. First run is cold (~1.3s), warm runs
    // reuse the cache and typically finish in ~200-400ms.
    const proc = Bun.spawn([bin, "--noEmit", "--pretty", "false", "--incremental"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })

    const TIMEOUT = 30_000
    const done = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const settled = await Promise.race([
      done.then(([out, err]) => ({ out, err, timedOut: false as const })),
      new Promise<{ out: string; err: string; timedOut: true }>((r) =>
        setTimeout(() => r({ out: "", err: "", timedOut: true }), TIMEOUT),
      ),
    ])
    if (settled.timedOut) {
      log.warn("ts check timed out, killing process", { elapsed: Date.now() - start })
      proc.kill()
    }

    const stdout = settled.out
    const stderr = settled.err

    log.info("ts check done", {
      elapsed: Date.now() - start,
      lines: stdout.split("\n").length,
    })

    if (stderr.trim()) {
      log.info("ts check stderr", { stderr: stderr.slice(0, 500) })
    }

    for (const line of stdout.split("\n")) {
      const m = DIAG_RE.exec(line)
      if (!m) continue
      if (m.length < 7) continue

      const file = m[1]!
      const row = parseInt(m[2]!, 10) - 1
      const col = parseInt(m[3]!, 10) - 1
      const sev = m[4]!
      const abs = path.isAbsolute(file) ? file : path.resolve(root, file)
      const normalized = Filesystem.normalizePath(abs)

      const diag: Diagnostic = {
        range: {
          start: { line: row, character: col },
          end: { line: row, character: col },
        },
        severity: sev === "error" ? 1 : 2,
        message: m[6]!,
        source: "ts",
        code: m[5]!,
      }

      const arr = result.get(normalized) ?? []
      arr.push(diag)
      result.set(normalized, arr)
    }

    return result
  }

  // Resolve the native tsgo binary directly, avoiding the node.js wrapper
  // (node_modules/.bin/tsgo is a #!/usr/bin/env node script that spawns a
  // node process just to execFileSync the native binary — adding ~200MB overhead).
  async function resolve(root: string): Promise<string | undefined> {
    // 1. Try resolving the native tsgo binary from the platform-specific package
    const native = await native_tsgo(root)
    if (native) return native

    // 2. Try workspace-local tsc from node_modules
    const local = await local_tsc(root)
    if (local) return local

    // 3. Try global tsc (fallback)
    const tsc = Bun.which("tsc")
    if (tsc) return tsc

    return undefined
  }

  // Walk up from root looking for a usable tsc binary.
  // On Windows the JS entrypoint has no shebang support, so use the .cmd shim.
  async function local_tsc(root: string): Promise<string | undefined> {
    const shim = process.platform === "win32" ? path.join(".bin", "tsc.cmd") : path.join("typescript", "bin", "tsc")
    let dir = root
    while (true) {
      const bin = path.join(dir, "node_modules", shim)
      if (await exists(bin)) return bin
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return undefined
  }

  // Resolve the native tsgo binary by finding the platform-specific package.
  // The @typescript/native-preview npm package includes platform-specific
  // optional dependencies like @typescript/native-preview-darwin-arm64 that
  // contain the actual native binary at lib/tsgo.
  // Exported for use by the LSP server spawn (tsgo --lsp --stdio).
  export async function native_tsgo(root: string): Promise<string | undefined> {
    const pkg = `@typescript/native-preview-${process.platform}-${process.arch}`

    // Walk up from root looking in node_modules (including .bun hoisted paths)
    let dir = root
    while (true) {
      // Standard node_modules layout
      const standard = path.join(dir, "node_modules", pkg, "lib", "tsgo")
      if (await exists(standard)) return standard

      // Bun hoisted layout: node_modules/.bun/<pkg>@<version>/node_modules/<pkg>/lib/tsgo
      const bun = path.join(dir, "node_modules", ".bun")
      if (await exists(bun)) {
        const match = await scan_bun(bun, pkg)
        if (match) return match
      }

      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }

    return undefined
  }

  // Scan .bun hoisted directory for the platform package
  async function scan_bun(dir: string, pkg: string): Promise<string | undefined> {
    const prefix = pkg.replace("/", "+")
    const entries = await fs.readdir(dir).catch(() => [] as string[])
    for (const entry of entries) {
      if (!entry.startsWith(prefix + "@")) continue
      const bin = path.join(dir, entry, "node_modules", pkg, "lib", "tsgo")
      if (await exists(bin)) return bin
    }
    return undefined
  }

  async function exists(p: string): Promise<boolean> {
    return Filesystem.exists(p)
  }
}
