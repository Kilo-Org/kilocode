import { describe, expect, it } from "bun:test"
import { EVENTS } from "../../../core/src/kilocode/hooks-events"
import { KiloHooks } from "../../../opencode/src/kilocode/hooks/hooks"
import {
  GROUP_LABELS,
  HOOK_EVENTS,
  HOOK_GROUPS,
  HOOK_INFO,
  MATCHER_INFO,
  blocking,
  draft,
  entries,
  inert,
  inherited,
  matcher,
  matcherKind,
  meta,
  notes,
  patch,
  remove,
  save,
  sections,
  skipped,
  timeout,
  unknown,
  validate,
  type HookEntry,
} from "../../webview-ui/src/components/settings/hooks-config"
import { dict } from "../../webview-ui/src/i18n/en"
import type { HookEvent, HookHandler, HooksConfig, Part } from "../../webview-ui/src/types/messages"

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
  it("reads tool matchers the way the CLI does", () => {
    expect(matcherKind(undefined, "PreToolUse")).toEqual({ kind: "all" })
    expect(matcherKind("", "PreToolUse")).toEqual({ kind: "all" })
    expect(matcherKind("*", "PreToolUse")).toEqual({ kind: "all" })
    expect(matcherKind("edit | write,bash", "PreToolUse")).toEqual({ kind: "names", names: ["edit", "write", "bash"] })
    expect(matcherKind("mcp__github__.*", "PreToolUse")).toEqual({ kind: "regex" })
    expect(matcherKind("edit(", "PreToolUse")).toEqual({ kind: "invalid" })
  })

  it('does not trim the matcher: only an empty value and "*" match everything', () => {
    // The CLI compares the raw text: " * " is not "*" but a regular expression (spaces, then a space) that
    // no tool name matches, and "  " is a list of no name.
    expect(matcherKind(" * ", "PreToolUse")).toEqual({ kind: "regex" })
    expect(matcherKind("  ", "PreToolUse")).toEqual({ kind: "names", names: [] })
    expect(matcherKind(" ", "SessionStart")).toEqual({ kind: "names", names: [] })
    // Spaces are not in the strict charset, so this is a regular expression that never matches "rate_limit".
    expect(matcherKind(" rate_limit ", "StopFailure")).toEqual({ kind: "regex" })
  })

  it("agrees with KiloHooks.matches on what matches everything and what matches only the listed names", () => {
    const values = [undefined, "", "*", " * ", " ", "  ", "edit | write,bash", "a|b", " rate_limit ", "|", ","]
    // A value read as a regular expression is skipped: the UI only says it is one.
    for (const event of ["PreToolUse", "StopFailure", "SessionStart"] as const) {
      const strict = HOOK_INFO[event].strict === true
      for (const value of values) {
        const kind = matcherKind(value, event)
        if (kind.kind === "all") expect(KiloHooks.matches(value, ["unlisted"], strict)).toBe(true)
        if (kind.kind !== "names") continue
        expect(KiloHooks.matches(value, ["unlisted"], strict)).toBe(false)
        for (const name of kind.names) expect(KiloHooks.matches(value, [name], strict)).toBe(true)
      }
    }
    expect(KiloHooks.matches(" * ", ["bash", "edit", "*"])).toBe(false)
  })

  it("has no matcher on events without one, whatever the value", () => {
    expect(matcherKind("anything", "Stop")).toEqual({ kind: "none" })
    expect(matcherKind(undefined, "UserPromptSubmit")).toEqual({ kind: "none" })
    expect(matcherKind("edit(", "CwdChanged")).toEqual({ kind: "none" })
  })

  it("reads FileChanged entries as literal file names, dots and all", () => {
    expect(matcherKind(".envrc|.env", "FileChanged")).toEqual({ kind: "files", names: [".envrc", ".env"] })
    expect(matcherKind("package.json", "FileChanged")).toEqual({ kind: "files", names: ["package.json"] })
  })

  it("reads an empty FileChanged matcher as watching nothing itself, not as every file", () => {
    // Claude Code: an omitted matcher adds nothing to the watch list; it runs for paths from watchPaths.
    expect(matcherKind("", "FileChanged")).toEqual({ kind: "dynamic" })
    expect(matcherKind(undefined, "FileChanged")).toEqual({ kind: "dynamic" })
    expect(matcherKind("  ", "FileChanged")).toEqual({ kind: "dynamic" })
    // "*" is a literal file named "*", as in Claude Code.
    expect(matcherKind("*", "FileChanged")).toEqual({ kind: "files", names: ["*"] })
    expect(validate({ ...draft(undefined, "FileChanged"), command: "x" })).toEqual({})
    expect("settings.agentBehaviour.hooks.matcher.filesNone" in dict).toBe(true)
  })

  it("uses the strict exact-match charset on StopFailure", () => {
    expect(matcherKind("rate_limit|overloaded", "StopFailure")).toEqual({
      kind: "names",
      names: ["rate_limit", "overloaded"],
    })
    // A comma or a space is not part of the strict charset, so the value is a regular expression.
    expect(matcherKind("rate_limit, overloaded", "StopFailure")).toEqual({ kind: "regex" })
    expect(matcherKind("startup|resume", "SessionStart")).toEqual({ kind: "names", names: ["startup", "resume"] })
  })
})

