import { describe, expect, it } from "bun:test"
import * as path from "path"
import * as vscode from "vscode"
import { handleFileSearch, splitRoots } from "../../src/kilo-provider/file-search"

type Query = { query: string; directory: string; type: "file" | "directory"; limit: number }

function client(data: { files: string[]; folders: string[] }) {
  const calls: Query[] = []
  return {
    calls,
    value: {
      find: {
        files: async (query: Query) => {
          calls.push(query)
          return { data: query.type === "file" ? data.files : data.folders }
        },
      },
    },
  }
}

/** Per-directory backend, for asserting fan-out across several roots. */
function multiClient(data: Record<string, { files: string[]; folders: string[] }>) {
  const calls: Query[] = []
  return {
    calls,
    value: {
      find: {
        files: async (query: Query) => {
          calls.push(query)
          const entry = data[query.directory] ?? { files: [], folders: [] }
          return { data: query.type === "file" ? entry.files : entry.folders }
        },
      },
    },
  }
}

const abs = (root: string, rel: string) => path.resolve(root, rel).replaceAll("\\", "/")

type Glob = { base: { uri: { fsPath: string } }; pattern: string }

const quote = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Stand in for the editor's own file index, which is what added workspace
 * folders are searched with. Filters on the glob's literal the way VS Code
 * would, and records the calls so a test can assert nothing reached the
 * backend.
 */
