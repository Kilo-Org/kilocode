import { describe, expect, it } from "bun:test"
import { mcpAuthIssues } from "../../webview-ui/src/components/chat/session-issues"

const strings: Record<string, string> = {
  "prompt.mcp.provider": "{{name}} MCP",
  "prompt.mcp.signIn.busy": "Signing in…",
  "prompt.mcp.openSettings": "Open in Settings",
  "common.signIn": "Sign in",
}

function t(key: string, params?: Record<string, string>): string {
  const value = strings[key] ?? key
  if (!params) return value
  return Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), value)
}

describe("mcpAuthIssues", () => {
  it("returns an empty array when nothing needs auth", () => {
    expect(mcpAuthIssues([], [], t, { signIn: () => {}, openSettings: () => {} })).toEqual([])
  })

  it("builds one issue per server with Sign in and Open in Settings actions", () => {
    const issues = mcpAuthIssues(["anaconda"], [], t, { signIn: () => {}, openSettings: () => {} })
    expect(issues).toHaveLength(1)
    expect(issues[0]!.id).toBe("mcp-auth:anaconda")
    expect(issues[0]!.title).toBe("Anaconda MCP")
    expect(issues[0]!.actions.map((a) => a.title)).toEqual(["Sign in", "Open in Settings"])
    expect(issues[0]!.actions[0]!.enabled).not.toBe(false)
  })

  it("disables sign-in and shows a busy label while a sign-in is in progress", () => {
    const issues = mcpAuthIssues(["anaconda"], ["anaconda"], t, { signIn: () => {}, openSettings: () => {} })
    expect(issues[0]!.actions[0]!.title).toBe("Signing in…")
    expect(issues[0]!.actions[0]!.enabled).toBe(false)
  })

  it("sorts multiple issues by server name", () => {
    const issues = mcpAuthIssues(["zebra", "anaconda"], [], t, { signIn: () => {}, openSettings: () => {} })
    expect(issues.map((i) => i.id)).toEqual(["mcp-auth:anaconda", "mcp-auth:zebra"])
  })

  it("invokes the signIn handler with the server name when the action runs", () => {
    const seen: string[] = []
    const issues = mcpAuthIssues(["anaconda"], [], t, {
      signIn: (name) => seen.push(`signIn:${name}`),
      openSettings: (name) => seen.push(`settings:${name}`),
    })
    issues[0]!.actions[0]!.run()
    issues[0]!.actions[1]!.run()
    expect(seen).toEqual(["signIn:anaconda", "settings:anaconda"])
  })
})