describe("unknown", () => {
  it("lists exact names no tool answers to, and nothing for regexes or before tools load", () => {
    const tools = ["bash", "Bash", "edit", "Edit", "MultiEdit"]
    expect(unknown("Bash|LS", tools, "PreToolUse")).toEqual(["LS"])
    expect(unknown("edit, MultiEdit", tools, "PostToolUse")).toEqual([])
    expect(unknown("mcp__github__.*", tools, "PreToolUse")).toEqual([])
    expect(unknown(undefined, tools, "PreToolUse")).toEqual([])
    expect(unknown("LS", undefined, "PreToolUse")).toEqual([])
  })

  it("only checks events whose matcher is a tool name", () => {
    const tools = ["edit", "Edit"]
    expect(unknown("startup|resume", tools, "SessionStart")).toEqual([])
    expect(unknown("permission_prompt", tools, "Notification")).toEqual([])
    expect(unknown("explore", tools, "SubagentStart")).toEqual([])
    expect(unknown("Edti", tools, "PreToolUse")).toEqual(["Edti"])
    expect(unknown("Edti", tools, "PermissionRequest")).toEqual(["Edti"])
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
    // Applying saves the trimmed matcher, so whitespace around it is not an error.
    expect(validate({ ...base, command: "x", matcher: "  edit|write  " })).toEqual({})
    expect(validate({ ...base, command: "x", matcher: " edit( " }).matcher).toBeDefined()
  })

  it("ignores the matcher on events without one", () => {
    expect(validate({ ...draft(undefined, "Stop"), command: "x", matcher: "edit(" })).toEqual({})
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

  it("keeps exec form and drops onFailure on events that do not honor it", () => {
    const next = save(undefined, undefined, {
      ...draft(undefined, "PostToolUse"),
      command: "node",
      exec: true,
      args: "lint.js\n\n--fix",
      block: true,
    })
    expect(next.PostToolUse).toEqual([{ hooks: [{ type: "command", command: "node", args: ["lint.js", "--fix"] }] }])
    for (const event of HOOK_EVENTS.filter((item) => !HOOK_INFO[item].failure)) {
      const saved = save(undefined, undefined, { ...draft(undefined, event), command: "x", block: true })
      expect(saved[event]).toEqual([{ hooks: [{ type: "command", command: "x" }] }])
    }
  })

  it("keeps onFailure on events that honor it", () => {
    for (const event of HOOK_EVENTS.filter((item) => HOOK_INFO[item].failure)) {
      const saved = save(undefined, undefined, { ...draft(undefined, event), command: "x", block: true })
      expect(saved[event]).toEqual([{ hooks: [{ type: "command", command: "x", onFailure: "block" }] }])
    }
  })

  it("saves background hooks with async and without onFailure", () => {
    const next = save(undefined, undefined, {
      ...draft(undefined, "PreCompact"),
      command: "x",
      block: true,
      async: true,
    })
    expect(next.PreCompact).toEqual([{ hooks: [{ type: "command", command: "x", async: true }] }])
    const entry = entries(next, "PreCompact")[0]!
    expect(draft(entry, "PreCompact").async).toBe(true)
    const back = save(next, entry, { ...draft(entry, "PreCompact"), async: false })
    expect(back.PreCompact).toEqual([{ hooks: [{ type: "command", command: "x" }] }])
  })

  it("drops the matcher on events without one", () => {
    const next = save(undefined, undefined, { ...draft(undefined, "Stop"), command: "check.sh", matcher: "anything" })
    expect(next.Stop).toEqual([{ hooks: [{ type: "command", command: "check.sh" }] }])
    // A matcher copied onto an event without matcher support is ignored by the CLI, and dropped on edit.
    const config: HooksConfig = { Stop: [{ matcher: "x", hooks: [{ type: "command", command: "check.sh" }] }] }
    const entry = entries(config, "Stop")[0]!
    expect(save(config, entry, { ...draft(entry, "Stop"), command: "check2.sh" }).Stop).toEqual([
      { hooks: [{ type: "command", command: "check2.sh" }] },
    ])
  })

  it("keeps the matcher of events with a non-tool matcher", () => {
    const next = save(undefined, undefined, {
      ...draft(undefined, "SessionStart"),
      command: "ctx.sh",
      matcher: "startup",
    })
    expect(next.SessionStart).toEqual([{ matcher: "startup", hooks: [{ type: "command", command: "ctx.sh" }] }])
  })

  it("keeps shell, if and async, which the editor does not show, through an edit", () => {
    const extra = { shell: "powershell" as const, if: "Bash(rm *)", async: true }
    const config: HooksConfig = { PreToolUse: [{ matcher: "Bash", hooks: [{ ...guard, ...extra }] }] }
    const entry = entries(config, "PreToolUse")[0]!
    const edited = save(config, entry, { ...draft(entry, "PreToolUse"), command: "guard2.sh" })
    expect(edited.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ ...guard, ...extra, command: "guard2.sh" }] }])
    const moved = save(config, entry, { ...draft(entry, "PreToolUse"), matcher: "Edit" })
    expect(moved.PreToolUse).toEqual([{ matcher: "Edit", hooks: [{ ...guard, ...extra }] }])
    expect(patch(config, edited).hooks?.PreToolUse).toEqual(edited.PreToolUse)
  })

  it("keeps if on an edit within the same event, even where the CLI skips the hook", () => {
    // `if` on a non-tool event makes the CLI skip the hook; dropping it would make the hook run.
    const config: HooksConfig = {
      Stop: [{ hooks: [{ type: "command", command: "notify.sh", if: "Bash(*)" }] }],
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "ctx.sh", if: "Bash(*)" }] }],
    }
    const entry = entries(config, "Stop")[0]!
    expect(patch(config, save(config, entry, draft(entry, "Stop")))).toEqual({})
    const timed = save(config, entry, { ...draft(entry, "Stop"), timeout: "30" })
    expect(timed.Stop).toEqual([{ hooks: [{ type: "command", command: "notify.sh", timeout: 30, if: "Bash(*)" }] }])
    // A matcher change creates a new group in the same event: the hook is still the same hook.
    const start = entries(config, "SessionStart")[0]!
    const rematched = save(config, start, { ...draft(start, "SessionStart"), matcher: "resume" })
    expect(rematched.SessionStart).toEqual([
      { matcher: "resume", hooks: [{ type: "command", command: "ctx.sh", if: "Bash(*)" }] },
    ])
  })

  it("drops if only when the hook moves to another event that cannot use it", () => {
    const config: HooksConfig = { Stop: [{ hooks: [{ type: "command", command: "notify.sh", if: "Bash(*)" }] }] }
    const entry = entries(config, "Stop")[0]!
    const away = save(config, entry, { ...draft(entry, "Stop"), event: "Notification" })
    expect(away.Notification).toEqual([{ hooks: [{ type: "command", command: "notify.sh" }] }])
    const tool = save(config, entry, { ...draft(entry, "Stop"), event: "PostToolUse" })
    expect(tool.PostToolUse).toEqual([{ hooks: [{ type: "command", command: "notify.sh", if: "Bash(*)" }] }])
  })

  it("flags a hook whose if is on an event that does not evaluate it", () => {
    const at = (event: HookEvent, handler: HookHandler) => entries({ [event]: [{ hooks: [handler] }] }, event)[0]!
    const cond = { type: "command" as const, command: "x.sh", if: "Bash(*)" }
    expect(inert(at("Stop", cond))).toBe(true)
    expect(inert(at("UserPromptSubmit", cond))).toBe(true)
    expect(inert(at("PostToolBatch", cond))).toBe(true)
    for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"] as const) {
      expect(inert(at(event, cond))).toBe(false)
    }
    expect(inert(at("Stop", { type: "command", command: "x.sh" }))).toBe(false)
    expect("settings.agentBehaviour.hooks.ifIgnored" in dict).toBe(true)
  })

  it("keeps the original arguments when the args text is left as shown", () => {
    // One argument per line in the editor: a line break inside an argument or an empty argument
    // cannot be told from a separator, so an untouched text must not be re-split.
    const config: HooksConfig = {
      PreToolUse: [
        { matcher: "bash", hooks: [{ type: "command", command: "python3", args: ["-c", "import sys\nprint(1)"] }] },
        { matcher: "edit", hooks: [{ type: "command", command: "tool", args: ["--msg", ""] }] },
      ],
    }
    const code = entries(config, "PreToolUse")[0]!
    const unchanged = save(config, code, draft(code, "PreToolUse"))
    expect(unchanged.PreToolUse[0]?.hooks[0]?.args).toEqual(["-c", "import sys\nprint(1)"])
    expect(patch(config, unchanged)).toEqual({})
    const msg = entries(config, "PreToolUse")[1]!
    const timed = save(config, msg, { ...draft(msg, "PreToolUse"), timeout: "30" })
    expect(timed.PreToolUse[1]?.hooks[0]).toEqual({
      type: "command",
      command: "tool",
      args: ["--msg", ""],
      timeout: 30,
    })
  })

  it("splits the args text again once it is edited", () => {
    const config: HooksConfig = {
      PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "python3", args: ["-c", "a\nb"] }] }],
    }
    const entry = entries(config, "PreToolUse")[0]!
    const edited = save(config, entry, { ...draft(entry, "PreToolUse"), args: "-c\nx\n\ny" })
    expect(edited.PreToolUse[0]?.hooks[0]?.args).toEqual(["-c", "x", "y"])
    // Switching a shell hook to exec form starts from the text as typed.
    const shell: HooksConfig = { Stop: [{ hooks: [{ type: "command", command: "x.sh" }] }] }
    const plain = entries(shell, "Stop")[0]!
    expect(save(shell, plain, { ...draft(plain, "Stop"), exec: true }).Stop[0]?.hooks[0]?.args).toEqual([])
    expect(save(shell, plain, { ...draft(plain, "Stop"), exec: true, args: "a\nb" }).Stop[0]?.hooks[0]?.args).toEqual([
      "a",
      "b",
    ])
  })

  it("keeps shell but drops if when a hook moves to an event that does not evaluate if", () => {
    const config: HooksConfig = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ ...guard, shell: "bash", if: "Bash(rm *)" }] }],
    }
    const entry = entries(config, "PreToolUse")[0]!
    const moved = save(config, entry, { ...draft(entry, "PreToolUse"), event: "Stop" })
    expect(moved.PreToolUse).toEqual([])
    expect(moved.Stop).toEqual([{ hooks: [{ ...guard, shell: "bash" }] }])
    const tool = save(config, entry, { ...draft(entry, "PreToolUse"), event: "PermissionRequest" })
    expect(tool.PermissionRequest).toEqual([
      { matcher: "Bash", hooks: [{ ...guard, shell: "bash", if: "Bash(rm *)" }] },
    ])
  })

  it("keeps an explicit onFailure continue, so an unchanged edit sends nothing", () => {
    const config: HooksConfig = { Stop: [{ hooks: [{ type: "command", command: "x", onFailure: "continue" }] }] }
    const entry = entries(config, "Stop")[0]!
    expect(patch(config, save(config, entry, draft(entry, "Stop")))).toEqual({})
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

describe("lifecycle events", () => {
  it("round-trips hooks on every event through clone, save and patch", () => {
    const config: HooksConfig = Object.fromEntries(
      HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: "command" as const, command: `${event}.sh` }] }]]),
    )
    const entry = entries(config, "GoalReport")[0]!
    const next = save(config, entry, { ...draft(entry, "GoalReport"), command: "goal2.sh" })
    for (const event of HOOK_EVENTS.filter((item) => item !== "GoalReport")) expect(next[event]).toEqual(config[event]!)
    expect(patch(config, next)).toEqual({
      hooks: { GoalReport: [{ hooks: [{ type: "command", command: "goal2.sh" }] }] },
    })
    expect(patch(config, remove(config, entries(config, "CommitMessage")[0]!))).toEqual({
      hooks: { CommitMessage: null },
    })
  })

  it("lists only events that have hooks, grouped in order", () => {
    const config: HooksConfig = {
      GoalReport: [{ hooks: [lint] }],
      Stop: [{ hooks: [lint] }],
      PreToolUse: [{ hooks: [lint] }],
      SessionStart: [{ matcher: "startup", hooks: [lint] }],
      SubagentStop: [],
    }
    expect(sections(config)).toEqual([
      { group: "tools", events: ["PreToolUse"] },
      { group: "session", events: ["SessionStart"] },
      { group: "loop", events: ["Stop"] },
      { group: "kilo", events: ["GoalReport"] },
    ])
    expect(sections(undefined)).toEqual([])
  })

  it("finds managed hooks on new events", () => {
    const managed = { hooks: [{ type: "command" as const, command: "/opt/audit.sh" }] }
    expect(inherited({ Stop: [managed], Notification: [managed] }, { Stop: [] })).toEqual({
      Stop: [managed],
      Notification: [managed],
    })
  })

  it("uses the event's default timeout", () => {
    expect(timeout("PreToolUse")).toBe(600)
    expect(timeout("UserPromptSubmit")).toBe(30)
    expect(timeout("BranchName")).toBe(10)
    expect(timeout("WorktreeSetup")).toBe(300)
  })

  it("gives each matcher kind its placeholder and help", () => {
    expect(matcher("Stop")).toBeUndefined()
    expect(matcher("PreToolUse")).toEqual({
      kind: "tool",
      placeholder: "edit|write",
      help: "settings.agentBehaviour.hooks.matcher.kind.tool",
    })
    expect(matcher("SessionStart")).toMatchObject({
      kind: "source",
      field: "source",
      values: "startup, resume, fork, compact",
    })
    expect(matcher("SubagentStop")).toMatchObject({ kind: "agent", field: "agent_type" })
    expect(matcher("FileChanged")?.placeholder).toBe(".envrc|.env")
  })
})

