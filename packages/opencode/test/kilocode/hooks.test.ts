import { describe, expect, test } from "bun:test"
import path from "path"
import { rm, utimes } from "fs/promises"
import { Effect, Fiber, Layer, Stream } from "effect"
import { backendSupport } from "@kilocode/sandbox"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { CLAUDE_KNOWN, EVENTS, IMPORTED } from "@opencode-ai/core/kilocode/hooks-events"
import { Shell } from "@opencode-ai/core/shell"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as SandboxPolicy from "../../src/kilocode/sandbox/policy"
import { SandboxPreference } from "../../src/kilocode/sandbox/preference"
import { KiloHookEvents } from "../../src/kilocode/hooks/events"
import { KiloHookPayload } from "../../src/kilocode/hooks/payload"
import { KiloHooks } from "../../src/kilocode/hooks/hooks"
import { KiloSession } from "../../src/kilocode/session"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// Shell-form hooks run in bash (or the platform shell). Driving them with `bun -e` keeps the tests
// portable: only double-quoted scripts, single-quoted JS strings, no `$`.
const script = (code: string) => `"${process.execPath}" -e "${code}"`
// Exec-form hooks spawn the program directly, so their arguments need no shell quoting at all.
const exec = (code: string): KiloHooks.Handler => ({ type: "command", command: process.execPath, args: ["-e", code] })
// A hook that appends its stdin (one JSON line) to a marker file.
const record = (file: string, extra = ""): KiloHooks.Handler =>
  exec(
    `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(file)}, fs.readFileSync(0, 'utf8') + '\\n'); ${extra}`,
  )
const lines = async (file: string) =>
  (await Bun.file(file).exists())
    ? (await Bun.file(file).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

const call = (tool: string, args: unknown = {}, extra: Partial<KiloHooks.Call> = {}): KiloHooks.Call => ({
  tool,
  args,
  callID: "call_1",
  sessionID: "ses_1",
  directory: process.cwd(),
  ...extra,
})

const hooks = (
  event: KiloHooks.Event,
  command: string | KiloHooks.Handler,
  matcher?: string,
  timeout?: number,
): KiloHooks.Hooks => ({
  [event]: [
    {
      ...(matcher === undefined ? {} : { matcher }),
      hooks: [typeof command === "string" ? { type: "command", command, timeout } : { ...command, timeout }],
    },
  ],
})

const pick = (config: KiloHooks.Hooks, event: KiloHooks.Event, value: KiloHooks.Call) =>
  KiloHooks.select(config, event, KiloHooks.names(value), value)

const outcome = (code: number, stdout: unknown = "", stderr = ""): KiloHooks.Outcome => ({
  code,
  stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
  stderr,
})
const handler: KiloHooks.Handler = { type: "command", command: "hook.sh" }

describe("registry", () => {
  test("defines 30 events and imports the 23 Claude Code events except ConfigChange", () => {
    expect(Object.keys(EVENTS)).toHaveLength(30)
    expect(IMPORTED).toHaveLength(23)
    expect(IMPORTED).not.toContain("ConfigChange")
    expect(IMPORTED.every((event) => !EVENTS[event].kilo)).toBe(true)
  })

  test("lists every Claude Code event, and no Kilo-only name, in CLAUDE_KNOWN", () => {
    expect(CLAUDE_KNOWN).toHaveLength(33)
    const names = Object.entries(EVENTS)
    for (const [name, meta] of names) {
      expect((CLAUDE_KNOWN as readonly string[]).includes(name)).toBe(!meta.kilo)
    }
  })
})

describe("matches", () => {
  test("matches every tool for *, empty or missing matchers", () => {
    expect(KiloHooks.matches(undefined, ["edit"])).toBe(true)
    expect(KiloHooks.matches("", ["edit"])).toBe(true)
    expect(KiloHooks.matches("*", ["edit"])).toBe(true)
  })

  test("treats plain names as an exact list split on | or ,", () => {
    expect(KiloHooks.matches("edit|write", ["write"])).toBe(true)
    expect(KiloHooks.matches("edit, write", ["write"])).toBe(true)
    expect(KiloHooks.matches("edit", ["editor"])).toBe(false)
  })

  test("treats anything else as an unanchored regular expression", () => {
    expect(KiloHooks.matches("^github_.*", ["github_create_issue"])).toBe(true)
    expect(KiloHooks.matches("Ed.t", ["Edit"])).toBe(true)
    expect(KiloHooks.matches("^Write$", ["Edit"])).toBe(false)
  })

  test("never matches an invalid regular expression", () => {
    expect(KiloHooks.matches("edit(", ["edit("])).toBe(false)
  })

  test("reads a hyphen as a regular expression on strict events", () => {
    expect(KiloHooks.matches("rate-limit", ["rate-limit"], true)).toBe(true)
    expect(KiloHooks.matches("rate_limit|overloaded", ["overloaded"], true)).toBe(true)
    expect(KiloHooks.matches("rate, limit", ["rate"], true)).toBe(false)
  })
})

describe("select", () => {
  test("matches Kilo tool ids and their Claude Code names", () => {
    const config: KiloHooks.Hooks = {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "claude-style" }] },
        { matcher: "bash", hooks: [{ type: "command", command: "kilo-style" }] },
      ],
    }
    expect(pick(config, "PreToolUse", call("edit")).map((h) => h.command)).toEqual(["claude-style"])
    expect(pick(config, "PreToolUse", call("apply_patch")).map((h) => h.command)).toEqual(["claude-style"])
    expect(pick(config, "PreToolUse", call("bash")).map((h) => h.command)).toEqual(["kilo-style"])
    expect(pick(config, "PostToolUse", call("edit"))).toEqual([])
  })

  test("matches the older Claude Code tool names existing matchers still use", () => {
    expect(KiloHooks.names(call("edit"))).toEqual(["edit", "Edit", "MultiEdit"])
    expect(KiloHooks.names(call("apply_patch"))).toContain("MultiEdit")
    expect(KiloHooks.names(call("notebook_edit"))).toEqual(["notebook_edit", "NotebookEdit"])
    expect(KiloHooks.input("PreToolUse", call("edit")).tool_name).toBe("Edit")
  })

  test("finds matcher names that no tool answers to", () => {
    const config: KiloHooks.Hooks = {
      PreToolUse: [
        { matcher: "Bash|LS", hooks: [{ type: "command", command: "guard" }] },
        { matcher: "mcp__github__.*", hooks: [{ type: "command", command: "guard" }] },
        { matcher: "MultiEdit, notebook_edit", hooks: [{ type: "command", command: "guard" }] },
      ],
    }
    const names = KiloHooks.known(["bash", "edit", "notebook_edit"])
    expect(names).toEqual(expect.arrayContaining(["Bash", "MultiEdit", "NotebookEdit", "read_mcp_resource"]))
    expect(KiloHooks.unmatched(config, names)).toEqual(["LS"])
  })

  test("only reports unknown names on tool-matcher events", () => {
    const config: KiloHooks.Hooks = {
      SessionStart: [{ matcher: "startup|resume", hooks: [{ type: "command", command: "ctx" }] }],
      Notification: [{ matcher: "permission_prompt", hooks: [{ type: "command", command: "notify" }] }],
      PreToolUse: [{ matcher: "Edti", hooks: [{ type: "command", command: "guard" }] }],
    }
    expect(KiloHooks.unmatched(config, KiloHooks.known(["edit"]))).toEqual(["Edti"])
  })

  test("matches Claude Code's current and legacy subagent tool names", () => {
    expect(KiloHooks.names(call("task"))).toEqual(["task", "Agent", "Task"])
  })

  test("matches Claude Code MCP names passed as call aliases", () => {
    const mcp = call("github_create_issue", {}, { aliases: ["mcp__github__create_issue"] })
    expect(pick(hooks("PreToolUse", "guard", "mcp__github__.*"), "PreToolUse", mcp)).toHaveLength(1)
    expect(KiloHooks.input("PreToolUse", mcp).tool_name).toBe("mcp__github__create_issue")
  })

  test("runs the same command once when several groups match", () => {
    const config: KiloHooks.Hooks = {
      PostToolUse: [
        { matcher: "edit", hooks: [{ type: "command", command: "lint" }] },
        { matcher: "*", hooks: [{ type: "command", command: "lint" }] },
      ],
    }
    expect(pick(config, "PostToolUse", call("edit"))).toHaveLength(1)
  })

  test("ignores the matcher on events without matcher support", () => {
    const config: KiloHooks.Hooks = { Stop: [{ matcher: "nothing-matches-this", hooks: [handler] }] }
    expect(KiloHooks.select(config, "Stop", [])).toHaveLength(1)
  })

  test("skips handlers Kilo cannot run on the event", () => {
    const config: KiloHooks.Hooks = {
      Stop: [
        {
          hooks: [
            { ...handler, if: "Bash(rm *)" },
            { type: "command", command: "kept" },
          ],
        },
      ],
    }
    expect(KiloHooks.select(config, "Stop", []).map((item) => item.command)).toEqual(["kept"])
  })
})

