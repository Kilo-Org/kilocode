import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import {
  buildWorktreeMentionFiles,
  buildWorktreeMentionResults,
  useWorktreeMention,
  WORKTREE_MENTION_ENTRIES,
  type WorktreeMention,
} from "../../webview-ui/agent-manager/worktree-mention"
import type { WorktreeReference } from "../../webview-ui/src/hooks/file-mention-utils"
import type { ExtensionMessage, SessionSearchItem, WebviewMessage } from "../../webview-ui/src/types/messages"

const CHAT: SessionSearchItem = { id: "ses_chat", title: "Fix auth bug", updated: 10 }
const WORKTREE: WorktreeReference = {
  id: "wt-other",
  name: "other-worktree",
  branch: "other-branch",
  path: "/repo/.kilo/worktrees/other",
  base: "main",
  sessions: [{ id: "ses_chat", title: "Fix auth bug" }],
  disabled: false,
}

/** Textarea stub whose value and selection mutate like a real prompt box. */
function area(initial: string, cursor = initial.length) {
  const state = { value: initial, start: cursor, end: cursor }
  return {
    get value() {
      return state.value
    },
    set value(value: string) {
      state.value = value
    },
    get selectionStart() {
      return state.start
    },
    get selectionEnd() {
      return state.end
    },
    isConnected: true,
    focus: () => {},
    setSelectionRange: (start: number, end = start) => {
      state.start = start
      state.end = end
    },
  } as unknown as HTMLTextAreaElement
}