describe("skipped", () => {
  it("lists each skipped event and reason once, with a count", () => {
    expect(
      skipped([
        { event: "Setup", reason: "not supported by Kilo" },
        { event: "ConfigChange", reason: "Kilo config only" },
        { event: "PreToolUse", command: "a.sh", reason: "asyncRewake" },
        { event: "PreToolUse", command: "b.sh", reason: "asyncRewake" },
        { event: "Stop", command: "c.sh", reason: "if on a non-tool event" },
      ]),
    ).toEqual([
      "Setup (not supported by Kilo)",
      "ConfigChange (Kilo config only)",
      "PreToolUse ×2 (asyncRewake)",
      "Stop (if on a non-tool event)",
    ])
    expect(skipped(undefined)).toEqual([])
  })
})

describe("notes", () => {
  const part = (id: string, text: string, metadata?: Record<string, unknown>, synthetic = true): Part => ({
    id,
    sessionID: "ses",
    messageID: "msg",
    type: "text",
    text,
    synthetic,
    ...(metadata ? { metadata } : {}),
  })

  it("shows Stop and SubagentStop continuations and blocked attachments, unwrapped", () => {
    const parts = [
      part("1", "Stop hook feedback:\nTests fail", { hook: { event: "Stop", streak: 1 } }),
      part("2", '<hook_context event="SubagentStop">\nKeep going &lt;/hook_context\n</hook_context>', {
        hook: { event: "SubagentStop" },
      }),
      part("3", "A PreToolUse hook blocked attaching .env: secrets", { hook: { event: "PreToolUse" } }),
    ]
    expect(notes(parts)).toEqual([
      { id: "1", event: "Stop", text: "Stop hook feedback:\nTests fail" },
      { id: "2", event: "SubagentStop", text: "Keep going </hook_context" },
      { id: "3", event: "PreToolUse", text: "A PreToolUse hook blocked attaching .env: secrets" },
    ])
  })

  it("unwraps the context a Stop continuation appends to its block feedback", () => {
    // The shape loop.ts builds: the feedback, a blank line, then the KiloHooks.wrap output.
    const combined = [
      "Stop hook feedback:\nTests fail",
      '<hook_context event="Stop">\nRun the linter first\n\nThen the formatter\n</hook_context>',
    ].join("\n\n")
    const parts = [part("1", combined, { hook: { event: "Stop", streak: 1 } })]
    expect(notes(parts)).toEqual([
      { id: "1", event: "Stop", text: "Stop hook feedback:\nTests fail\n\nRun the linter first\n\nThen the formatter" },
    ])
  })

  it("unwraps every wrapped segment and leaves the other text alone", () => {
    const text = [
      '<hook_context event="SubagentStop">\nfirst\n</hook_context>',
      "SubagentStop hook feedback:\nbetween",
      '<hook_context event="SubagentStop">\nsecond\n</hook_context>',
    ].join("\n\n")
    expect(notes([part("1", text, { hook: { event: "SubagentStop" } })])).toEqual([
      { id: "1", event: "SubagentStop", text: "first\n\nSubagentStop hook feedback:\nbetween\n\nsecond" },
    ])
  })

  it("restores the escaped closing tag only inside wrapped segments", () => {
    // wrap escapes `</hook_context` in the context, but the block feedback is not escaped.
    const text = [
      "Stop hook feedback:\nkeep &lt;/hook_context and <b>tags</b> as typed",
      '<hook_context event="Stop">\na &lt;/hook_context b <i>x</i> &amp; c\n</hook_context>',
    ].join("\n\n")
    expect(notes([part("1", text, { hook: { event: "Stop" } })])).toEqual([
      {
        id: "1",
        event: "Stop",
        text: "Stop hook feedback:\nkeep &lt;/hook_context and <b>tags</b> as typed\n\na </hook_context b <i>x</i> &amp; c",
      },
    ])
  })

  it("leaves text without a wrapper unchanged, including a tag that is not a whole segment", () => {
    const quoted = 'Stop hook feedback:\nremove <hook_context event="Stop">\nx\n</hook_context> from the prompt'
    const open = 'Stop hook feedback:\n\n<hook_context event="Stop">\nnever closed'
    const parts = [
      part("1", "Stop hook feedback:\nTests fail", { hook: { event: "Stop" } }),
      part("2", quoted, { hook: { event: "Stop" } }),
      part("3", open, { hook: { event: "Stop" } }),
    ]
    expect(notes(parts).map((note) => note.text)).toEqual(["Stop hook feedback:\nTests fail", quoted, open])
  })

  it("keeps PreToolUse attachment context hidden: only the blocked-attachment notice is a note", () => {
    const parts = [
      part("1", '<hook_context event="PreToolUse">\nThis file is generated; do not edit it.\n</hook_context>', {
        hook: { event: "PreToolUse" },
      }),
      part("2", "This file is generated; do not edit it.", { hook: { event: "PreToolUse" } }),
      part("3", "  A PreToolUse hook blocked attaching .env: secrets\n", { hook: { event: "PreToolUse" } }),
    ]
    expect(notes(parts)).toEqual([
      { id: "3", event: "PreToolUse", text: "A PreToolUse hook blocked attaching .env: secrets" },
    ])
  })

  it("keeps every other hook part, wakeups and user text hidden", () => {
    const parts = [
      part("1", "context", { hook: { event: "UserPromptSubmit" } }),
      part("2", "context", { hook: { event: "SessionStart", source: "startup" } }),
      part("3", "context", { hook: { event: "SubagentStart" } }),
      part("4", "context", { hook: { event: "PostModelSwitch" } }),
      part("5", "[scheduled wakeup] check", { wakeup: true }),
      part("6", "typed by the user", { hook: { event: "Stop" } }, false),
    ]
    expect(notes(parts)).toEqual([])
  })
})

