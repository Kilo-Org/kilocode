import { describe, expect, it } from "bun:test"
import * as path from "path"
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
    const api = multiClient({
      "/repo": { files: ["src/a.ts"], folders: ["src"] },
      "/other": { files: ["lib/b.ts"], folders: ["lib"] },
    })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-multi" },
      dir: () => "/repo",
      roots: () => [
        { path: "/repo", name: "repo" },
        { path: "/other", name: "other" },
      ],
      open: async () => new Set(),
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    expect(api.calls.map((call) => call.directory)).toEqual(["/repo", "/repo", "/other", "/other"])
    // The session's own project stays relative and stays first; the added
    // folder is absolute so it can be mentioned without being auto-attached.
    expect(posted[0]!.paths).toEqual(["src/a.ts", abs("/other", "lib/b.ts")])
    // Every entry is labelled once the workspace has more than one folder,
    // including the session's own project.
    // Outside entries also carry their path within the owning folder, which is
    // what the webview ranks them on.
    expect(posted[0]!.items).toEqual([
      { path: "src/a.ts", type: "file", root: "repo" },
      { path: abs("/other", "lib/b.ts"), type: "file", root: "other", relative: "lib/b.ts" },
      { path: "src", type: "folder", root: "repo" },
      { path: abs("/other", "lib"), type: "folder", root: "other", relative: "lib" },
    ])
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
    const api = multiClient({
      // None of these is a real match for "CLAUDE.md"; they only match as a
      // scattered subsequence of the full path.
      "/repo": {
        files: ["docs/error-handling/extension-refresh-on-update.md", "docs/features/background-agent-visibility.md"],
        folders: [],
      },
      "/other": { files: ["CLAUDE.md"], folders: [] },
    })
    const posted: Array<Record<string, unknown>> = []

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

    expect((posted[0]!.paths as string[])[0]).toBe(abs("/other", "CLAUDE.md"))
  })

  it("prefers the session's own project when matches are equally good", async () => {
    const api = multiClient({
      "/repo": { files: ["notes.md"], folders: [] },
      "/other": { files: ["notes.md"], folders: [] },
    })
    const posted: Array<Record<string, unknown>> = []

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
    const api = multiClient({
      "/repo": { files: ["src/a.ts"], folders: ["src"] },
      "/other": { files: ["lib/b.ts"], folders: [] },
    })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "", requestId: "request-broken-root" },
      dir: () => "/repo",
      roots: () => roots,
      // A .kilocodeignore that cannot be read propagates out of the ignore
      // controller; it must not empty the whole mention list.
      open: async (dir) => {
        if (dir === "/other") throw new Error("EACCES: permission denied")
        return new Set()
      },
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.paths).toEqual(["src/a.ts"])
    expect(posted[0]!.items).toEqual([
      { path: "src/a.ts", type: "file", root: "repo" },
      { path: "src", type: "folder", root: "repo" },
    ])
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

  it("does not let the filesystem prefix of an added folder count as a match", async () => {
    // "nested" occurs in the added folder's own path but nowhere in the file's
    // relative path. Scoring the absolute form matched every file under that
    // folder on a query that describes none of them.
    const api = multiClient({
      "/repo": { files: ["src/a.ts"], folders: [] },
      "/deep-nested-name": { files: [], folders: [] },
    })
    const posted: Array<Record<string, unknown>> = []

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

    expect(posted[0]!.paths).not.toContain(abs("/deep-nested-name", "src/zzz.ts"))
  })

  it("keeps folders from added roots when the primary root fills the cap", async () => {
    // The primary root alone exceeds the multi-root folder allowance. Slicing
    // before ranking handed it the whole budget and dropped every added folder.
    const api = multiClient({
      "/repo": { files: [], folders: Array.from({ length: 60 }, (_, i) => `pkg-${i}`) },
      "/other": { files: [], folders: ["target"] },
    })
    const posted: Array<Record<string, unknown>> = []

    await handleFileSearch({
      client: api.value as never,
      message: { query: "target", requestId: "request-folder-cap" },
      dir: () => "/repo",
      roots: () => roots,
      open: async () => new Set(),
      post: (message) => posted.push(message as Record<string, unknown>),
    })

    const items = posted[0]!.items as Array<{ path: string; root?: string }>
    expect(items.some((item) => item.path === abs("/other", "target"))).toBe(true)
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