function harness(worktrees: WorktreeReference[] = [WORKTREE]) {
  const posted: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const ctx = {
    postMessage: (message: WebviewMessage) => posted.push(message),
    onMessage: (handler: (message: ExtensionMessage) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  const dispose: { fn?: () => void } = {}
  const mention = createRoot((root) => {
    dispose.fn = root
    return useWorktreeMention(ctx, () => worktrees)
  })
  const sessions = (list: SessionSearchItem[]) => {
    for (const handler of handlers) {
      handler({ type: "sessionSearchResult", sessions: list, requestId: "worktree-mention-session-1" })
    }
  }
  return { mention, posted, sessions, dispose }
}

function pick(mention: WorktreeMention, type: string) {
  return mention.mentionResults().find((item) => item.type === type)
}

describe("buildWorktreeMentionResults", () => {
  it("lists only the three worktree-independent entries for a bare @", () => {
    expect(WORKTREE_MENTION_ENTRIES.map((entry) => entry.type)).toEqual(["model", "past-chats", "worktrees"])
    expect(buildWorktreeMentionResults("").map((entry) => entry.type)).toEqual(["model", "past-chats", "worktrees"])
  })

  it("never offers file, folder, terminal or git changes", () => {
    const types = buildWorktreeMentionResults("src").map((entry) => entry.type)
    expect(types).not.toContain("file")
    expect(types).not.toContain("folder")
    expect(types).not.toContain("terminal")
    expect(types).not.toContain("git-changes")
  })

  it("ranks a matching past chat next to the built-in entries", () => {
    const session = { type: "session", value: CHAT.title, session: CHAT } as const
    const results = buildWorktreeMentionResults("Fix", [session])
    expect(results.some((entry) => entry.type === "session")).toBe(true)
  })
})

describe("buildWorktreeMentionFiles", () => {
  it("builds a session: attachment for a mentioned past chat", () => {
    const files = buildWorktreeMentionFiles("@Fix auth bug ", new Map([[CHAT.title, CHAT]]), [])
    expect(files).toHaveLength(1)
    expect(files[0]!.url).toBe("session:ses_chat")
    expect(files[0]!.source?.text.value).toBe("@Fix auth bug")
  })

  it("builds a data: metadata attachment for a mentioned worktree", () => {
    const files = buildWorktreeMentionFiles(`@${WORKTREE.path}`, new Map(), [WORKTREE])
    expect(files).toHaveLength(1)
    expect(files[0]!.url.startsWith("data:text/plain")).toBe(true)
    expect(files[0]!.source?.path).toBe(WORKTREE.path)
  })

  it("produces no attachment for a model reference or unmatched text", () => {
    expect(buildWorktreeMentionFiles("@provider/model", new Map(), [WORKTREE])).toEqual([])
    expect(buildWorktreeMentionFiles("plain prompt", new Map([[CHAT.title, CHAT]]), [WORKTREE])).toEqual([])
  })
})

describe("useWorktreeMention", () => {
  it("opens on a bare @ with the three entries and requests past chats once", () => {
    const { mention, posted, dispose } = harness()
    mention.onInput("@", 1)
    expect(mention.showMention()).toBe(true)
    expect(mention.mentionResults().map((entry) => entry.type)).toEqual(["model", "past-chats", "worktrees"])
    expect(posted.filter((message) => message.type === "requestSessionSearch")).toHaveLength(1)

    mention.onInput("@m", 2)
    expect(posted.filter((message) => message.type === "requestSessionSearch")).toHaveLength(1)
    dispose.fn?.()
  })

  it("inserts a past chat as @title and attaches its session id", () => {
    const { mention, sessions, dispose } = harness()
    const input = area("@Fix", 4)
    mention.onInput("@Fix", 4)
    sessions([CHAT])

    const result = pick(mention, "session")
    expect(result).toBeDefined()
    mention.selectMention(result!, input, () => {})

    expect(input.value).toBe("@Fix auth bug ")
    expect(mention.mentionedSessions().get("Fix auth bug")?.id).toBe("ses_chat")
    expect(mention.highlightTokens().has("Fix auth bug")).toBe(true)
    expect(mention.parseAttachments(input.value).map((file) => file.url)).toEqual(["session:ses_chat"])
    dispose.fn?.()
  })

  it("inserts a worktree path and attaches metadata only", () => {
    const { mention, dispose } = harness()
    const input = area("@", 1)
    mention.onInput("@", 1)
    mention.selectWorktree(WORKTREE, input, () => {})

    expect(input.value).toBe(`@${WORKTREE.path} `)
    expect(mention.highlightTokens().has(WORKTREE.path)).toBe(true)
    const files = mention.parseAttachments(input.value)
    expect(files).toHaveLength(1)
    expect(files[0]!.url.startsWith("data:text/plain")).toBe(true)
    dispose.fn?.()
  })

  it("excludes disabled worktrees from the picker and from selection", () => {
    const stale: WorktreeReference = {
      ...WORKTREE,
      id: "wt-stale",
      name: "stale",
      path: "/repo/.kilo/worktrees/stale",
      disabled: true,
    }
    const { mention, dispose } = harness([WORKTREE, stale])
    mention.onInput("@", 1)
    mention.selectMention(pick(mention, "worktrees")!, area("@", 1), () => {})
    expect(mention.worktreeCandidates().map((worktree) => worktree.id)).toEqual(["wt-other"])

    const input = area("@", 1)
    mention.selectWorktree(stale, input, () => {})
    expect(input.value).toBe("@")
    dispose.fn?.()
  })

  it("inserts a model token as plain text with no attachment", () => {
    const { mention, dispose } = harness()
    const input = area("@", 1)
    mention.onInput("@", 1)
    const model = pick(mention, "model")!
    mention.selectMention(model, input, () => {})
    expect(mention.modelPicker()).toBe(true)

    mention.selectModelReference("provider", "model-x")
    expect(input.value).toBe("@provider/model-x ")
    expect(mention.highlightTokens().has("provider/model-x")).toBe(true)
    expect(mention.parseAttachments(input.value)).toEqual([])
    dispose.fn?.()
  })

  it("closes the menu once prose follows a completed mention", () => {
    const { mention, sessions, dispose } = harness()
    const input = area("@Fix", 4)
    mention.onInput("@Fix", 4)
    sessions([CHAT])
    mention.selectMention(pick(mention, "session")!, input, () => {})

    mention.onInput("@Fix auth bug and then", 21)
    expect(mention.showMention()).toBe(false)
    dispose.fn?.()
  })

  it("closes the past-chat picker when the prompt text changes", () => {
    const { mention, dispose } = harness()
    const input = area("@", 1)
    mention.onInput("@", 1)
    mention.selectMention(pick(mention, "past-chats")!, input, () => {})
    expect(mention.sessionPicker()).toBe(true)

    mention.onInput("@q", 2)
    expect(mention.sessionPicker()).toBe(false)
    dispose.fn?.()
  })

  it("keeps the menu closed after Escape until the query is edited", () => {
    const { mention, dispose } = harness()
    const event = {
      key: "Escape",
      preventDefault: () => {},
      stopPropagation: () => {},
      isComposing: false,
    } as unknown as KeyboardEvent

    mention.onInput("@Fix", 4)
    expect(mention.onKeyDown(event, area("@Fix", 4), () => {})).toBe(true)
    expect(mention.showMention()).toBe(false)
    mention.onInput("@Fix", 4)
    expect(mention.showMention()).toBe(false)
    dispose.fn?.()
  })
})
