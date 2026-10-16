import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { KiloHooks } from "../../src/kilocode/hooks/hooks"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// Shell-form hooks run through the platform shell (sh, or cmd.exe on Windows). Driving them with
// `bun -e` keeps the tests portable: only double-quoted scripts, single-quoted JS strings, no `$`.
const script = (code: string) => `"${process.execPath}" -e "${code}"`
// Exec-form hooks spawn the program directly, so their arguments need no shell quoting at all.
const exec = (code: string): KiloHooks.Handler => ({ type: "command", command: process.execPath, args: ["-e", code] })

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
})

describe("select", () => {
  test("matches Kilo tool ids and their Claude Code names", () => {
    const config: KiloHooks.Hooks = {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "claude-style" }] },
        { matcher: "bash", hooks: [{ type: "command", command: "kilo-style" }] },
      ],
    }
    expect(KiloHooks.select(config, "PreToolUse", call("edit")).map((h) => h.command)).toEqual(["claude-style"])
    expect(KiloHooks.select(config, "PreToolUse", call("apply_patch")).map((h) => h.command)).toEqual(["claude-style"])
    expect(KiloHooks.select(config, "PreToolUse", call("bash")).map((h) => h.command)).toEqual(["kilo-style"])
    expect(KiloHooks.select(config, "PostToolUse", call("edit"))).toEqual([])
  })

  test("matches Claude Code's current and legacy subagent tool names", () => {
    expect(KiloHooks.names(call("task"))).toEqual(["task", "Agent", "Task"])
  })

  test("matches Claude Code MCP names passed as call aliases", () => {
    const mcp = call("github_create_issue", {}, { aliases: ["mcp__github__create_issue"] })
    expect(KiloHooks.select(hooks("PreToolUse", "guard", "mcp__github__.*"), "PreToolUse", mcp)).toHaveLength(1)
    expect(KiloHooks.input("PreToolUse", mcp).tool_name).toBe("mcp__github__create_issue")
  })

  test("runs the same command once when several groups match", () => {
    const config: KiloHooks.Hooks = {
      PostToolUse: [
        { matcher: "edit", hooks: [{ type: "command", command: "lint" }] },
        { matcher: "*", hooks: [{ type: "command", command: "lint" }] },
      ],
    }
    expect(KiloHooks.select(config, "PostToolUse", call("edit"))).toHaveLength(1)
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
              { type: "command", command: "bash", args: ["/path/guard.sh"] },
              { type: "prompt", prompt: "is this safe?" },
            ],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
      },
    })
    expect(await KiloHooks.read(home.path)).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "guard.sh", timeout: 5, onFailure: "block" },
            { type: "command", command: "bash", args: ["/path/guard.sh"] },
          ],
        },
      ],
    })
  })

  test("skips handlers using fields Kilo does not implement", async () => {
    await using home = await tmpdir()
    await write(home.path, {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "rm-guard.sh", if: "Bash(rm *)" },
              { type: "command", command: "tests.sh", async: true },
              { type: "command", command: "ps.ps1", shell: "powershell" },
              { type: "command", command: "kept.sh" },
            ],
          },
        ],
      },
    })
    expect(await KiloHooks.read(home.path)).toEqual({
      PreToolUse: [{ hooks: [{ type: "command", command: "kept.sh" }] }],
    })
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
      "Bun.stdin.text().then((text) => { const data = JSON.parse(text); console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: data.tool_name + ' ' + data.tool_input.file_path } })) })",
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

  test("reports a command that cannot start instead of throwing", async () => {
    expect((await KiloHooks.run({ type: "command", command: "  " }, {}, { cwd: process.cwd() })).error).toBe(
      "empty command",
    )
    const outcome = await KiloHooks.run({ type: "command", command: "a\0b", args: [] }, {}, { cwd: process.cwd() })
    expect(outcome.error).toBeDefined()
  })

  test("survives a non-finite timeout", async () => {
    const outcome = await KiloHooks.run({ ...exec("process.exit(0)"), timeout: Infinity }, {}, { cwd: process.cwd() })
    expect(outcome.code).toBe(0)
  })

  test("keeps the decision of a hook that exits in time while a background child holds its output open", async () => {
    const handler = exec(
      "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: 'inherit' }); process.stderr.write('deny: protected'); process.exit(2)",
    )
    const outcome = await KiloHooks.run({ ...handler, timeout: 1 }, {}, { cwd: process.cwd() })
    expect(outcome.code).toBe(2)
    expect(KiloHooks.blocked(outcome)).toBe("deny: protected")
  })

  test("kills the whole process tree on timeout", async () => {
    await using dir = await tmpdir()
    const marker = path.join(dir.path, "still-running")
    const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 2500)`
    const handler = exec(
      `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); setTimeout(() => {}, 10000)`,
    )
    const outcome = await KiloHooks.run({ ...handler, timeout: 1 }, {}, { cwd: dir.path })
    expect(outcome.error).toContain("timed out")
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
