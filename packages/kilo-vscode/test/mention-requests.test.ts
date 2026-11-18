import { describe, expect, it } from "bun:test"
import { window } from "vscode"
import { createMentionHost, isMentionRequest } from "../src/kilo-provider/mention-requests"
import type { ToHost, ToWebview } from "../src/protocol"

describe("isMentionRequest", () => {
  it("claims the composer's mention requests and nothing else", () => {
    const claimed: ToHost[] = [
      { type: "requestFileSearch", query: "", requestId: "1" },
      { type: "requestSessionSearch", requestId: "2" },
      { type: "requestFilePicker", requestId: "3" },
      { type: "requestTerminalContext", requestId: "4" },
      { type: "requestGitChangesContext", requestId: "5" },
    ]
    expect(claimed.every(isMentionRequest)).toBe(true)
    expect(isMentionRequest({ type: "requestGitChangesStats" })).toBe(false)
    expect(isMentionRequest({ type: "openToolFile", filePath: "a.ts" })).toBe(false)
  })
})

describe("createMentionHost", () => {
  it("answers a cancelled file picker with an empty path", async () => {
    const posted: ToWebview[] = []
    const host = createMentionHost({
      server: { get: () => Promise.reject(new Error("not started")) } as never,
      directory: "/repo",
      post: (message) => posted.push(message),
    })
    const dialog = window as unknown as { showOpenDialog: () => Promise<undefined> }
    const prior = dialog.showOpenDialog
    dialog.showOpenDialog = async () => undefined
    try {
      host.handle({ type: "requestFilePicker", requestId: "picker-1" })
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      dialog.showOpenDialog = prior
    }
    expect(posted).toEqual([{ type: "filePickerResult", requestId: "picker-1", path: "" }])
  })

  it("answers searches with no results when the server cannot start", async () => {
    const posted: ToWebview[] = []
    const host = createMentionHost({
      server: { get: () => Promise.reject(new Error("not started")) } as never,
      directory: "/repo",
      post: (message) => posted.push(message),
    })
    const error = console.error
    console.error = () => {}
    try {
      host.handle({ type: "requestFileSearch", query: "a", requestId: "files-1" })
      host.handle({ type: "requestSessionSearch", requestId: "chats-1" })
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      console.error = error
    }
    expect(posted).toContainEqual({ type: "fileSearchResult", paths: [], items: [], dir: "", requestId: "files-1" })
    expect(posted).toContainEqual({ type: "sessionSearchResult", sessions: [], requestId: "chats-1" })
  })
})