describe("condition", () => {
  const bash = (command: string) => call("bash", { command })

  test("runs a Bash rule for any matching segment of a chained command", () => {
    expect(KiloHooks.condition("Bash(rm *)", bash("cd x && rm -rf y"))).toBe(true)
    expect(KiloHooks.condition("Bash(rm *)", bash("ls"))).toBe(false)
    expect(KiloHooks.condition("Bash(git push:*)", bash("git status; git push origin"))).toBe(true)
  })

  test("runs the hook when it cannot tell", () => {
    expect(KiloHooks.condition("Bash(rm *)", bash("echo $(rm y)"))).toBe(true)
    expect(KiloHooks.condition("Bash(rm *)", bash("echo 'rm y'"))).toBe(true)
    // Shell syntax a plain split would misread runs the hook too: a guard is never skipped while rm runs.
    for (const command of [
      "true & rm -rf y",
      "(rm -rf y)",
      "{ rm -rf y; }",
      "X=1 rm -rf y",
      "rm\t-rf y",
      "ls > out",
      "ls # && rm -rf y",
      "sudo rm -rf y",
      "xargs rm < list",
      "timeout 5 rm -rf y",
      "if true; then rm -rf y; fi",
      "! rm -rf y",
      "rm -rf $DIR",
    ])
      expect(KiloHooks.condition("Bash(rm *)", bash(command))).toBe(true)
    expect(KiloHooks.condition("Bash(rm *)", bash("ls -la && git status | wc -l &"))).toBe(false)
    // Extra spaces and a program given by path are the same command to the shell: the guard still runs.
    expect(KiloHooks.condition("Bash(git push:*)", bash("git  push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(git push:*)", bash("/usr/bin/git push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(rm -rf:*)", bash("rm  -rf build"))).toBe(true)
    // A rule written with extra spaces collapses the same way, so it still matches (and still skips).
    expect(KiloHooks.condition("Bash(git  push:*)", bash("git push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(git  push:*)", bash("git  push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(rm  -rf *)", bash("rm  -rf /"))).toBe(true)
    expect(KiloHooks.condition("Bash(git  push:*)", bash("git status"))).toBe(false)
    // A glob or another letter case can name the same program too (`GIT` runs git on a case-insensitive filesystem).
    expect(KiloHooks.condition("Bash(git push:*)", bash("GIT push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(git push:*)", bash("Git push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(git push:*)", bash("gi* push origin main"))).toBe(true)
    expect(KiloHooks.condition("Bash(rm -rf:*)", bash("RM -rf build"))).toBe(true)
    expect(KiloHooks.condition("Bash(git push:*)", bash("ls -la"))).toBe(false)
    expect(KiloHooks.condition("Bash(git push *)", bash("FOO=bar git push origin"))).toBe(true)
    expect(KiloHooks.condition("not a rule!", bash("ls"))).toBe(true)
    expect(KiloHooks.condition("Bash", bash("ls"))).toBe(true)
    expect(KiloHooks.condition("Grep(foo)", call("grep", { pattern: "x" }))).toBe(true)
  })

  test("never runs a rule for another tool", () => {
    expect(KiloHooks.condition("Edit(*.env)", bash("cat .env"))).toBe(false)
  })

  test("matches file rules against resolved paths", () => {
    const dir = path.resolve("project")
    const edit = (file: string) => call("edit", { filePath: file }, { directory: dir })
    expect(KiloHooks.condition("Edit(*.env)", edit(".env"))).toBe(true)
    expect(KiloHooks.condition("Edit(*.env)", edit("src/a.ts"))).toBe(false)
    expect(KiloHooks.condition("Edit(/src/**)", edit("src/a.ts"))).toBe(true)
    expect(KiloHooks.condition("Edit(/src/**)", edit("lib/a.ts"))).toBe(false)
    const secret = path.join(dir, "secret")
    const read = call("read", { filePath: "secret/a" }, { directory: dir })
    const win = process.platform === "win32"
    const rule = win
      ? "//" + secret.at(0)?.toLowerCase() + secret.slice(2).replaceAll("\\", "/")
      : "//" + secret.slice(1)
    expect(KiloHooks.condition(`Read(${rule}/*)`, read)).toBe(true)
    if (win) expect(KiloHooks.condition(`Read(//${secret.replaceAll("\\", "/")}/*)`, read)).toBe(true)
  })

  test("matches WebFetch domains and their subdomains", () => {
    const fetch = (url: string) => call("webfetch", { url })
    expect(KiloHooks.condition("WebFetch(domain:example.com)", fetch("https://api.example.com/x"))).toBe(true)
    expect(KiloHooks.condition("WebFetch(domain:example.com)", fetch("https://example.org"))).toBe(false)
  })
})

describe("input", () => {
  test("uses Claude Code field names and tool names", () => {
    const dir = path.resolve("project")
    const value = KiloHooks.input(
      "PostToolUse",
      call("edit", { filePath: "src/a.ts", oldString: "a", newString: "b" }, { directory: dir }),
      "Edit applied",
    )
    expect(value).toEqual({
      session_id: "ses_1",
      cwd: dir,
      hook_event_name: "PostToolUse",
      kilo_session_id: "ses_1",
      kilo_platform: expect.any(String),
      tool_name: "Edit",
      kilo_tool_name: "edit",
      tool_input: {
        filePath: "src/a.ts",
        oldString: "a",
        newString: "b",
        file_path: path.join(dir, "src/a.ts"),
        old_string: "a",
        new_string: "b",
      },
      tool_use_id: "call_1",
      tool_response: "Edit applied",
    })
  })

  test("sends the root session, subagent fields, prompt id, permission mode and MCP server", () => {
    const value = KiloHooks.input(
      "PreToolUse",
      call(
        "files_open",
        {},
        {
          sessionID: "ses_child",
          root: "ses_root",
          parent: "ses_root",
          agent: "explore",
          prompt: "msg_1",
          mode: "plan",
          server: "files",
        },
      ),
    )
    expect(value).toMatchObject({
      session_id: "ses_root",
      kilo_session_id: "ses_child",
      agent_id: "ses_child",
      agent_type: "Explore",
      kilo_agent: "explore",
      prompt_id: "msg_1",
      permission_mode: "plan",
      mcp_server: { name: "files" },
    })
  })

  test("structures tool_response for bash, write and edit and keeps the text in kilo_tool_response", () => {
    const shell = call("bash", { command: "ls" })
    expect(KiloHooks.response(shell, { output: "a\nb", metadata: { interrupted: true } })).toEqual({
      stdout: "a\nb",
      stderr: "",
      interrupted: true,
    })
    const write = call("write", { filePath: "a.txt" })
    expect(KiloHooks.response(write, { output: "Wrote file" })).toEqual({
      filePath: path.resolve("a.txt"),
      success: true,
    })
    expect(KiloHooks.response(call("grep"), { output: "found" })).toBe("found")
    const value = KiloHooks.input("PostToolUse", shell, KiloHooks.response(shell, { output: "a" }), "a")
    expect(value.kilo_tool_response).toBe("a")
  })

  test("derives snake_case keys from the arguments the tool uses, ignoring decoys from the model", () => {
    const dir = path.resolve("project")
    const args = { filePath: ".env", file_path: "README.md", oldString: "a", old_string: "x" }
    const value = KiloHooks.input("PreToolUse", call("edit", args, { directory: dir }))
    expect(value.tool_input.file_path).toBe(path.join(dir, ".env"))
    expect(value.tool_input.old_string).toBe("a")
  })

  test("keeps arguments that tools name in snake_case themselves", () => {
    const args = { description: "find usages", prompt: "...", subagent_type: "explore" }
    expect(KiloHooks.input("PreToolUse", call("task", args)).tool_input).toEqual(args)
  })

  test("passes MCP arguments unchanged", () => {
    const args = { filePath: "a.ts", file_path: "b.ts" }
    expect(KiloHooks.input("PreToolUse", call("files_open", args)).tool_input).toEqual(args)
  })

  test("runs apply_patch hooks once per patched file", () => {
    const dir = path.resolve("project")
    const patchText = [
      "*** Begin Patch",
      "*** Update File: README.md",
      "@@",
      "-old",
      "+new",
      "*** Add File: .env",
      "+SECRET=1",
      "*** End Patch",
    ].join("\n")
    const runs = KiloHooks.inputs("PreToolUse", call("apply_patch", { patchText }, { directory: dir }))
    expect(runs.map((item) => item.tool_input.file_path)).toEqual([path.join(dir, "README.md"), path.join(dir, ".env")])
    expect(runs[0]?.tool_name).toBe("Edit")
  })

  test("keeps unknown tool names and omits tool_response before the call", () => {
    const value = KiloHooks.input("PreToolUse", call("github_search", { query: "x" }))
    expect(value.tool_name).toBe("github_search")
    expect("tool_response" in value).toBe(false)
  })
})

describe("payload", () => {
  test("maps Kilo agents to Claude Code agent types", () => {
    expect(KiloHookPayload.alias("general")).toBe("general-purpose")
    expect(KiloHookPayload.alias("explore")).toBe("Explore")
    expect(KiloHookPayload.alias("plan")).toBe("Plan")
    expect(KiloHookPayload.alias("debug")).toBe("debug")
  })

  test("remembers the roots of a bounded number of sessions", async () => {
    const walked: string[] = []
    const top = (id: string) => id.replace("ses_kid_", "ses_top_")
    const sessions = {
      get: (id: string) => {
        walked.push(id)
        return Effect.succeed({ id, parentID: id.startsWith("ses_kid_") ? top(id) : undefined })
      },
    } as unknown as Parameters<typeof KiloHookPayload.root>[1]
    const kid = (index: number) => SessionID.make(`ses_kid_${index}`)
    const root = (index: number) => Effect.runPromise(KiloHookPayload.root(kid(index), sessions)).then(String)
    const count = 5_000 // more subagent sessions than the cache keeps
    for (let i = 0; i < count; i++) expect(await root(i)).toBe(top(kid(i)))
    // Kilo's own ancestry is gone, so only the cache can answer without reading the sessions again.
    for (let i = 0; i < count; i++) KiloSession.clearPlatformOverride(kid(i))
    walked.length = 0
    expect(await root(count - 1)).toBe(top(kid(count - 1)))
    expect(walked).toEqual([])
    expect(await root(0)).toBe(top(kid(0)))
    expect(walked).toContain(kid(0))
    for (let i = 0; i < count; i++) KiloSession.clearPlatformOverride(kid(i))
  })

  test("marks the summary of an oversized replayed prompt only when a human wrote the prompt", () => {
    const message = (part: Record<string, unknown>) =>
      ({
        info: { id: "msg_1", role: "user" },
        parts: [{ id: "prt_1", messageID: "msg_1", type: "text", text: "run it", ...part }],
      }) as unknown as Parameters<typeof KiloHookPayload.summary>[0]
    expect(KiloHookPayload.summary(message({}))).toEqual({ kilo_human: true })
    // A prompt that was already a marked replay keeps its mark.
    expect(KiloHookPayload.summary(message({ synthetic: true, metadata: { kilo_human: true } }))).toEqual({
      kilo_human: true,
    })
    // Goal ticks, wakeups and other synthetic prompts, background results and Stop continuations stay unattended.
    expect(KiloHookPayload.summary(message({ synthetic: true }))).toBeUndefined()
    expect(KiloHookPayload.summary(message({ metadata: { background: true } }))).toBeUndefined()
    expect(KiloHookPayload.summary(message({ synthetic: true, metadata: { hook: { event: "Stop" } } }))).toBeUndefined()
  })

  test("reports bypassPermissions only for the broad YOLO rule", () => {
    expect(KiloHookPayload.mode([{ permission: "*", pattern: "*", action: "allow" }], "code")).toBe("bypassPermissions")
    expect(KiloHookPayload.mode([{ permission: "bash", pattern: "*", action: "allow" }], "plan")).toBe("plan")
    expect(KiloHookPayload.mode(undefined, "code")).toBe("default")
  })

  test("normalizes model ids to Claude Code's canonical names", () => {
    const value = KiloHookPayload.model({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4.5" })
    expect(value.bare).toBe("claude-sonnet-4.5")
    expect(value.canonical).toBe("claude-sonnet-4-5")
    expect(value.subjects).toEqual([
      "claude-sonnet-4-5",
      "claude-sonnet-4.5",
      "anthropic/claude-sonnet-4.5",
      "kilo/anthropic/claude-sonnet-4.5",
    ])
    expect(KiloHookPayload.model({ providerID: "a", modelID: "claude-opus-4-20250514" }).canonical).toBe(
      "claude-opus-4",
    )
  })

  test("tells where an instruction file comes from: Managed before User, else Project", () => {
    const prev = process.env.KILO_TEST_MANAGED_CONFIG_DIR
    const managed = path.join(Global.Path.config, "managed")
    // A managed directory below a user config directory is Managed, not User.
    process.env.KILO_TEST_MANAGED_CONFIG_DIR = managed
    try {
      expect(KiloHookPayload.memory(path.join(managed, "AGENTS.md"))).toBe("Managed")
      expect(KiloHookPayload.memory(path.join(Global.Path.config, "AGENTS.md"))).toBe("User")
      expect(KiloHookPayload.memory(path.join(Global.Path.home, ".claude", "CLAUDE.md"))).toBe("User")
      expect(KiloHookPayload.memory(path.join(Global.Path.home, "repo", "AGENTS.md"))).toBe("Project")
      expect(KiloHookPayload.memory(path.join(Global.Path.home, ".claude-other", "CLAUDE.md"))).toBe("Project")
    } finally {
      if (prev === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
      else process.env.KILO_TEST_MANAGED_CONFIG_DIR = prev
    }
  })

  test("maps assistant errors to StopFailure error types", () => {
    const api = (statusCode: number) => ({ name: "APIError", data: { statusCode } })
    expect(KiloHookPayload.failure(api(429))).toBe("rate_limit")
    expect(KiloHookPayload.failure(api(529))).toBe("overloaded")
    expect(KiloHookPayload.failure(api(503))).toBe("server_error")
    expect(KiloHookPayload.failure({ name: "ProviderAuthError" })).toBe("authentication_failed")
    expect(KiloHookPayload.failure({ name: "MessageOutputLengthError" })).toBe("max_output_tokens")
    expect(KiloHookPayload.failure({ name: "ContentFilterError" })).toBe("unknown")
  })
})

describe("scope and concat", () => {
  test("drops hooks from untrusted (project) config only", () => {
    const config: { hooks?: KiloHooks.Hooks; model: string } = { hooks: hooks("PreToolUse", "x"), model: "a/b" }
    expect(KiloHooks.scope(config, false, "kilo.json")).toEqual({ model: "a/b" })
    expect(KiloHooks.scope(config, true, path.join("/etc/kilo", "kilo.json"))).toBe(config)
  })

  test("drops hooks from a .kilo directory that is not a global config directory", () => {
    const config: { hooks?: KiloHooks.Hooks } = { hooks: hooks("PreToolUse", "x") }
    expect(KiloHooks.scope(config, true, path.join("/tmp/archive/.kilo", "kilo.jsonc")).hooks).toBeUndefined()
  })

  test("concatenates trusted layers and keeps identical groups once", () => {
    const a = hooks("PostToolUse", "one")
    const b = { ...hooks("PostToolUse", "two"), ...hooks("PreToolUse", "three") }
    const merged = KiloHooks.concat(KiloHooks.concat(a, b), a)
    expect(merged?.PostToolUse?.map((g) => g.hooks[0]?.command)).toEqual(["one", "two"])
    expect(merged?.PreToolUse?.map((g) => g.hooks[0]?.command)).toEqual(["three"])
  })

  test("keeps every registry event when merging", () => {
    const all = (command: string): KiloHooks.Hooks =>
      Object.fromEntries(KiloHookEvents.ALL.map((event) => [event, [{ hooks: [{ type: "command", command }] }]]))
    const merged = KiloHooks.concat(all("a"), all("b"))
    expect(Object.keys(merged ?? {})).toEqual(Object.keys(EVENTS))
    expect(merged?.BranchName?.map((group) => group.hooks[0]?.command)).toEqual(["a", "b"])
  })
})

describe("decide", () => {
  test("blocks on exit 1 when the JSON denies", () => {
    const deny = { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no .env" } }
    expect(KiloHooks.decide("PreToolUse", outcome(1, deny), handler).block).toBe("no .env")
  })

  test("uses a JSON blocking reason over stderr on exit 2, and stderr otherwise", () => {
    expect(
      KiloHooks.decide("PreToolUse", outcome(2, { decision: "block", reason: "json" }, "err"), handler).block,
    ).toBe("json")
    expect(KiloHooks.decide("PreToolUse", outcome(2, "{ not json", "stderr reason"), handler).block).toBe(
      "stderr reason",
    )
  })

  test("denies a PermissionRequest from its decision object, even on exit 2", () => {
    const deny = { hookSpecificOutput: { decision: { behavior: "deny", message: "nope", interrupt: true } } }
    const result = KiloHooks.decide("PermissionRequest", outcome(2, deny), handler)
    expect(result.block).toBe("nope")
    expect(result.interrupt).toBe(true)
    const allow = { hookSpecificOutput: { decision: { behavior: "allow" } } }
    expect(KiloHooks.decide("PermissionRequest", outcome(0, allow), handler).block).toBeUndefined()
  })

  test("does not let a moved Stop script force a continuation", () => {
    const missing = outcome(2, "", "python3: can't open file '/x.py': [Errno 2] No such file or directory")
    const result = KiloHooks.decide("Stop", missing, handler)
    expect(result.block).toBeUndefined()
    expect(result.failure).toContain("missing script")
    expect(KiloHooks.decide("PreToolUse", missing, handler).block).toContain("No such file or directory")
  })

  test("treats a PreModelSwitch ask, and a PreModelSwitch timeout, as a refusal", () => {
    const ask = { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "expensive" } }
    expect(KiloHooks.decide("PreModelSwitch", outcome(0, ask), handler).block).toContain("expensive")
    const timeout = { stdout: "", stderr: "", error: "timed out after 30s" }
    expect(KiloHooks.decide("PreModelSwitch", timeout, handler).block).toBeDefined()
    expect(KiloHooks.decide("UserPromptSubmit", timeout, handler).block).toBeUndefined()
  })

  test("asks on PreToolUse and ignores allow, defer and approve", () => {
    const ask = { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "sure?" } }
    expect(KiloHooks.decide("PreToolUse", outcome(0, ask), handler).ask).toBe("sure?")
    for (const decision of ["allow", "defer"]) {
      const result = KiloHooks.decide(
        "PreToolUse",
        outcome(0, { hookSpecificOutput: { permissionDecision: decision } }),
        handler,
      )
      expect(result.block).toBeUndefined()
      expect(result.ask).toBeUndefined()
    }
    expect(KiloHooks.decide("PreToolUse", outcome(0, { decision: "approve" }), handler).block).toBeUndefined()
  })

  test("blocks on invalid JSON only with onFailure: block, and never for async handlers", () => {
    const bad = outcome(0, "{ not json")
    expect(KiloHooks.decide("PreToolUse", bad, handler).block).toBeUndefined()
    expect(KiloHooks.decide("PreToolUse", bad, { ...handler, onFailure: "block" }).block).toContain("invalid JSON")
    expect(KiloHooks.decide("PreToolUse", bad, { ...handler, onFailure: "block", async: true }).block).toBeUndefined()
    expect(KiloHooks.decide("PostToolUse", bad, { ...handler, onFailure: "block" }).block).toBeUndefined()
  })

  test("blocks a PreToolUse input rewrite that differs from the input it was sent", () => {
    const sent = { command: "ls" }
    const same = { hookSpecificOutput: { updatedInput: { command: "ls" } } }
    expect(KiloHooks.decide("PreToolUse", outcome(0, same), handler, sent).block).toBeUndefined()
    const changed = { hookSpecificOutput: { updatedInput: { command: "ls -la" } } }
    expect(KiloHooks.decide("PreToolUse", outcome(0, changed), handler, sent).block).toContain("rewrote")
  })

  test("reads updatedToolOutput as a string or as stdout/stderr", () => {
    const text = { hookSpecificOutput: { updatedToolOutput: "redacted" } }
    expect(KiloHooks.decide("PostToolUse", outcome(0, text), handler).output).toBe("redacted")
    const shell = { hookSpecificOutput: { updatedMCPToolOutput: { stdout: "out", stderr: "err" } } }
    expect(KiloHooks.decide("PostToolUse", outcome(0, shell), handler).output).toBe("out\nerr")
    expect(
      KiloHooks.decide("PostToolUse", outcome(0, { hookSpecificOutput: { updatedToolOutput: 3 } }), handler).output,
    ).toBeUndefined()
  })

  test("adds plain stdout as context only where Claude Code does", () => {
    expect(KiloHooks.decide("UserPromptSubmit", outcome(0, "ticket PROJ-1"), handler).context).toEqual([
      "ticket PROJ-1",
    ])
    expect(KiloHooks.decide("PostToolUse", outcome(0, "formatted"), handler).context).toEqual([])
  })

  test("shows systemMessage, user-facing exit-2 stderr, and stops on continue: false", () => {
    const result = KiloHooks.decide(
      "SessionStart",
      outcome(2, { systemMessage: "heads up", continue: false, stopReason: "done" }, "err"),
      handler,
    )
    expect(result.user).toEqual(["err", "heads up"])
    expect(result.stop).toBe("done")
    expect(result.block).toBeUndefined()
  })

  test("clips long output", () => {
    const long = "x".repeat(20_000)
    const [item] = KiloHooks.decide("UserPromptSubmit", outcome(0, long), handler).context
    expect(item?.length).toBeLessThan(10_100)
    expect(item).toEndWith("(hook output truncated)")
  })

  test("clips the failure, stop reason and ask reason of a hook that prints a very long line", () => {
    const long = "x".repeat(50_000)
    const clipped = (value: string | undefined) => {
      expect(value?.length).toBeLessThan(10_100)
      expect(value).toEndWith("(hook output truncated)")
    }
    clipped(KiloHooks.decide("PostToolUse", outcome(1, "", long), handler).failure)
    clipped(KiloHooks.decide("PostToolUse", outcome(0, { continue: false, stopReason: long }), handler).stop)
    const ask = { hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: long } }
    clipped(KiloHooks.decide("PreToolUse", outcome(0, ask), handler).ask)
  })
})

describe("blocked", () => {
  test("blocks on exit 2 with stderr as the reason", () => {
    expect(KiloHooks.blocked({ code: 2, stdout: "", stderr: "secrets found\n" })).toBe("secrets found")
  })

  test("blocks on a JSON deny decision but ignores allow and ask", () => {
    const deny = { hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no .env" } }
    expect(KiloHooks.blocked({ code: 0, stdout: JSON.stringify(deny), stderr: "" })).toBe("no .env")
    const allow = { hookSpecificOutput: { permissionDecision: "allow" } }
    expect(KiloHooks.blocked({ code: 0, stdout: JSON.stringify(allow), stderr: "" })).toBeUndefined()
    const ask = { hookSpecificOutput: { permissionDecision: "ask" } }
    expect(KiloHooks.blocked({ code: 0, stdout: JSON.stringify(ask), stderr: "" })).toBeUndefined()
  })

  test("supports the legacy decision and continue fields", () => {
    expect(KiloHooks.blocked({ code: 0, stdout: '{"decision":"block","reason":"r"}', stderr: "" })).toBe("r")
    expect(KiloHooks.blocked({ code: 0, stdout: '{"continue":false,"stopReason":"s"}', stderr: "" })).toBe("s")
  })

  test("never blocks on other exit codes, plain text, failures or timeouts by default", () => {
    expect(KiloHooks.blocked({ code: 1, stdout: "", stderr: "boom" })).toBeUndefined()
    expect(KiloHooks.blocked({ code: 0, stdout: "all good", stderr: "" })).toBeUndefined()
    expect(KiloHooks.blocked({ stdout: "", stderr: "", error: "timed out after 1s" })).toBeUndefined()
  })

  test("counts output that looks like JSON but does not parse as a failure", () => {
    const value = { code: 0, stdout: '{"decision": ', stderr: "" }
    expect(KiloHooks.blocked(value)).toBeUndefined()
    expect(KiloHooks.blocked(value, { onFailure: "continue" })).toBeUndefined()
    expect(KiloHooks.blocked(value, { onFailure: "block" })).toContain("invalid JSON")
    expect(KiloHooks.blocked({ code: 0, stdout: "plain text", stderr: "" }, { onFailure: "block" })).toBeUndefined()
  })

  test("blocks on failure when the handler sets onFailure: block", () => {
    expect(KiloHooks.blocked({ code: 1, stdout: "", stderr: "" }, { onFailure: "block" })).toContain("exit code 1")
    const timeout = { stdout: "", stderr: "", error: "timed out after 1s" }
    expect(KiloHooks.blocked(timeout, { onFailure: "block" })).toContain("timed out")
  })
})

describe("feedback", () => {
  test("returns stderr on exit 2 and JSON reason or additionalContext on exit 0", () => {
    expect(KiloHooks.feedback({ code: 2, stdout: "", stderr: "lint failed" })).toBe("lint failed")
    const json = { decision: "block", reason: "fix lint", hookSpecificOutput: { additionalContext: "3 errors" } }
    expect(KiloHooks.feedback({ code: 0, stdout: JSON.stringify(json), stderr: "" })).toBe("fix lint\n3 errors")
  })

  test("does not show plain stdout to the model", () => {
    expect(KiloHooks.feedback({ code: 0, stdout: "formatted 1 file", stderr: "" })).toBeUndefined()
  })
})

describe("read Claude Code settings", () => {
  const write = (home: string, data: unknown) =>
    Filesystem.write(
      path.join(home, ".claude", "settings.json"),
      typeof data === "string" ? data : JSON.stringify(data),
    )

  test("keeps supported events and command handlers, including exec form and onFailure", async () => {
    await using home = await tmpdir()
    await write(home.path, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "guard.sh", timeout: 5, onFailure: "block" },
              { type: "command", command: "bash", args: ["/path/guard.sh"], onFailure: "continue" },
              { type: "prompt", prompt: "is this safe?" },
            ],
          },
        ],
        Setup: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
      },
    })
    expect(await KiloHooks.read(home.path)).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "guard.sh", timeout: 5, onFailure: "block" },
            { type: "command", command: "bash", args: ["/path/guard.sh"], onFailure: "continue" },
          ],
        },
      ],
    })
  })

  test("keeps if, async and shell on tool events, and lists what it skips with the reason", async () => {
    await using home = await tmpdir()
    await write(home.path, {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "rm-guard.sh", if: "Bash(rm *)" },
              { type: "command", command: "tests.sh", async: true },
              { type: "command", command: "ps.ps1", shell: "powershell" },
              { type: "command", command: "zsh.sh", shell: "zsh" },
              { type: "command", command: "wake.sh", asyncRewake: true },
              { type: "http", url: "https://example.com" },
            ],
          },
        ],
        Stop: [
          {
            matcher: "ignored",
            hooks: [
              { type: "command", command: "stop.sh" },
              { type: "command", command: "stop-if.sh", if: "Bash(rm *)" },
            ],
          },
        ],
        ConfigChange: [{ hooks: [{ type: "command", command: "audit.sh" }] }],
        GoalReport: [{ hooks: [{ type: "command", command: "goal.sh" }] }],
        Elicitation: [{ hooks: [{ type: "command", command: "elicit.sh" }] }],
        Bogus: [{ hooks: [{ type: "command", command: "bogus.sh" }] }],
      },
    })
    const result = await KiloHooks.inspect(home.path)
    expect(result.hooks).toEqual({
      PreToolUse: [
        {
          hooks: [
            { type: "command", command: "rm-guard.sh", if: "Bash(rm *)" },
            { type: "command", command: "tests.sh", async: true },
            { type: "command", command: "ps.ps1", shell: "powershell" },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "stop.sh" }] }],
    })
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { event: "PreToolUse", command: "zsh.sh", reason: "shell zsh" },
        { event: "PreToolUse", command: "wake.sh", reason: "asyncRewake" },
        { event: "PreToolUse", reason: "type http" },
        { event: "Stop", command: "stop-if.sh", reason: "if on a non-tool event" },
        { event: "ConfigChange", reason: "Kilo config only" },
        { event: "GoalReport", reason: "Kilo-only event" },
        { event: "Elicitation", reason: "not supported by Kilo" },
        { event: "Bogus", reason: "unknown event" },
      ]),
    )
    expect(result.skipped).toHaveLength(8)
  })

  test("parses the file once while it is unchanged", async () => {
    await using home = await tmpdir()
    await write(home.path, { hooks: { Stop: [{ hooks: [{ type: "command", command: "a.sh" }] }] } })
    const first = await KiloHooks.inspect(home.path)
    expect(await KiloHooks.inspect(home.path)).toBe(first)
    await write(home.path, { hooks: { Stop: [{ hooks: [{ type: "command", command: "bb.sh" }] }] } })
    const later = new Date(Date.now() + 5_000)
    await utimes(path.join(home.path, ".claude", "settings.json"), later, later)
    expect((await KiloHooks.inspect(home.path)).hooks?.Stop?.[0]?.hooks[0]?.command).toBe("bb.sh")
  })

  test("honors disableAllHooks", async () => {
    await using home = await tmpdir()
    await write(home.path, {
      disableAllHooks: true,
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "guard.sh" }] }] },
    })
    expect(await KiloHooks.read(home.path)).toBeUndefined()
  })

  test("returns nothing for a missing or invalid settings file", async () => {
    await using home = await tmpdir()
    expect(await KiloHooks.read(home.path)).toBeUndefined()
    await write(home.path, "{ not json")
    expect(await KiloHooks.read(home.path)).toBeUndefined()
  })
})