describe("blocking", () => {
  const entry = (event: HookEvent, handler: HookHandler): HookEntry => ({ event, group: 0, index: 0, handler })
  const block = { type: "command" as const, command: "guard.sh", onFailure: "block" as const }

  it("is true only where the CLI honors onFailure block", () => {
    expect(blocking(entry("PreToolUse", block))).toBe(true)
    expect(blocking(entry("PreCompact", block))).toBe(true)
  })

  it("is false in the background, on events that ignore it, and without block", () => {
    // An imported Claude Code hook can carry both; the CLI runs it in the background and never blocks.
    expect(blocking(entry("PreToolUse", { ...block, async: true }))).toBe(false)
    expect(blocking(entry("Stop", block))).toBe(false)
    expect(blocking(entry("Notification", block))).toBe(false)
    expect(blocking(entry("PreToolUse", { ...block, onFailure: "continue" }))).toBe(false)
    expect(blocking(entry("PreToolUse", { type: "command", command: "guard.sh" }))).toBe(false)
  })

  it("matches the events whose registry entry allows a failure to block", () => {
    const allowed = HOOK_EVENTS.filter((event) => blocking(entry(event, block)))
    expect(allowed).toEqual(HOOK_EVENTS.filter((event) => EVENTS[event].failure))
  })
})

