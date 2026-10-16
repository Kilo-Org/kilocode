import { describe, expect, it } from "bun:test"
import {
  draft,
  entries,
  inherited,
  matcherKind,
  patch,
  remove,
  save,
  validate,
} from "../../webview-ui/src/components/settings/hooks-config"
import type { HooksConfig } from "../../webview-ui/src/types/messages"

const lint = { type: "command" as const, command: "lint.sh" }
const guard = { type: "command" as const, command: "guard.sh", timeout: 5 }
const hooks: HooksConfig = {
  PreToolUse: [{ matcher: "bash", hooks: [guard, { type: "command", command: "audit.sh" }] }],
  PostToolUse: [{ matcher: "edit|write", hooks: [lint] }],
}

describe("entries", () => {
  it("lists one entry per handler with its group's matcher", () => {
    expect(entries(hooks, "PreToolUse")).toEqual([
      { event: "PreToolUse", group: 0, index: 0, matcher: "bash", handler: guard },
      { event: "PreToolUse", group: 0, index: 1, matcher: "bash", handler: { type: "command", command: "audit.sh" } },
    ])
    expect(entries(undefined, "PostToolUse")).toEqual([])
  })
})

describe("inherited", () => {
  it("keeps effective groups missing from the editable file, ignoring field order", () => {
    const managed = { hooks: [{ type: "command" as const, command: "policy.sh" }] }
    const effective: HooksConfig = {
      PreToolUse: [{ hooks: [{ timeout: 5, command: "guard.sh", type: "command" }], matcher: "bash" }, managed],
    }
    const own: HooksConfig = { PreToolUse: [{ matcher: "bash", hooks: [guard] }] }
    expect(inherited(effective, own)).toEqual({ PreToolUse: [managed] })
    expect(inherited(own, own)).toEqual({})
  })
})

describe("inherited with substitutions", () => {
  it("recognizes own hooks whose {env:} or {file:} tokens the CLI substituted", () => {
    const own: HooksConfig = {
      PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "{env:HOME}/guard.sh", args: undefined }] }],
    }
    const effective: HooksConfig = {
      PreToolUse: [
        { matcher: "bash", hooks: [{ type: "command", command: "/Users/dev/guard.sh" }] },
        { matcher: "bash", hooks: [{ type: "command", command: "/opt/other.sh" }] },
      ],
    }
    expect(inherited(effective, own)).toEqual({
      PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "/opt/other.sh" }] }],
    })
  })
})

describe("matcherKind", () => {
  it("reads matchers the way the CLI does", () => {
    expect(matcherKind(undefined)).toEqual({ kind: "all" })
    expect(matcherKind(" * ")).toEqual({ kind: "all" })
    expect(matcherKind("edit | write,bash")).toEqual({ kind: "names", names: ["edit", "write", "bash"] })
    expect(matcherKind("mcp__github__.*")).toEqual({ kind: "regex" })
    expect(matcherKind("edit(")).toEqual({ kind: "invalid" })
  })
})

describe("validate", () => {
  it("requires a command, a whole timeout in range, and a valid regex", () => {
    const base = draft(undefined, "PreToolUse")
    expect(validate({ ...base, command: "x" })).toEqual({})
    expect(validate(base).command).toBe("settings.agentBehaviour.hooks.command.required")
    expect(validate({ ...base, command: "x", timeout: "1.5" }).timeout).toBeDefined()
    expect(validate({ ...base, command: "x", timeout: "86401" }).timeout).toBeDefined()
    expect(validate({ ...base, command: "x", matcher: "edit(" }).matcher).toBeDefined()
  })
})

