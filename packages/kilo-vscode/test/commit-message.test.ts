import { describe, expect, test } from "bun:test"
import type { ProgressOptions } from "vscode"
import {
  commitMessageCommand,
  commitMessageLanguage,
  findRepository,
  type CommitMessageHost,
  type Generate,
  type GitRepository,
} from "../src/commit-message"

const SOURCE_CONTROL = 1

function repository(fsPath: string): GitRepository {
  return { inputBox: { value: "" }, rootUri: { fsPath } }
}

// A host with the given repositories and generator; it records errors, progress options and generate inputs.
function setup(input: {
  repositories?: GitRepository[]
  extension?: boolean
  connect?: () => Promise<Generate>
  generate?: Generate
  cancel?: boolean
  timeout?: number
}) {
  const record = {
    errors: [] as string[],
    progress: [] as ProgressOptions[],
    inputs: [] as Parameters<Generate>[0][],
    activated: 0,
  }
  const generate: Generate =
    input.generate ??
    (async (value) => {
      record.inputs.push(value)
      return { message: "feat: add new feature" }
    })
  const host: CommitMessageHost = {
    git: () =>
      input.extension === false
        ? undefined
        : {
            isActive: false,
            activate: async () => {
              record.activated++
            },
            exports: { getAPI: () => ({ repositories: input.repositories ?? [] }) },
          },
    window: {
      showErrorMessage: (message) => record.errors.push(message),
      withProgress: async (options, task) => {
        record.progress.push(options)
        const listeners: (() => void)[] = []
        const result = task(
          { report: () => {} },
          {
            isCancellationRequested: false,
            onCancellationRequested: (listener: () => void) => {
              listeners.push(listener)
              return { dispose: () => {} }
            },
          } as never,
        )
        if (input.cancel) listeners.forEach((listener) => listener())
        return result
      },
    },
    location: SOURCE_CONTROL as never,
    language: () => "de",
    connect: input.connect ?? (async () => generate),
  }
  return { command: commitMessageCommand(host, input.timeout), record }
}

describe("generate commit message command", () => {
  test("shows an error when the git extension is missing", async () => {
    const { command, record } = setup({ extension: false })
    await command()
    expect(record.errors).toEqual(["Git extension not found"])
  })

  test("shows an error when there is no git repository", async () => {
    const { command, record } = setup({ repositories: [] })
    await command()
    expect(record.errors).toEqual(["No Git repository found"])
    expect(record.activated).toBe(1)
  })

  test("shows an error when the Kilo server does not start", async () => {
    const { command, record } = setup({
      repositories: [repository("/repo")],
      connect: () => Promise.reject(new Error("Connect failed")),
    })
    await command()
    expect(record.errors).toEqual(["Failed to connect to Kilo backend. Please try again."])
  })

  test("writes the message into the input box with cancellable source control progress", async () => {
    const repo = repository("/repo")
    const { command, record } = setup({ repositories: [repo] })
    await command()
    expect(repo.inputBox.value).toBe("feat: add new feature")
    expect(record.inputs).toEqual([{ path: "/repo", previousMessage: undefined, language: "de" }])
    expect(record.progress).toEqual([
      { location: SOURCE_CONTROL as never, title: "Generating commit message...", cancellable: true },
    ])
    expect(record.errors).toEqual([])
  })

  test("asks for a different message on the next click for the same repository only", async () => {
    const first = repository("/first")
    const second = repository("/second")
    const { command, record } = setup({ repositories: [first, second] })
    await command({ rootUri: first.rootUri as never })
    await command({ rootUri: first.rootUri as never })
    await command({ rootUri: second.rootUri as never })
    expect(record.inputs.map((input) => input.previousMessage)).toEqual([undefined, "feat: add new feature", undefined])
  })

  test("uses the repository of the clicked source control view", async () => {
    const main = repository("/main-repo")
    const worktree = repository("/worktree-repo")
    const { command, record } = setup({ repositories: [main, worktree] })
    await command({ rootUri: { fsPath: "/worktree-repo" } as never })
    expect(worktree.inputBox.value).toBe("feat: add new feature")
    expect(main.inputBox.value).toBe("")
    expect(record.inputs[0]!.path).toBe("/worktree-repo")
  })

  test("falls back to the first repository when the clicked view has no match", () => {
    const main = repository("/main-repo")
    expect(findRepository([main], { rootUri: { fsPath: "/missing" } as never })).toBe(main)
    expect(findRepository([main, repository("/other")])).toBe(main)
    expect(findRepository([])).toBeUndefined()
  })

  test("shows the server message of a failed generation", async () => {
    const repo = repository("/repo")
    const { command, record } = setup({
      repositories: [repo],
      generate: () =>
        Promise.reject({ type: "no_changes", message: "No changes found to generate a commit message for" }),
    })
    await command()
    expect(record.errors).toEqual(["No changes found to generate a commit message for"])
    expect(repo.inputBox.value).toBe("")
  })

  test("a generation that exceeds the timeout aborts the request and shows the timeout error", async () => {
    const repo = repository("/repo")
    const state: { signal?: AbortSignal } = {}
    const { command, record } = setup({
      repositories: [repo],
      timeout: 5,
      generate: (_input, signal) => {
        state.signal = signal
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
      },
    })
    await command()
    expect(state.signal?.aborted).toBe(true)
    expect(record.errors).toEqual(["Commit message generation timed out. Please try again."])
    expect(repo.inputBox.value).toBe("")
  })

  test("a cancelled generation aborts the request and shows no error", async () => {
    const repo = repository("/repo")
    const state: { signal?: AbortSignal } = {}
    const { command, record } = setup({
      repositories: [repo],
      cancel: true,
      generate: (_input, signal) => {
        state.signal = signal
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
      },
    })
    await command()
    expect(state.signal?.aborted).toBe(true)
    expect(record.errors).toEqual([])
    expect(repo.inputBox.value).toBe("")
  })
})

describe("commit message language", () => {
  test("sync follows the UI language override, then the VS Code display language", () => {
    expect(commitMessageLanguage("sync", "fr", "en-US")).toBe("fr")
    expect(commitMessageLanguage(undefined, "", "de-DE")).toBe("de")
    expect(commitMessageLanguage("sync", undefined, "zh-tw")).toBe("zht")
  })

  test("an explicit language wins over the UI language", () => {
    expect(commitMessageLanguage("ja", "fr", "en-US")).toBe("ja")
  })
})