describe("running hooks", () => {
  test("blocks a tool call when a PreToolUse hook exits with 2", async () => {
    const command = script("process.stderr.write('do not touch this file'); process.exit(2)")
    const result = await Effect.runPromise(KiloHooks.before(hooks("PreToolUse", command, "edit"), call("edit")))
    expect(result).toContain("A PreToolUse hook blocked this edit call")
    expect(result).toContain("do not touch this file")
  })

  test("runs exec-form hooks without a shell", async () => {
    const handler = exec("process.stderr.write('exec form'); process.exit(2)")
    const result = await Effect.runPromise(KiloHooks.before(hooks("PreToolUse", handler), call("edit")))
    expect(result).toContain("exec form")
  })

  test("passes the hook input on stdin", async () => {
    const handler = exec(
      "let text = ''; process.stdin.on('data', (chunk) => (text += chunk)); process.stdin.on('end', () => { const data = JSON.parse(text); console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: data.tool_name + ' ' + data.tool_input.file_path } })) })",
    )
    const result = await Effect.runPromise(
      KiloHooks.before(hooks("PreToolUse", handler), call("write", { filePath: "a.txt" })),
    )
    expect(result).toContain(`Write ${path.resolve("a.txt")}`)
  })

  test("does not block on other exit codes or hooks for other tools", async () => {
    const failing = hooks("PreToolUse", script("process.exit(1)"))
    expect(await Effect.runPromise(KiloHooks.before(failing, call("edit")))).toBeUndefined()
    const other = hooks("PreToolUse", script("process.exit(2)"), "bash")
    expect(await Effect.runPromise(KiloHooks.before(other, call("edit")))).toBeUndefined()
  })

  test("lets the tool call through when a hook times out, unless it blocks on failure", async () => {
    const slow = exec("setTimeout(() => process.exit(2), 10000)")
    const start = Date.now()
    expect(
      await Effect.runPromise(KiloHooks.before(hooks("PreToolUse", slow, undefined, 1), call("edit"))),
    ).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(8_000)
    const strict = hooks("PreToolUse", { ...slow, onFailure: "block" }, undefined, 1)
    expect(await Effect.runPromise(KiloHooks.before(strict, call("edit")))).toContain("timed out after 1s")
  })

  test("defaults to the event's timeout: 600 s for most events, 30 s for prompt events", () => {
    expect(KiloHooks.seconds(undefined, "PreToolUse")).toBe(600)
    expect(KiloHooks.seconds(undefined)).toBe(600)
    expect(KiloHooks.seconds(undefined, "UserPromptSubmit")).toBe(30)
    expect(KiloHooks.seconds(Infinity, "BranchName")).toBe(10)
    expect(KiloHooks.seconds(5, "PreToolUse")).toBe(5)
  })

  test("reports a command that cannot start instead of throwing", async () => {
    expect((await KiloHooks.run({ type: "command", command: "  " }, {}, { cwd: process.cwd() })).error).toBe(
      "empty command",
    )
    const value = await KiloHooks.run({ type: "command", command: "a\0b", args: [] }, {}, { cwd: process.cwd() })
    expect(value.error).toBeDefined()
  })

  test("reports exit code 1 of a shell-form hook as an exit code", async () => {
    const value = await KiloHooks.run(
      { type: "command", command: script("process.exit(1)") },
      {},
      { cwd: process.cwd() },
    )
    expect(value).toEqual({ code: 1, stdout: "", stderr: "" })
  })

  test.skipIf(process.platform === "win32" && !Shell.gitbash())("runs shell-form hooks in bash", async () => {
    const value = await KiloHooks.run(
      { type: "command", command: "if [[ -n bash ]]; then echo bash-ok >&2; exit 2; fi", shell: "bash" },
      {},
      { cwd: process.cwd() },
    )
    expect({ code: value.code, stderr: value.stderr.trim() }).toEqual({ code: 2, stderr: "bash-ok" })
  })

  test("tells hooks the event and nesting depth, keeps them off the daemon and hides an outer CLAUDE_ENV_FILE", async () => {
    const prev = process.env.CLAUDE_ENV_FILE
    process.env.CLAUDE_ENV_FILE = "/tmp/outer-claude-env"
    try {
      const value = await KiloHooks.run(
        exec(
          "process.stdout.write(JSON.stringify({ event: process.env.KILO_HOOK_EVENT, depth: process.env.KILO_HOOK_DEPTH, daemon: process.env.KILO_NO_DAEMON, env: process.env.CLAUDE_ENV_FILE ?? null }))",
        ),
        {},
        { cwd: process.cwd(), event: "Stop" },
      )
      expect(JSON.parse(value.stdout)).toEqual({
        event: "Stop",
        depth: String(KiloHooks.DEPTH + 1),
        daemon: "1",
        env: null,
      })
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_ENV_FILE
      else process.env.CLAUDE_ENV_FILE = prev
    }
  })

  test("reports input that cannot be serialized instead of throwing", async () => {
    const value = await KiloHooks.run(exec("process.exit(0)"), { size: 1n }, { cwd: process.cwd() })
    expect(value.error).toBeDefined()
  })

  test("survives a non-finite timeout", async () => {
    const value = await KiloHooks.run({ ...exec("process.exit(0)"), timeout: Infinity }, {}, { cwd: process.cwd() })
    expect(value.code).toBe(0)
  })

  test("keeps the decision of a hook that exits in time while a background child holds its output open", async () => {
    const handler = exec(
      "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }); process.stderr.write('deny: protected'); process.exit(2)",
    )
    const value = await KiloHooks.run({ ...handler, timeout: 1 }, {}, { cwd: process.cwd() })
    expect(value.code).toBe(2)
    expect(KiloHooks.blocked(value)).toBe("deny: protected")
  })

  test("kills the whole process tree on timeout", async () => {
    await using dir = await tmpdir()
    const marker = path.join(dir.path, "still-running")
    const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 2500)`
    const handler = exec(
      `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); setTimeout(() => {}, 10000)`,
    )
    const value = await KiloHooks.run({ ...handler, timeout: 1 }, {}, { cwd: dir.path })
    expect(value.error).toContain("timed out")
    // The would-be side effect of the orphaned child is the thing under test, so wait past it.
    await Bun.sleep(3000)
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test("does not let the tool run when the call is aborted while its hooks run", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const slow = hooks("PreToolUse", exec("setTimeout(() => process.exit(0), 5000)"))
    const result = await Effect.runPromise(KiloHooks.before(slow, call("edit", {}, { abort: controller.signal })))
    expect(result).toBe("The tool call was aborted before it ran.")
  })

  test("appends PostToolUse feedback to the tool result", async () => {
    const command = script("process.stderr.write('2 lint errors in a.ts'); process.exit(2)")
    const output = { output: "Edit applied successfully." }
    await Effect.runPromise(KiloHooks.after(hooks("PostToolUse", command, "Edit"), call("edit"), output))
    expect(output.output).toContain("Edit applied successfully.")
    expect(output.output).toContain('<hook_feedback event="PostToolUse">')
    expect(output.output).toContain("2 lint errors in a.ts")
  })

  test("leaves the tool result unchanged when PostToolUse hooks succeed quietly", async () => {
    const output = { output: "done" }
    await Effect.runPromise(KiloHooks.after(hooks("PostToolUse", script("console.log('ok')")), call("edit"), output))
    expect(output.output).toBe("done")
  })
})

describe("fire", () => {
  test("returns an empty verdict without handlers", async () => {
    const verdict = await Effect.runPromise(
      KiloHooks.fire({ event: "Stop", hooks: {}, payloads: [{}], cwd: process.cwd() }),
    )
    expect(verdict).toEqual({ context: [], user: [], specific: [], ran: 0 })
  })

  test("runs async handlers in the background and ignores their decisions", async () => {
    await using dir = await tmpdir()
    const marker = path.join(dir.path, "async")
    const slow = {
      ...record(marker, "setTimeout(() => process.exit(2), 300)"),
      async: true,
      onFailure: "block" as const,
    }
    const start = Date.now()
    const verdict = await Effect.runPromise(
      KiloHooks.fire({
        event: "PreToolUse",
        hooks: hooks("PreToolUse", slow),
        subjects: ["bash"],
        payloads: [{ n: 1 }],
        cwd: dir.path,
      }),
    )
    expect(Date.now() - start).toBeLessThan(250)
    expect(verdict.block).toBeUndefined()
    expect(verdict.ran).toBe(0)
    for (let i = 0; i < 100 && !(await Bun.file(marker).exists()); i++) await Bun.sleep(50)
    expect(await lines(marker)).toEqual([{ n: 1 }])
  })

  test("kills runs still going when the budget expires", async () => {
    await using dir = await tmpdir()
    const marker = path.join(dir.path, "late")
    const slow = exec(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500)`)
    const start = Date.now()
    await Effect.runPromise(
      KiloHooks.fire({
        event: "SessionEnd",
        hooks: hooks("SessionEnd", slow),
        payloads: [{}],
        cwd: dir.path,
        budget: 200,
      }),
    )
    expect(Date.now() - start).toBeLessThan(1_000)
    await Bun.sleep(1_800)
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test("aggregates decisions in config order", async () => {
    const config: KiloHooks.Hooks = {
      PostToolUse: [
        {
          hooks: [
            exec(
              "console.log(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'first', additionalContext: 'a' } }))",
            ),
          ],
        },
        {
          hooks: [
            exec(
              "console.log(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: 'second', additionalContext: 'a' } }))",
            ),
          ],
        },
      ],
    }
    const verdict = await Effect.runPromise(
      KiloHooks.fire({ event: "PostToolUse", hooks: config, subjects: ["edit"], payloads: [{}], cwd: process.cwd() }),
    )
    expect(verdict.output).toBe("second")
    expect(verdict.context).toEqual(["a"])
    expect(verdict.specific).toHaveLength(2)
    expect(verdict.ran).toBe(2)
  })

  test("clips the notice, stop reason and ask reason of a hook that prints a very long line", async () => {
    const fire = (event: "PreToolUse" | "PostToolUse", code: string) =>
      Effect.runPromise(
        KiloHooks.fire({
          event,
          hooks: hooks(event, exec(code)),
          subjects: ["edit"],
          payloads: [{}],
          cwd: process.cwd(),
          sessionID: `ses_long_${event}_${Date.now()}`,
        }),
      )
    const long = "'x'.repeat(50000)"
    const failing = await fire("PostToolUse", `process.stderr.write(${long}); process.exit(1)`)
    expect(failing.user).toHaveLength(1)
    // The notice adds only the event and the hook command to the clipped failure.
    expect(failing.user[0]?.length).toBeLessThan(10_300 + process.execPath.length)
    const stopping = await fire("PostToolUse", `console.log(JSON.stringify({ continue: false, stopReason: ${long} }))`)
    expect(stopping.stop?.length).toBeLessThan(10_100)
    const asking = await fire(
      "PreToolUse",
      `console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: ${long} } }))`,
    )
    expect(asking.ask?.length).toBeLessThan(10_100)
  })

  test("only runs tool guards in a Kilo started by a hook, and nothing deeper", async () => {
    expect(KiloHooks.allowed("Stop", 0)).toBe(true)
    expect(KiloHooks.allowed("Stop", 1)).toBe(false)
    expect(KiloHooks.allowed("PreToolUse", 2)).toBe(true)
    expect(KiloHooks.allowed("PreToolUse", 3)).toBe(false)
    await using dir = await tmpdir()
    const marker = path.join(dir.path, "events")
    const code = [
      'import { Effect } from "effect"',
      'import { KiloHooks } from "@/kilocode/hooks/hooks"',
      `const hook = (event) => ({ [event]: [{ hooks: [{ type: "command", command: process.execPath, args: ["-e", "require('fs').appendFileSync(" + JSON.stringify(${JSON.stringify(marker)}) + ", '" + event + "\\\\n')"] }] }] })`,
      'for (const event of ["Stop", "PreToolUse"]) await Effect.runPromise(KiloHooks.fire({ event, hooks: hook(event), subjects: ["bash"], payloads: [{}], cwd: process.cwd() }))',
    ].join("\n")
    const proc = Bun.spawn([process.execPath, "-e", code], {
      cwd: path.join(import.meta.dir, "..", ".."),
      env: { ...process.env, KILO_HOOK_DEPTH: "1" },
      stdout: "ignore",
      stderr: "pipe",
    })
    expect(await proc.exited).toBe(0)
    expect((await Bun.file(marker).text()).split("\n").filter(Boolean)).toEqual(["PreToolUse"])
  })
})