describe("save", () => {
  it("appends a new hook as its own group", () => {
    const next = save(hooks, undefined, { ...draft(undefined, "PostToolUse"), command: " fmt.sh ", timeout: "30" })
    expect(next.PostToolUse.at(-1)).toEqual({ hooks: [{ type: "command", command: "fmt.sh", timeout: 30 }] })
    expect(next.PreToolUse).toEqual(hooks.PreToolUse!)
  })

  it("edits a hook in place when the matcher is unchanged", () => {
    const entry = entries(hooks, "PreToolUse")[1]!
    const next = save(hooks, entry, { ...draft(entry, "PreToolUse"), command: "audit2.sh", block: true })
    expect(next.PreToolUse).toEqual([
      { matcher: "bash", hooks: [guard, { type: "command", command: "audit2.sh", onFailure: "block" }] },
    ])
  })

  it("moves a hook out of a shared group when its matcher changes", () => {
    const entry = entries(hooks, "PreToolUse")[0]!
    const next = save(hooks, entry, { ...draft(entry, "PreToolUse"), matcher: "edit" })
    expect(next.PreToolUse).toEqual([
      { matcher: "bash", hooks: [{ type: "command", command: "audit.sh" }] },
      { matcher: "edit", hooks: [guard] },
    ])
  })

  it("changes the matcher of a single-hook group in place and moves hooks across events", () => {
    const entry = entries(hooks, "PostToolUse")[0]!
    expect(save(hooks, entry, { ...draft(entry, "PostToolUse"), matcher: "" }).PostToolUse).toEqual([{ hooks: [lint] }])
    const moved = save(hooks, entry, { ...draft(entry, "PostToolUse"), event: "PreToolUse" })
    expect(moved.PostToolUse).toEqual([])
    expect(moved.PreToolUse.at(-1)).toEqual({ matcher: "edit|write", hooks: [lint] })
  })

  it("keeps exec form and drops onFailure outside PreToolUse", () => {
    const next = save(undefined, undefined, {
      ...draft(undefined, "PostToolUse"),
      command: "node",
      exec: true,
      args: "lint.js\n\n--fix",
      block: true,
    })
    expect(next.PostToolUse).toEqual([{ hooks: [{ type: "command", command: "node", args: ["lint.js", "--fix"] }] }])
  })
})

describe("stale targets", () => {
  it("finds a hook that moved since the editor opened, and adds one that is gone", () => {
    const lintEntry = entries(hooks, "PostToolUse")[0]!
    // The editor opened while an earlier hook was removed; Discard restored it, so positions shifted.
    const restored: HooksConfig = {
      ...hooks,
      PostToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "other.sh" }] }, ...hooks.PostToolUse!],
    }
    const stale = { ...lintEntry, group: 0 }
    const next = save(restored, stale, { ...draft(stale, "PostToolUse"), command: "lint2.sh" })
    expect(next.PostToolUse).toEqual([
      { matcher: "bash", hooks: [{ type: "command", command: "other.sh" }] },
      { matcher: "edit|write", hooks: [{ type: "command", command: "lint2.sh" }] },
    ])
    expect(remove(restored, stale).PostToolUse).toEqual([
      { matcher: "bash", hooks: [{ type: "command", command: "other.sh" }] },
    ])
    expect(remove({}, stale).PostToolUse).toEqual([])
    expect(save({}, stale, draft(stale, "PostToolUse")).PostToolUse).toEqual([{ matcher: "edit|write", hooks: [lint] }])
  })
})

describe("remove and patch", () => {
  it("sends nothing when an edit changes no value, whatever the field order", () => {
    const raw: HooksConfig = { PreToolUse: [{ hooks: [{ command: "guard.sh", type: "command" }], matcher: "bash" }] }
    const entry = entries(raw, "PreToolUse")[0]!
    expect(patch(raw, save(raw, entry, draft(entry, "PreToolUse")))).toEqual({})
  })

  it("drops emptied groups and unsets emptied events with null", () => {
    const next = remove(hooks, entries(hooks, "PostToolUse")[0]!)
    expect(next.PostToolUse).toEqual([])
    expect(patch(hooks, next)).toEqual({ hooks: { PostToolUse: null } })
  })

  it("sends only changed events, as full arrays", () => {
    const next = remove(hooks, entries(hooks, "PreToolUse")[0]!)
    expect(patch(hooks, next)).toEqual({
      hooks: { PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "audit.sh" }] }] },
    })
    expect(
      patch(hooks, save(hooks, undefined, { ...draft(undefined, "PreToolUse"), command: "x" })).hooks,
    ).not.toHaveProperty("PostToolUse")
  })
})