describe("registry", () => {
  it("matches the CLI event registry", () => {
    expect(HOOK_EVENTS).toEqual(Object.keys(EVENTS) as typeof HOOK_EVENTS)
    for (const event of HOOK_EVENTS) {
      const cli: { matcher?: string; strict?: true } & (typeof EVENTS)[typeof event] = EVENTS[event]
      const info = meta(event)
      expect({ event, group: info.group, matcher: info.matcher, strict: info.strict }).toEqual({
        event,
        group: cli.group,
        matcher: cli.matcher,
        strict: cli.strict,
      })
      expect({ event, failure: info.failure, timeout: info.timeout, kilo: info.kilo }).toEqual({
        event,
        failure: cli.failure,
        timeout: cli.timeout,
        kilo: cli.kilo,
      })
      // A hook's answer matters when the event can block (exit 2, a JSON decision or onFailure) or add context.
      const decides = cli.exit2 === "block" || cli.exit2 === "feedback" || cli.failure || cli.context !== "none"
      expect({ event, decides: info.decides }).toEqual({ event, decides })
    }
    expect(HOOK_GROUPS).toEqual([...new Set(Object.values(EVENTS).map((item) => item.group))])
  })

  it("references only keys that exist in the English dictionary", () => {
    const keys = [
      ...HOOK_EVENTS.map((event) => HOOK_INFO[event].help),
      ...Object.values(GROUP_LABELS),
      ...Object.values(MATCHER_INFO).map((item) => item.help),
    ]
    const missing = keys.filter((key) => !(key in dict))
    expect(missing).toEqual([])
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