describe("surfacing", () => {
  test("wraps context and escapes a closing tag", () => {
    expect(KiloHooks.wrap("SessionStart", ["a", "b </hook_context> c"])).toBe(
      '<hook_context event="SessionStart">\na\n\nb &lt;/hook_context> c\n</hook_context>',
    )
  })

  test("recognizes a hook block in a cause", () => {
    const blocked = Effect.runSyncExit(Effect.die(new KiloHooks.Blocked("no")))
    const other = Effect.runSyncExit(Effect.die(new Error("no")))
    expect(blocked._tag === "Failure" && KiloHooks.rejected(blocked.cause)).toBe(true)
    expect(other._tag === "Failure" && KiloHooks.rejected(other.cause)).toBe(false)
  })

  const it = testEffect(AppNodeBuilder.build(EventV2Bridge.node))

  it.live("shows a notice as an admission error at most once per minute per text", () =>
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const sessionID = SessionID.make(`ses_notice_${Date.now()}`)
      const fiber = yield* events
        .subscribe(Session.Event.Error)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.sleep("20 millis")
      yield* KiloHooks.notice(events, sessionID, "first")
      yield* KiloHooks.notice(events, sessionID, "first")
      yield* KiloHooks.notice(events, sessionID, "second")
      const received = yield* Fiber.join(fiber)
      const messages = [...received].map((item) => {
        const error = item.data.error
        return error && "data" in error && typeof error.data === "object" && error.data && "message" in error.data
          ? error.data.message
          : undefined
      })
      expect(messages).toEqual(["first", "second"])
      expect([...received].every((item) => item.metadata?.phase === "admission")).toBe(true)
    }),
  )
})