function editorIndex(files: Record<string, string[]>, fail?: string) {
  const calls: Array<{ root: string; pattern: string; max?: number }> = []
  const workspace = vscode.workspace as unknown as {
    workspaceFolders: unknown
    findFiles: (include: unknown, exclude?: unknown, max?: number) => Promise<Array<{ fsPath: string }>>
  }
  const priorFolders = workspace.workspaceFolders
  const priorFind = workspace.findFiles
  workspace.workspaceFolders = Object.keys(files).map((root) => ({ uri: { fsPath: root } }))
  workspace.findFiles = async (include, _exclude, max) => {
    const glob = include as Glob
    const root = glob.base.uri.fsPath
    calls.push({ root, pattern: glob.pattern, max })
    if (root === fail) throw new Error("EACCES: permission denied")
    // Emulate VS Code glob semantics closely enough to be useful: `*` spans one
    // path segment, so the pattern has to match within a single segment.
    const body = glob.pattern.replace(/^\*\*\//, "")
    const expr = new RegExp(`^${body.split("*").map(quote).join("[^/]*")}$`, "i")
    return (files[root] ?? [])
      .filter((rel) => rel.split("/").some((segment) => expr.test(segment)))
      .slice(0, max ?? Infinity)
      .map((rel) => ({ fsPath: abs(root, rel) }))
  }
  return {
    calls,
    restore: () => {
      workspace.workspaceFolders = priorFolders
      workspace.findFiles = priorFind
    },
  }
}

describe("handleFileSearch", () => {
  it("posts one fresh response for each request", async () => {
    const api = client({ files: ["src/a.ts"], folders: ["src"] })
    const posted: unknown[] = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-1", sessionID: "session-1" },
      dir: (id) => (id === "session-1" ? "/repo" : ""),
      open: async () => new Set(["src/open.ts"]),
      post: (message) => posted.push(message),
    })

    expect(api.calls).toEqual([
      { query: "", directory: "/repo", type: "file", limit: 50 },
      { query: "", directory: "/repo", type: "directory", limit: 50 },
    ])
    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({
      type: "fileSearchResult",
      requestId: "request-1",
      dir: "/repo",
      paths: ["src/open.ts", "src/a.ts"],
      items: [
        { path: "src/open.ts", type: "opened-file" },
        { path: "src/a.ts", type: "file" },
        { path: "src", type: "folder" },
      ],
    })
  })

  it("returns an empty fresh response when files were deleted", async () => {
    const api = client({ files: [], folders: [] })
    const posted: unknown[] = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-empty" },
      dir: () => "/repo",
      open: async () => new Set(),
      post: (message) => posted.push(message),
    })

    expect(posted).toEqual([
      {
        type: "fileSearchResult",
        requestId: "request-empty",
        dir: "/repo",
        paths: [],
        items: [],
      },
    ])
  })

  it("searches every workspace folder and returns outside roots as labelled absolute paths", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: ["src"] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "ts", requestId: "request-multi" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    // The backend is only ever asked about the session's own directory.
    expect(api.calls.map((call) => call.directory)).toEqual(["/repo", "/repo"])
    expect([...new Set(index.calls.map((call) => call.root))]).toEqual(["/other"])
    // The session's own project stays relative; the added folder is absolute so
    // it can be mentioned without being auto-attached, and carries its path
    // within that folder, which is what the webview ranks it on.
    expect(posted[0]!.paths).toEqual(["src/a.ts", abs("/other", "lib/b.ts")])
    expect(posted[0]!.items).toEqual([
      { path: "src/a.ts", type: "file", root: "repo" },
      { path: abs("/other", "lib/b.ts"), type: "file", root: "other", relative: "lib/b.ts" },
      { path: "src", type: "folder", root: "repo" },
    ])
  })

  it("never asks the backend about a folder the session does not belong to", async () => {
    // Naming a directory on find.files boots a full instance for it, which
    // loads that folder's config and runs the plugins it declares. Adding a
    // folder to the workspace must not do that.
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"], "/third": ["lib/c.ts"] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "lib", requestId: "request-no-backend" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
          { path: "/third", name: "third" },
        ],
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect([...new Set(api.calls.map((call) => call.directory))]).toEqual(["/repo"])
    expect([...new Set(index.calls.map((call) => call.root))]).toEqual(["/other", "/third"])
  })

  it("searches every added folder, however many there are", async () => {
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const extras = Array.from({ length: 8 }, (_, i) => `/extra-${i}`)
    const index = editorIndex({ "/repo": [], ...Object.fromEntries(extras.map((root) => [root, []])) })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "x", requestId: "request-all-roots" },
        dir: () => "/repo",
        roots: () => [{ path: "/repo", name: "repo" }, ...extras.map((p, i) => ({ path: p, name: `extra-${i}` }))],
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect([...new Set(index.calls.map((call) => call.root))]).toEqual(extras)
  })

  it("bounds how many files one added folder can contribute", async () => {
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": [] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "x", requestId: "request-limit" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect(index.calls[0]!.max).toBe(200)
  })

  it("drops glob syntax from the query rather than letting it match as a pattern", async () => {
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["src/note.ts"] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "no*te", requestId: "request-glob" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect(index.calls[0]!.pattern).toBe("**/*note*")
  })

  it("finds a file in an added folder by a subsequence of its name", async () => {
    // The backend matches the session's own project by subsequence, so an added
    // folder asking only for a literal substring would answer a strictly
    // narrower question than the same keystrokes do at home.
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["src/file-mention-utils.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "fmu", requestId: "request-subsequence" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(index.calls.map((call) => call.pattern)).toEqual(["**/*fmu*", "**/*f*m*u*"])
    expect(posted[0]!.paths).toContain(abs("/other", "src/file-mention-utils.ts"))
  })

  it("asks only once when the query is a single character", async () => {
    // The subsequence form of a one-character query is the literal form.
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": [] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "f", requestId: "request-single-char" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect(index.calls.map((call) => call.pattern)).toEqual(["**/*f*"])
  })

  it("returns a file only once when both globs match it", async () => {
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["src/note.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "note", requestId: "request-dedupe" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    const hits = (posted[0]!.paths as string[]).filter((p) => p === abs("/other", "src/note.ts"))
    expect(hits).toHaveLength(1)
  })

  it("drops files an added folder's own ignore rules exclude", async () => {
    // findFiles honours files.exclude, search.exclude and .gitignore, but knows
    // nothing of .kilocodeignore.
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["src/keep.ts", "vendor/skip.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "ts", requestId: "request-ignored" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        allowed: async (_dir, files) => files.filter((file) => !file.includes("/vendor/")),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(posted[0]!.paths).toEqual([abs("/other", "src/keep.ts")])
  })

  it("leaves entries unlabelled when the workspace has a single folder", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-single" },
      dir: () => "/repo",
      roots: () => [{ path: "/repo", name: "repo" }],
      open: async () => new Set(),
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    expect(posted[0]!.items).toEqual([{ path: "src/a.ts", type: "file" }])
  })

  it("ranks an exact filename match in an added folder above fuzzy matches in the session's project", async () => {
    // None of the primary files is a real match for "CLAUDE.md"; they match
    // only as a scattered subsequence of the full path.
    const api = multiClient({
      "/repo": {
        files: ["docs/error-handling/extension-refresh-on-update.md", "docs/features/background-agent-visibility.md"],
        folders: [],
      },
    })
    const index = editorIndex({ "/repo": [], "/other": ["CLAUDE.md"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "CLAUDE.md", requestId: "request-exact" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect((posted[0]!.paths as string[])[0]).toBe(abs("/other", "CLAUDE.md"))
  })

  it("prefers the session's own project when matches are equally good", async () => {
    const api = multiClient({ "/repo": { files: ["notes.md"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["notes.md"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "notes.md", requestId: "request-tie" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/other", name: "other" },
        ],
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(posted[0]!.paths).toEqual(["notes.md", abs("/other", "notes.md")])
  })

  it("does not widen the search when the session runs outside the workspace folders", async () => {
    const api = multiClient({ "/worktree": { files: ["src/a.ts"], folders: [] } })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-worktree" },
      dir: () => "/worktree",
      roots: () => [{ path: "/repo", name: "repo" }],
      open: async () => new Set(),
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    expect(api.calls.map((call) => call.directory)).toEqual(["/worktree", "/worktree"])
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
  })
})

describe("handleFileSearch resilience and ranking basis", () => {
  const roots = [
    { path: "/repo", name: "repo" },
    { path: "/other", name: "other" },
  ]

  it("still returns the session's own files when an added folder cannot be read", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: ["src"] } })
    // An added folder is an arbitrary user-chosen directory; one unreadable
    // folder must not empty the whole mention list.
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] }, "/other")
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "b", requestId: "request-broken-root" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(posted).toHaveLength(1)
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
    expect(posted[0]!.items).toEqual([
      { path: "src/a.ts", type: "file", root: "repo" },
      { path: "src", type: "folder", root: "repo" },
    ])
  })

  it("still returns the session's own files when an added folder's ignore rules cannot be read", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "b", requestId: "request-broken-ignore" },
        dir: () => "/repo",
        roots: () => roots,
        open: async (dir) => {
          if (dir === "/other") throw new Error("EACCES: permission denied")
          return new Set()
        },
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(posted).toHaveLength(1)
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
  })

  it("posts a result even when the workspace folder list throws", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-broken-roots" },
      dir: () => "/repo",
      roots: () => {
        throw new Error("workspace unavailable")
      },
      open: async () => new Set(),
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
  })

  it("does not search added folders for a bare @", async () => {
    // A glob needs something literal to match on, and listing a whole added
    // repo is not what an unqualified @ is asking for.
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "", requestId: "request-bare" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(index.calls).toEqual([])
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
    // The badge still reflects the workspace, so rows do not gain one the
    // moment a character is typed.
    expect(posted[0]!.items).toEqual([{ path: "src/a.ts", type: "file", root: "repo" }])
  })

  it("searches added folders as soon as there is something to search for", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "b", requestId: "request-typed" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect([...new Set(index.calls.map((call) => call.root))]).toEqual(["/other"])
  })

  it("treats a whitespace-only query as a bare @", async () => {
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["lib/b.ts"] })

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "   ", requestId: "request-spaces" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: () => {},
      })
    } finally {
      index.restore()
    }

    expect(index.calls).toEqual([])
  })

  it("does not let the filesystem prefix of an added folder count as a match", async () => {
    // "nested" occurs in the added folder's own path but nowhere in the file's
    // relative path. Scoring the absolute form matched every file under that
    // folder on a query that describes none of them.
    const api = multiClient({ "/repo": { files: ["src/a.ts"], folders: [] } })
    const index = editorIndex({ "/repo": [], "/deep-nested-name": [] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "nested", requestId: "request-prefix" },
        dir: () => "/repo",
        roots: () => [
          { path: "/repo", name: "repo" },
          { path: "/deep-nested-name", name: "deep-nested-name" },
        ],
        open: async (dir) => (dir === "/deep-nested-name" ? new Set(["src/zzz.ts"]) : new Set()),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    expect(posted[0]!.paths).not.toContain(abs("/deep-nested-name", "src/zzz.ts"))
  })

  it("keeps folders from added roots when the primary root fills the cap", async () => {
    // The primary root alone exceeds the multi-root folder allowance. Slicing
    // before ranking handed it the whole budget and dropped every added folder.
    const api = multiClient({
      "/repo": { files: [], folders: Array.from({ length: 60 }, (_, i) => `pkg-${i}`) },
    })
    const index = editorIndex({ "/repo": [], "/other": ["target/file.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "target", requestId: "request-folder-cap" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    const items = posted[0]!.items as Array<{ path: string; root?: string }>
    expect(items.some((item) => item.path === abs("/other", "target"))).toBe(true)
  })

  it("offers a directory from an added folder when the query names it", async () => {
    // findFiles matches on the whole path, so a hit may be owed to a directory
    // name; those directories are offered too, as the backend does.
    const api = multiClient({ "/repo": { files: [], folders: [] } })
    const index = editorIndex({ "/repo": [], "/other": ["src/auth/login.ts"] })
    const posted: Array<Record<string, unknown>> = []

    try {
      await handleFileSearch({
        client: api.value as never,
        message: { query: "auth", requestId: "request-derived-folder" },
        dir: () => "/repo",
        roots: () => roots,
        open: async () => new Set(),
        post: (message) => posted.push(message as Record<string, unknown>),
      })
    } finally {
      index.restore()
    }

    const items = posted[0]!.items as Array<{ path: string; type: string; relative?: string }>
    expect(items).toContainEqual({
      path: abs("/other", "src/auth"),
      type: "folder",
      root: "other",
      relative: "src/auth",
    })
  })
})

describe("splitRoots", () => {
  const roots = [
    { path: "/repo", name: "repo" },
    { path: "/other", name: "other" },
  ]

  it("separates the session's own folder from the rest", () => {
    expect(splitRoots(roots, "/repo")).toEqual({
      primary: { path: "/repo", name: "repo" },
      secondary: [{ path: "/other", name: "other" }],
    })
  })

  it("finds no roots when the directory is not a workspace folder", () => {
    // Worktree and Agent Manager sessions must not inherit unrelated projects.
    expect(splitRoots(roots, "/worktree")).toEqual({ secondary: [] })
  })

  it("finds no roots when there is no directory", () => {
    expect(splitRoots(roots, "")).toEqual({ secondary: [] })
  })
})
