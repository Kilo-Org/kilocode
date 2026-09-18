import { afterEach, describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { Project } from "ts-morph"
import type { Host } from "../../src/agent-manager/host"
import { repoName, validateCloneUrl } from "../../src/agent-manager/project/clone"
import { samePath } from "../../src/agent-manager/project/paths"

// Compile the actual adapter methods without loading its unrelated panel/provider imports.
const source = new Project().addSourceFileAtPath(path.join(import.meta.dir, "../../src/agent-manager/vscode-host.ts"))
const methods = [
  "pickFolder",
  "input",
  "confirm",
  "git",
  "multiProject",
  "existingCheckout",
  "directory",
  "cloneRepository",
].map((name) => source.getClassOrThrow("VscodeHost").getMethodOrThrow(name).getText())
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`class Native { ${methods.join("\n")} }`)
const adapter = new Function(
  "vscode",
  "fs",
  "path",
  "samePath",
  "validateCloneUrl",
  "repoName",
  `${code}; return new Native()`,
)
const folders: string[] = []
afterEach(async () => {
  for (const dir of folders.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-clone-"))
  folders.push(dir)
  const parent = await fs.realpath(dir)
  const repo = path.join(parent, "checkout")
  expect(Bun.spawnSync(["git", "init", repo]).exitCode).toBe(0)
  const calls: unknown[][] = []
  const state = {
    result: repo as unknown,
    enabled: true,
    commands: ["git.clone"],
    accept: false,
    fail: false,
    onFail: undefined as (() => void) | undefined,
    prompt: undefined as unknown,
    dialog: undefined as unknown,
    warning: undefined as unknown,
  }
  const git = {
    enabled: true,
    getAPI: () => ({
      openRepository: async (uri: { fsPath: string }) => {
        const result = Bun.spawnSync(["git", "-C", uri.fsPath, "rev-parse", "--show-toplevel"])
        return result.exitCode === 0 ? { rootUri: { fsPath: result.stdout.toString().trim() } } : null
      },
    }),
  }
  const extension = {
    isActive: false,
    exports: git,
    activate: async () => {
      extension.isActive = true
      return git
    },
  }
  const vscode = {
    version: "1.138.0",
    l10n: {
      t: (message: string, ...args: string[]) => message.replace(/\{(\d+)\}/g, (_, i) => args.at(Number(i)) ?? ""),
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    extensions: { getExtension: () => extension as typeof extension | undefined },
    workspace: { isTrusted: true, getConfiguration: () => ({ get: () => state.enabled }) },
    commands: {
      getCommands: async () => state.commands,
      executeCommand: async (...args: unknown[]) => {
        calls.push(args)
        if (state.fail) {
          state.onFail?.()
          throw new Error("Native clone failed")
        }
        return state.result
      },
    },
    window: {
      showOpenDialog: async (opts: unknown) => {
        state.dialog = opts
        return [{ fsPath: parent }]
      },
      showInputBox: async (opts: unknown) => {
        state.prompt = opts
        return undefined
      },
      showWarningMessage: async (message: string, opts: unknown, action: string) => {
        state.warning = { message, opts, action }
        return state.accept ? action : undefined
      },
    },
  }
  const host = adapter(vscode, fs, path, samePath, validateCloneUrl, repoName) as Pick<
    Host,
    "pickFolder" | "input" | "confirm" | "cloneRepository"
  >
  return { host, state, vscode, extension, git, parent, repo, calls }
}

describe("clone URL validation", () => {
  it.each(["ssh://-host/repo", "ssh://git@-host/repo", "git://-host/repo", "https://-host/repo"])(
    "rejects option-like hosts: %s",
    (url) => {
      expect(validateCloneUrl(url)).toBeDefined()
    },
  )
  it.each([
    "https://code.example/team/repo.git",
    "ssh://git@work-alias:2222/~/repo.git",
    "git://code.example/repo.git",
    "git@work-alias:team/repo.git",
    "work-alias:~/repo.git",
    "git@[2001:db8::1]:repo.git",
  ])("accepts provider-neutral URL %s", (value) => expect(validateCloneUrl(value)).toBeUndefined())

  it("rejects unsafe inputs without reflecting them in validation errors", () => {
    for (const value of [
      "",
      "--upload-pack=bad",
      "\nhttps://host/repo",
      "https://host/repo\u0000",
      "ext::bad",
      "https://user:secret@host/repo",
      "https://secret@host/repo",
      "ssh://user:secret@host/repo",
      "https://host/repo?token=secret",
      "/tmp/repo",
      "../repo",
      "C:\\repo",
      "file:///tmp/repo",
      "ftp://host/repo",
      "host",
      "user:secret@host:repo",
    ]) {
      const error = validateCloneUrl(value)
      expect(error).toBeString()
      expect(error).not.toContain("secret")
    }
  })
})

describe("clone destination name", () => {
  it.each([
    ["https://code.example/team/repo.git", "repo"],
    ["git@work-alias:~/repo.git", "repo"],
    ["ssh://git@host:2222/~/my-service.git", "my-service"],
    ["https://host/org/repo", "repo"],
    ["git@host:repo.git", "repo"],
    ["https://code.example/team/repo.git/", "repo"],
  ])("derives %s into %s", (url, name) => expect(repoName(url)).toBe(name))
})

describe("native clone adapter", () => {
  it("explains a missing clone parent without leaking a filesystem error", async () => {
    const { host, parent, calls } = await setup()
    await expect(host.cloneRepository("alias:repo", path.join(parent, "missing"))).rejects.toThrow(
      "Select a parent folder",
    )
    expect(calls).toEqual([])
  })
  it.each(["https://code.example/repo.git", "git@work-alias:~/repo.git", "ssh://git@work-alias/repo.git"])(
    "passes raw URL and both workspace-safe options: %s",
    async (url) => {
      const { host, parent, repo, calls, extension } = await setup()
      expect(await host.cloneRepository(url, parent)).toBe(repo)
      expect(extension.isActive).toBe(true)
      expect(calls).toEqual([["git.clone", url, parent, { postCloneAction: "none", returnRepositoryPath: true }]])
    },
  )

  it("gates old/unknown versions, disabled Git, missing commands, and workspace trust before execution", async () => {
    const { host, vscode, state, calls, extension, git, parent } = await setup()
    for (const version of ["1.105.1", "1.109.1", "unknown"]) {
      vscode.version = version
      await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("Update VS Code")
    }
    vscode.version = "1.111.0"
    state.enabled = false
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("Enable the built-in Git")
    state.enabled = true
    git.enabled = false
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("unavailable")
    git.enabled = true
    state.commands = []
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("unavailable")
    vscode.extensions.getExtension = () => undefined
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("Enable the built-in Git")
    vscode.extensions.getExtension = () => extension
    vscode.workspace.isTrusted = false
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("Trust this workspace")
    expect(calls).toEqual([])
  })

  it("opens an existing checkout at the destination instead of cloning again", async () => {
    const { host, state, parent, calls } = await setup()
    const existing = path.join(parent, "repo")
    await fs.mkdir(existing)
    expect(Bun.spawnSync(["git", "init", existing]).exitCode).toBe(0)
    expect(await host.cloneRepository("alias:repo", parent)).toBeUndefined()
    expect(calls).toEqual([])
    state.accept = true
    expect(await host.cloneRepository("alias:repo", parent)).toBe(existing)
    expect(calls).toEqual([])
  })

  it("attaches a repository whose checkout failed after cloning", async () => {
    const { host, state, parent } = await setup()
    const recovered = path.join(parent, "repo")
    state.fail = true
    state.onFail = () => {
      Bun.spawnSync(["git", "init", recovered])
    }
    state.accept = true
    expect(await host.cloneRepository("alias:repo", parent)).toBe(recovered)
    expect(state.warning).toMatchObject({
      message: `Checkout failed, but the repository was cloned. Attach ${recovered} anyway?`,
      action: "Attach repository",
    })
  })

  it("requires explicit consent for cached checkouts outside the canonical selected parent", async () => {
    const { host, state, parent, repo } = await setup()
    const selected = path.join(parent, "elsewhere")
    await fs.mkdir(selected)
    expect(await host.cloneRepository("alias:repo", selected)).toBeUndefined()
    expect(state.warning).toEqual({
      message: `Git returned an existing checkout outside the selected parent folder: ${repo}`,
      opts: { modal: true },
      action: `Attach existing project at ${repo}`,
    })
    state.accept = true
    expect(await host.cloneRepository("alias:repo", selected)).toBe(repo)
    state.warning = undefined
    const alias = path.join(parent, "alias")
    await fs.symlink(parent, alias, process.platform === "win32" ? "junction" : "dir")
    expect(await host.cloneRepository("alias:repo", alias)).toBe(repo)
    expect(state.warning).toBeUndefined()
  })

  it("does not attach on cancellation, native failure, invalid result, or non-repository", async () => {
    const { host, state, parent, repo } = await setup()
    state.result = undefined
    expect(await host.cloneRepository("alias:repo", parent)).toBeUndefined()
    state.fail = true
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("Native clone failed")
    state.fail = false
    const file = path.join(repo, "repo.code-workspace")
    await fs.writeFile(file, "{}")
    for (const result of [file, "relative", null, { fsPath: repo }]) {
      state.result = result
      await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("repository folder")
    }
    state.result = parent
    await expect(host.cloneRepository("alias:repo", parent)).rejects.toThrow("not a repository")
  })

  it("forwards native picker/input options and treats modal dismissal as cancellation", async () => {
    const { host, state, parent } = await setup()
    expect(await host.pickFolder({ title: "Pick parent", defaultPath: parent })).toBe(parent)
    expect(state.dialog).toMatchObject({
      title: "Pick parent",
      defaultUri: { fsPath: parent },
      canSelectFolders: true,
      canSelectFiles: false,
    })
    const opts = { title: "Repository", value: "alias:repo", prompt: "URL", validate: validateCloneUrl }
    expect(await host.input(opts)).toBeUndefined()
    expect(state.prompt).toEqual({
      title: opts.title,
      value: opts.value,
      prompt: opts.prompt,
      validateInput: opts.validate,
      ignoreFocusOut: true,
    })
    expect(await host.confirm("Initialize?", "Initialize")).toBe(false)
  })
})

// The new project, import, and clone paths attach a project to Agent Manager; they
// must never change the VS Code workspace. A normal click test cannot prove that,
// so guard the source of the onboarding path directly.
describe("onboarding never changes VS Code workspace membership", () => {
  const root = path.join(import.meta.dir, "../../src/agent-manager")
  const forbidden = /\bopenFolder\b|\bupdateWorkspaceFolders\b/

  it("detects the workspace-changing APIs it guards against", () => {
    expect(forbidden.test("vscode.commands.executeCommand('vscode.openFolder', uri, true)")).toBe(true)
    expect(forbidden.test("vscode.workspace.updateWorkspaceFolders(0, 0, { uri })")).toBe(true)
    expect(forbidden.test("use Open local folder to retry")).toBe(false)
  })

  it("keeps clone and its Git availability probe free of workspace changes", () => {
    const klass = new Project().addSourceFileAtPath(path.join(root, "vscode-host.ts")).getClassOrThrow("VscodeHost")
    const body = ["git", "cloneRepository"].map((name) => klass.getMethodOrThrow(name).getText()).join("\n")
    expect(body).toContain("git.clone")
    expect(body).not.toMatch(forbidden)
  })

  it.each(["project/onboarding.ts", "project/prepare.ts", "project/clone.ts", "project/messages.ts"])(
    "keeps %s free of workspace changes",
    (file) => expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(forbidden),
  )
})
