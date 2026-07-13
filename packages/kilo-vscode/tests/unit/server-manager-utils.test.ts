import { describe, it, expect } from "bun:test"
import { parseServerPort } from "../../src/services/cli-backend/server-utils"
import {
  resolveServerCwd,
  resolveIndexingEnv,
  resolveManagedServerEnv,
  toErrorMessage,
} from "../../src/services/cli-backend/server-manager"
import {
  copyKiloSandboxWorker,
  copySandboxResources,
  copyTreeSitterResources,
  resolveTreeSitterEnv,
  kiloSandboxWorkerForBinary,
  treeSitterDirForBinary,
  treeSitterDirForExtension,
} from "../../src/services/cli-backend/cli-resources"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

describe("parseServerPort", () => {
  it("parses port from standard CLI startup message", () => {
    expect(parseServerPort("kilo server listening on http://127.0.0.1:12345")).toBe(12345)
  })

  it("parses port from localhost variant", () => {
    expect(parseServerPort("listening on http://localhost:8080")).toBe(8080)
  })

  it("parses port when embedded in longer output", () => {
    const output = "[INFO] 2024-01-01 kilo server listening on http://127.0.0.1:54321\n[INFO] ready"
    expect(parseServerPort(output)).toBe(54321)
  })

  it("returns null for output without listening message", () => {
    expect(parseServerPort("Starting server...")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseServerPort("")).toBeNull()
  })

  it("returns null when no port in URL", () => {
    expect(parseServerPort("listening on http://127.0.0.1")).toBeNull()
  })

  it("parses high port numbers", () => {
    expect(parseServerPort("listening on http://127.0.0.1:65535")).toBe(65535)
  })

  it("parses port 1 (edge case)", () => {
    expect(parseServerPort("listening on http://127.0.0.1:1")).toBe(1)
  })

  it("returns null for stderr-style messages without port", () => {
    expect(parseServerPort("[ERROR] failed to bind port")).toBeNull()
  })

  it("matches only first occurrence when multiple ports present", () => {
    const output = "listening on http://127.0.0.1:3000 and http://127.0.0.1:4000"
    expect(parseServerPort(output)).toBe(3000)
  })
})

