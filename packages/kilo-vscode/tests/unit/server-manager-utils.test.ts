import { describe, it, expect } from "bun:test"
import { parseServerPort } from "../../src/services/cli-backend/server-utils"
import {
  resolveServerCwd,
  resolveIndexingEnv,
  resolveManagedServerEnv,
  toErrorMessage,
} from "../../src/services/cli-backend/server-manager"
import {
  copyTreeSitterResources,
  resolveTreeSitterEnv,
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
    expect(resolveTreeSitterEnv(root)).toEqual({ KILO_TREE_SITTER_WASM_DIR: `${root}/bin/tree-sitter` })
  })

  it("resolves resources next to a Windows packaged CLI", () => {
    const root = String.raw`C:\Users\test\.vscode\extensions\kilocode.kilo-code-7.2.50-win32-x64`
    const bin = String.raw`${root}\bin\kilo.exe`

    expect(treeSitterDirForBinary(bin)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(treeSitterDirForExtension(root)).toBe(String.raw`${root}\bin\tree-sitter`)
    expect(resolveTreeSitterEnv(root)).toEqual({
      KILO_TREE_SITTER_WASM_DIR: String.raw`${root}\bin\tree-sitter`,
    })
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
