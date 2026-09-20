// kilocode_change - new file
import type { Diagnostic } from "vscode-languageserver-types"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "../util/filesystem"
import path from "path"
import fs from "fs/promises"

export namespace TsCheck {
  const log = Log.create({ service: "ts-check" })

  // Match: file(line,col): error TSxxxx: message
  const DIAG_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/
  const GLOBAL_RE = /\b(?:error|fatal)\s+TS\d+:/m

  export async function run(root: string, signal?: AbortSignal): Promise<Map<string, Diagnostic[]> | undefined> {
    if (signal?.aborted) {
      log.warn("ts check aborted before resolve", { root })
      return undefined
    }

    const result = new Map<string, Diagnostic[]>()
    const bin = await resolve(root).catch((error) => {
      log.error("failed to resolve typescript checker", { root, error })
      return undefined
    })

    if (signal?.aborted) {
      log.warn("ts check aborted after resolve", { root })
      return undefined
    }

    if (!bin) {
      log.warn("no typescript checker found", { root })
      return undefined
    }

    log.info("running ts check", { bin, root })
    const start = Date.now()

    // --incremental writes a .tsbuildinfo cache so subsequent runs only
    // re-check changed files. First run is cold (~1.3s), warm runs
    // reuse the cache and typically finish in ~200-400ms.
    const proc = (() => {
      try {
        return Bun.spawn([bin, "--noEmit", "--pretty", "false", "--incremental"], {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
          env: { ...process.env },
        })
      } catch (error) {
        log.error("failed to spawn typescript checker", { root, bin, error })
        return undefined
      }
    })()
    if (!proc) return undefined

    const TIMEOUT = 30_000
    const GRACE = 1_000
    let stopped = false
    const stop = () => {
      if (stopped || proc.exitCode != null) return
      stopped = true
      try {
        proc.kill()
      } catch (error) {
        log.error("failed to kill typescript checker", { root, error })
      }
    }
    const done = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    void done.catch((error) => {
      log.error("failed to collect typescript checker output", { root, error })
    })
    const reap = async () => {
      stop()
      const exited = await Promise.race([
        proc.exited.then(() => true).catch(() => true),
        Bun.sleep(GRACE).then(() => false),
      ])
      if (!exited && proc.exitCode == null) {
        try {
          proc.kill(9)
        } catch (error) {
          log.error("failed to force kill typescript checker", { root, error })
        }
      }
      await proc.exited.catch((error) => {
        log.error("failed to reap typescript checker", { root, error })
      })
      await done.catch(() => undefined)
    }

    const timeout = Promise.withResolvers<"timeout">()
    const cancel = Promise.withResolvers<"abort">()
    const abort = () => {
      stop()
      cancel.resolve("abort")
    }
    const timer = setTimeout(() => timeout.resolve("timeout"), TIMEOUT)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()

    const settled = await Promise.race([
      done.then(([out, err, code]) => ({ kind: "done" as const, out, err, code })),
      timeout.promise.then((kind) => ({ kind })),
      cancel.promise.then((kind) => ({ kind })),
    ])
      .catch(async (error) => {
        log.error("ts check failed", { root, error })
        await reap()
        return { kind: "failed" as const }
      })
      .finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
      })

    if (settled.kind === "timeout") {
      log.warn("ts check timed out, killing process", { root, elapsed: Date.now() - start })
      await reap()
      return undefined
    }

    if (settled.kind === "abort") {
      log.warn("ts check aborted, killing process", { root, elapsed: Date.now() - start })
      await reap()
      return undefined
    }

    if (settled.kind === "failed") return undefined

    const stdout = settled.out
    const stderr = settled.err
    const code = settled.code
    const text = `${stdout}\n${stderr}`

    log.info("ts check done", {
      elapsed: Date.now() - start,
      code,
      lines: stdout.split("\n").length,
    })

    if (stderr.trim()) {
      log.info("ts check stderr", { stderr: stderr.slice(0, 500) })
    }

    for (const line of text.split(/\r?\n/)) {
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

    if (result.size === 0 && GLOBAL_RE.test(text)) {
      log.warn("ts check reported a global compiler error", {
        root,
        code,
        stdout: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500),
      })
      return undefined
    }

    if (code !== 0 && result.size === 0) {
      log.warn("ts check failed without file diagnostics", {
        root,
        code,
        stdout: stdout.slice(0, 500),
        stderr: stderr.slice(0, 500),
      })
      return undefined
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
