import { describe, expect, it } from "bun:test"
import { handleFileSearch } from "../../src/kilo-provider/file-search"

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
})