describe("cli tree-sitter resources", () => {
  it("resolves resources next to the VS Code bundled CLI", () => {
    const root = "/Users/test/.vscode/extensions/kilocode.kilo-code-7.2.50-darwin-arm64"
    const bin = `${root}/bin/kilo`

    expect(treeSitterDirForBinary(bin)).toBe(`${root}/bin/tree-sitter`)
    expect(treeSitterDirForExtension(root)).toBe(`${root}/bin/tree-sitter`)
    expect(kiloSandboxWorkerForBinary(bin)).toBe(`${root}/bin/kilo-sandbox-mutation-worker.js`)
    expect(resolveTreeSitterEnv(root)).toEqual({ KILO_TREE_SITTER_WASM_DIR: `${root}/bin/tree-sitter` })
  })

  it("resolves resources next to a Windows packaged CLI", () => {
    const root = String.raw`C:\Users\test\.vscode\extensions\kilocode.kilo-code-7.2.50-win32-x64`
    const bin = String.raw`${root}\bin\kilo.exe`

    expect(treeSitterDirForBinary(bin)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(treeSitterDirForExtension(root)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(kiloSandboxWorkerForBinary(bin)).toBe(String.raw`${root}\bin\kilo-sandbox-mutation-worker.js`)
    expect(resolveTreeSitterEnv(root)).toEqual({
      KILO_TREE_SITTER_WASM_DIR: String.raw`${root}\bin\tree-sitter`,
    })
  })

  it("copies the Kilo sandbox worker with the packaged CLI binary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-sandbox-worker-"))
    try {
      const source = path.join(root, "dist", "@kilocode", "cli-darwin-arm64", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(kiloSandboxWorkerForBinary(source), "worker")

      await copyKiloSandboxWorker(source, target)

      expect(await fs.readFile(kiloSandboxWorkerForBinary(target), "utf8")).toBe("worker")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("copies runtime and language WASMs with the packaged CLI binary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-tree-sitter-"))
    try {
      const source = path.join(root, "dist", "@kilocode", "cli-darwin-arm64", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      const dir = treeSitterDirForBinary(source)

      await fs.mkdir(dir, { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(source, "binary")
      await fs.writeFile(target, "binary")
      await fs.writeFile(path.join(dir, "tree-sitter.wasm"), "runtime")
      await fs.writeFile(path.join(dir, "tree-sitter-typescript.wasm"), "language")

      await copyTreeSitterResources(source, target)

      expect(await fs.readFile(path.join(treeSitterDirForBinary(target), "tree-sitter.wasm"), "utf8")).toBe("runtime")
      expect(await fs.readFile(path.join(treeSitterDirForBinary(target), "tree-sitter-typescript.wasm"), "utf8")).toBe(
        "language",
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("copies the Linux sandbox helper and license resources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-sandbox-"))
    try {
      const source = path.join(root, "dist", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      const helper = path.join(path.dirname(source), "bwrap")
      const license = path.join(path.dirname(source), "licenses", "bubblewrap", "COPYING")
      const notice = path.join(path.dirname(license), "NOTICE")
      const relay = path.join(path.dirname(source), "kilo-sandbox-network-relay.js")
      const seccomp = path.join(path.dirname(source), "kilo-sandbox-seccomp")
      const runtimeLicense = path.join(path.dirname(source), "licenses", "sandbox-runtime", "LICENSE")

      await fs.mkdir(path.dirname(license), { recursive: true })
      await fs.mkdir(path.dirname(runtimeLicense), { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(source, "binary")
      await fs.writeFile(target, "binary")
      await fs.writeFile(helper, "helper")
      await fs.writeFile(license, "LGPL")
      await fs.writeFile(notice, "SPDX-License-Identifier: LGPL-2.0-or-later")
      await fs.writeFile(relay, "relay")
      await fs.writeFile(seccomp, "seccomp")
      await fs.writeFile(runtimeLicense, "Apache-2.0")

      await copySandboxResources(source, target)

      const copied = path.join(path.dirname(target), "bwrap")
      expect(await fs.readFile(copied, "utf8")).toBe("helper")
      expect((await fs.stat(copied)).mode & 0o111).not.toBe(0)
      expect(await fs.readFile(path.join(path.dirname(target), "licenses", "bubblewrap", "COPYING"), "utf8")).toBe(
        "LGPL",
      )
      expect(await fs.readFile(path.join(path.dirname(target), "licenses", "bubblewrap", "NOTICE"), "utf8")).toBe(
        "SPDX-License-Identifier: LGPL-2.0-or-later",
      )
      expect(await fs.readFile(path.join(path.dirname(target), "kilo-sandbox-network-relay.js"), "utf8")).toBe("relay")
      const copiedSeccomp = path.join(path.dirname(target), "kilo-sandbox-seccomp")
      expect(await fs.readFile(copiedSeccomp, "utf8")).toBe("seccomp")
      expect((await fs.stat(copiedSeccomp)).mode & 0o111).not.toBe(0)
      expect(await fs.readFile(path.join(path.dirname(target), "licenses", "sandbox-runtime", "LICENSE"), "utf8")).toBe(
        "Apache-2.0",
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("copies seccomp licensing when bundled Bubblewrap is omitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-seccomp-license-"))
    try {
      const source = path.join(root, "dist", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      const relay = path.join(path.dirname(source), "kilo-sandbox-network-relay.js")
      const seccomp = path.join(path.dirname(source), "kilo-sandbox-seccomp")
      const license = path.join(path.dirname(source), "licenses", "sandbox-runtime", "LICENSE")

      await fs.mkdir(path.dirname(license), { recursive: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(source, "binary")
      await fs.writeFile(target, "binary")
      await fs.writeFile(relay, "relay")
      await fs.writeFile(seccomp, "seccomp")
      await fs.writeFile(license, "Apache-2.0")

      await copySandboxResources(source, target)

      expect(await fs.readFile(path.join(path.dirname(target), "kilo-sandbox-network-relay.js"), "utf8")).toBe("relay")
      expect(await fs.readFile(path.join(path.dirname(target), "kilo-sandbox-seccomp"), "utf8")).toBe("seccomp")
      expect(await fs.readFile(path.join(path.dirname(target), "licenses", "sandbox-runtime", "LICENSE"), "utf8")).toBe(
        "Apache-2.0",
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("removes stale sandbox resources when the source has none", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-sandbox-stale-"))
    try {
      const source = path.join(root, "dist", "bin", "kilo")
      const target = path.join(root, "extension", "bin", "kilo")
      const helper = path.join(path.dirname(target), "bwrap")
      const license = path.join(path.dirname(target), "licenses", "bubblewrap", "COPYING")

      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.mkdir(path.dirname(license), { recursive: true })
      await fs.writeFile(source, "binary")
      await fs.writeFile(target, "binary")
      await fs.writeFile(helper, "stale helper")
      await fs.writeFile(license, "stale license")

      await copySandboxResources(source, target)

      expect(
        await fs.stat(helper).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
      expect(
        await fs.stat(path.dirname(license)).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("toErrorMessage", () => {
  it("uses last non-empty stderr line as userMessage when no Error: line", () => {
    const result = toErrorMessage("startup failed", ["line one", "line two", ""])
    expect(result.userMessage).toBe("line two")
  })

  it("extracts message after Error: when present", () => {
    const result = toErrorMessage("startup failed", ["some noise", "Error: something went wrong"])
    expect(result.userMessage).toBe("something went wrong")
  })

  it("strips ANSI codes before matching Error:", () => {
    const ansiError = "\x1b[91m\x1b[1mError: \x1b[0mConfig file at /path/kilo.json is not valid JSON(C):"
    const result = toErrorMessage("startup failed", [ansiError])
    expect(result.userMessage).toBe("Config file at /path/kilo.json is not valid JSON(C):")
  })

  it("finds Error: line anywhere, not just the last line", () => {
    const result = toErrorMessage("startup failed", ["Error: the real problem", "subsequent noise", "more noise"])
    expect(result.userMessage).toBe("the real problem")
  })

  it("falls back to last non-empty line when no Error: match", () => {
    const result = toErrorMessage("startup failed", ["", "just some output", ""])
    expect(result.userMessage).toBe("just some output")
  })

  it("falls back to error arg when stderr is empty", () => {
    const result = toErrorMessage("startup failed", [])
    expect(result.userMessage).toBe("startup failed")
  })

  it("strips ANSI from fallback last non-empty line", () => {
    const result = toErrorMessage("startup failed", ["\x1b[31msome colored output\x1b[0m"])
    expect(result.userMessage).toBe("some colored output")
  })

  it("includes error arg in userDetails", () => {
    const result = toErrorMessage("startup failed", ["some output"])
    expect(result.userDetails).toContain("startup failed")
  })

  it("includes CLI path in userDetails when provided", () => {
    const result = toErrorMessage("startup failed", [], "/usr/local/bin/kilo")
    expect(result.userDetails).toContain("CLI path: /usr/local/bin/kilo")
  })

  it("does not include CLI path in userDetails when not provided", () => {
    const result = toErrorMessage("startup failed", [])
    expect(result.userDetails).not.toContain("CLI path:")
  })

  it("returns original error string as error field", () => {
    const result = toErrorMessage("startup failed", ["some output"])
    expect(result.error).toBe("startup failed")
  })
})

describe("server workspace helpers", () => {
  it("uses first workspace folder as server cwd when present", () => {
    const folders = [{ uri: { fsPath: "/repo" } }]

    expect(resolveServerCwd(folders, "/global-storage")).toBe("/repo")
  })

  it("uses extension storage as server cwd when no workspace folder is open", () => {
    expect(resolveServerCwd(undefined, "/global-storage")).toBe("/global-storage")
    expect(resolveServerCwd([], "/global-storage")).toBe("/global-storage")
  })

  it("disables codebase indexing only when no workspace folder is open", () => {
    expect(resolveIndexingEnv(undefined)).toEqual({ KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" })
    expect(resolveIndexingEnv([])).toEqual({ KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" })
    expect(resolveIndexingEnv([{ uri: { fsPath: "/repo" } }])).toEqual({})
  })

  it("uses the shared database for the managed backend while preserving the environment", () => {
    expect(resolveManagedServerEnv({ PATH: "/usr/bin", KILO_DISABLE_CHANNEL_DB: "false" })).toEqual({
      PATH: "/usr/bin",
      KILO_DISABLE_CHANNEL_DB: "true",
    })
  })
})