describe("resolve", () => {
  const settings = path.join(Global.Path.home, ".claude", "settings.json")
  const own = { matcher: "edit", hooks: [{ type: "command" as const, command: "own.sh" }] }
  const layer = Layer.mergeAll(
    TestConfig.layer({ get: () => Effect.succeed({ hooks: { PreToolUse: [own] } }) }),
    AppNodeBuilder.build(Database.node),
  )
  const available = backendSupport({ mode: "deny", allowedHosts: [] }).available
  const resolve = (dir: string, event?: KiloHooks.Event) =>
    Effect.runPromise(
      KiloHooks.resolve(undefined, event).pipe(
        Effect.provide(layer),
        Effect.provideService(InstanceRef, { directory: dir, worktree: dir } as never),
      ),
    )

  test("returns nothing, without touching sandbox state, when no hook handles the event", async () => {
    await using dir = await tmpdir()
    expect(await resolve(dir.path, "BranchName")).toEqual({})
  })

  test("skips Claude Code hooks for directory events when the /sandbox preference sandboxes new sessions", async () => {
    await using dir = await tmpdir()
    await Filesystem.write(
      settings,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "claude.sh" }] }] } }),
    )
    try {
      await SandboxPreference.write(dir.path, false)
      expect(await Effect.runPromise(SandboxPolicy.directory(dir.path).pipe(Effect.provide(layer)))).toBe(false)
      expect((await resolve(dir.path, "Stop")).Stop?.[0]?.hooks[0]?.command).toBe("claude.sh")
      await SandboxPreference.write(dir.path, true)
      expect(await Effect.runPromise(SandboxPolicy.directory(dir.path).pipe(Effect.provide(layer)))).toBe(available)
      const hooks = await resolve(dir.path, "Stop")
      expect(hooks.Stop).toEqual(available ? undefined : [{ hooks: [{ type: "command", command: "claude.sh" }] }])
      expect(hooks.PreToolUse).toEqual([own])
    } finally {
      await rm(settings, { force: true })
    }
  })
})
