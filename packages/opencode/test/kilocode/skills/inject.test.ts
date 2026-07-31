import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Shell } from "@opencode-ai/core/shell"
import { Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "@/tool/skill"
import { SkillInject } from "@/kilocode/skills/inject"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance } from "../../fixture/fixture"
import { SessionID, MessageID } from "@/session/schema"
import { testEffect } from "../../lib/effect"

// Global (~/.claude) skills are trusted, but Global.Service snapshots the home
// path when its layer is built, so KILO_TEST_HOME must be set before the runtime
// layer below is constructed — not inside a test body.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-inject-home-")))
process.env.KILO_TEST_HOME = HOME

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(Ripgrep.defaultLayer)),
)

// Shell injection spawns real processes; skip on windows CI like the sibling suite.
const unix = process.platform !== "win32" ? it.instance : it.instance.skip

afterEach(async () => {
  // reset discovered skills between tests by clearing the global skill dir
  await fs.promises.rm(path.join(HOME, ".agents"), { recursive: true, force: true })
})

// Global ~/.agents skills are trusted (and, unlike ~/.claude, not gated by the
// KILO_DISABLE_CLAUDE_CODE flag the test env sets); project .kilo skills are untrusted.
function writeGlobalSkill(name: string, body: string) {
  return Effect.promise(() =>
    Bun.write(
      path.join(HOME, ".agents", "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} test skill.\n---\n\n${body}\n`,
    ),
  )
}

function writeProjectSkill(dir: string, name: string, body: string) {
  return Effect.promise(() =>
    Bun.write(
      path.join(dir, ".kilo", "skill", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} test skill.\n---\n\n${body}\n`,
    ),
  )
}

function loadSkill(name: string, ask: Tool.Context["ask"]) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
    const tool = (yield* registry.tools({
      providerID: "opencode" as any,
      modelID: "gpt-5" as any,
      agent,
    })).find((t) => t.id === SkillTool.id)
    if (!tool) throw new Error("Skill tool not found")
    return yield* tool.execute({ name }, { ...baseCtx, ask })
  })
}

describe("skill shell injection", () => {
  unix("runs the batch after a single forced approval listing every command", () =>
    Effect.gen(function* () {
      yield* writeGlobalSkill("trusted-shell", "A: !`printf one` B: !`printf two`")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* loadSkill("trusted-shell", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      expect(result.output).toContain("A: one B: two")
      // one skill-load ask plus exactly one batch bash ask carrying all commands
      const bash = requests.filter((r) => r.permission === "bash")
      expect(bash.length).toBe(1)
      expect(bash[0].metadata?.["skillShell"]).toBe(true)
      // patterns drive rule matching; metadata.commands is the verbatim list the prompt renders
      expect(bash[0].patterns).toEqual(["printf one", "printf two"])
      expect(bash[0].metadata?.["commands"]).toEqual(["printf one", "printf two"])
    }),
  )

  unix("runs commands in the instance directory", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* writeGlobalSkill("cwd-shell", "Here: !`pwd`")

      const result = yield* loadSkill("cwd-shell", () => Effect.void)

      // pwd resolves to the instance dir (realpath), not the server process cwd
      expect(result.output).toContain(path.basename(dir))
    }),
  )

  unix("authorizes both the decomposed sub-commands and the verbatim command", () =>
    Effect.gen(function* () {
      // A chained placeholder is asked with per-sub-command patterns (so deny/veto
      // rules apply to each) AND the verbatim string (so the metachar deny rules
      // `*;*`/`*|*`/`*\n*` fire and cd/set-location escapes can't hide). The prompt
      // still displays the verbatim placeholder.
      yield* writeGlobalSkill("compound-shell", "Out: !`cat README.md; printf hi`")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* loadSkill("compound-shell", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      const bash = requests.filter((r) => r.permission === "bash")
      expect(bash.length).toBe(1)
      expect(bash[0].patterns).toContain("cat README.md")
      expect(bash[0].patterns).toContain("printf hi")
      // the raw chained string is authorized too, so metachar deny rules can match it
      expect(bash[0].patterns).toContain("cat README.md; printf hi")
      expect(bash[0].metadata?.["commands"]).toEqual(["cat README.md; printf hi"])
    }),
  )

  unix("still prompts for a cd-only command (no empty-pattern auto-approve)", () =>
    Effect.gen(function* () {
      // `cd` decomposes to no sub-command patterns; without the verbatim command the
      // bash ask would carry an empty pattern list and Permission.ask would silently
      // auto-approve (forceAsk never runs on an empty list). The raw command keeps
      // the prompt firing.
      yield* writeGlobalSkill("cd-only", "Out: !`cd sub`")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* loadSkill("cd-only", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      const bash = requests.filter((r) => r.permission === "bash")
      expect(bash.length).toBe(1)
      expect(bash[0].patterns).toContain("cd sub")
    }),
  )

  unix("asks external_directory (same metadata) before bash when a command leaves the project", () =>
    Effect.gen(function* () {
      // `cd` is a path-taking command for decomposition purposes, so a target outside the
      // project (here /tmp, never inside the test instance's tmpdir) populates the decomposed
      // dirs set and must raise a second, up-front external_directory ask before the bash ask —
      // both carrying the same skillShell/skill/commands metadata as the batch they gate.
      yield* writeGlobalSkill("outside-shell", "Out: !`cd /tmp && pwd`")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* loadSkill("outside-shell", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      const skillRequests = requests.filter((r) => r.metadata?.["skillShell"] === true)
      expect(skillRequests.map((r) => r.permission)).toEqual(["external_directory", "bash"])

      const [dirAsk, bashAsk] = skillRequests
      expect(dirAsk.patterns).toEqual(["/tmp/*"])
      expect(dirAsk.metadata).toEqual(bashAsk.metadata)
      expect(dirAsk.metadata?.["skill"]).toBe("outside-shell")
      expect(dirAsk.metadata?.["commands"]).toEqual(["cd /tmp && pwd"])
    }),
  )

  unix("aborts the entire skill load when the batch is rejected", () =>
    Effect.gen(function* () {
      yield* writeGlobalSkill("denied-shell", "Secret: !`printf leaked`")

      const exit = yield* loadSkill("denied-shell", (req) =>
        // Reject the batch. Tools wrap ctx.ask with Effect.orDie, so this reaches
        // the injector as a defect and must abort the whole skill load.
        req.permission === "bash"
          ? Effect.fail(new PermissionV1.RejectedError()).pipe(Effect.orDie)
          : Effect.void,
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  unix("does not run shell injection for untrusted project skills", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      yield* writeProjectSkill(dir, "untrusted-shell", "Value: !`printf shouldnotrun`")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* loadSkill("untrusted-shell", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      expect(result.output).toContain("[skill shell execution disabled for untrusted skill]")
      expect(result.output).not.toContain("shouldnotrun")
      // no bash permission ask because nothing was scanned or spawned
      expect(requests.some((r) => r.permission === "bash")).toBe(false)
    }),
  )

  unix("does not trust a global skill symlinked into the project", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      // A SKILL.md that lives in the project, symlinked into the trusted ~/.agents/skills dir
      // (a suggested convenience), must not mint trust for project-controlled markdown.
      const projectSkillDir = path.join(dir, "skills", "linked")
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(projectSkillDir, "SKILL.md"),
          "---\nname: linked\ndescription: linked test skill.\n---\n\nValue: !`printf shouldnotrun`\n",
        )
        const linkDir = path.join(HOME, ".agents", "skills", "linked")
        await fs.promises.mkdir(path.dirname(linkDir), { recursive: true })
        await fs.promises.symlink(projectSkillDir, linkDir, "dir")
      })

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* loadSkill("linked", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      // realpath is inside the project → treated as untrusted, no execution, no bash ask
      expect(result.output).toContain("[skill shell execution disabled for untrusted skill]")
      expect(result.output).not.toContain("shouldnotrun")
      expect(requests.some((r) => r.permission === "bash")).toBe(false)
    }),
  )

  unix("does not execute placeholders inside fenced code blocks", () =>
    Effect.gen(function* () {
      // The fenced placeholder is a documentation example and must stay literal; only the
      // live one runs.
      yield* writeGlobalSkill("fenced-shell", "Live: !`printf LIVE`\n\n```\nExample: !`printf FENCED`\n```\n")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* loadSkill("fenced-shell", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      expect(result.output).toContain("Live: LIVE")
      // the fenced example is left verbatim, not executed
      expect(result.output).toContain("Example: !`printf FENCED`")
      expect(result.output).not.toContain("Example: FENCED")
      // only the live command is authorized
      const bash = requests.filter((r) => r.permission === "bash")
      expect(bash[0]?.patterns).toEqual(["printf LIVE"])
    }),
  )

  unix("treats a placeholder inside a nested (```` wrapping ```) fence as inert", () =>
    Effect.gen(function* () {
      // The common "wrap a ``` example in a ```` fence" pattern must not execute the inner
      // example; a shorter inner fence does not close the longer outer one.
      const body = "Live: !`printf LIVE`\n\n````md\n```bash\nExample: !`printf FENCED`\n```\n````\n"
      yield* writeGlobalSkill("nested-fence", body)

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* loadSkill("nested-fence", (req) =>
        Effect.sync(() => {
          requests.push(req)
        }),
      )

      expect(result.output).toContain("Live: LIVE")
      expect(result.output).toContain("!`printf FENCED`")
      expect(result.output).not.toContain("Example: FENCED")
      const bash = requests.filter((r) => r.permission === "bash")
      expect(bash[0]?.patterns).toEqual(["printf LIVE"])
    }),
  )

  unix("does not re-execute shell placeholders emitted by command output", () =>
    Effect.gen(function* () {
      // The command emits a literal placeholder `!<backtick>echo pwned<backtick>`
      // built from octal escapes so the SKILL.md itself contains no nested
      // backticks. If render re-scanned command output, `echo pwned` would run.
      yield* writeGlobalSkill("nested-shell", "Out: !`printf '!\\140echo pwned\\140'`")

      const result = yield* loadSkill("nested-shell", () => Effect.void)

      expect(result.output).toContain("!`echo pwned`")
      // "pwned" must appear only inside the inert placeholder, never executed alone.
      expect(result.output).not.toMatch(/Out:\s*pwned\s*$/m)
    }),
  )

  unix("truncates oversized command output before inlining", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      // render directly (bypassing the tool's own output truncation) to assert the injector caps output
      const rendered = yield* SkillInject.render({
        content: "Out: !`yes x | head -c 65536`",
        trusted: true,
        disabled: false,
        cwd: dir,
        skill: "big-shell",
        shell: Shell.acceptable(),
        ctx: { ...baseCtx, ask: () => Effect.void } as Tool.Context,
        decompose: ({ command }) => Effect.succeed({ patterns: [command], dirs: [] }),
      })

      expect(rendered).toContain("[skill shell output truncated]")
      expect(rendered.length).toBeLessThan(40000)
    }),
  )
})

// The disabled (kill-switch) and untrusted branches must short-circuit before
// asking permission or spawning. Passing an ask/spawner that throws proves
// neither is reached.
describe("SkillInject.render gating", () => {
  const boom = () => {
    throw new Error("must not be reached")
  }
  const ctx = { ...baseCtx, ask: () => Effect.sync(boom) } as Tool.Context
  const decompose = (() => Effect.sync(boom)) as unknown as SkillInject.Decompose

  const run = (opts: { trusted: boolean; disabled: boolean; content?: string }) =>
    Effect.runPromise(
      SkillInject.render({
        content: opts.content ?? "Value: !`printf ran`",
        trusted: opts.trusted,
        disabled: opts.disabled,
        cwd: "/tmp",
        skill: "test",
        shell: Shell.acceptable(),
        ctx,
        decompose,
      }),
    )

  it.effect("kill-switch replaces every command without asking or running it", () =>
    Effect.gen(function* () {
      const out = yield* Effect.promise(() => run({ trusted: true, disabled: true }))
      expect(out).toBe("Value: [skill shell execution disabled by policy]")
    }),
  )

  it.effect("untrusted skills never ask or run their commands", () =>
    Effect.gen(function* () {
      const out = yield* Effect.promise(() => run({ trusted: false, disabled: false }))
      expect(out).toBe("Value: [skill shell execution disabled for untrusted skill]")
    }),
  )

  it.effect("content without placeholders is returned unchanged", () =>
    Effect.gen(function* () {
      const out = yield* Effect.promise(() => run({ trusted: true, disabled: false, content: "no commands here" }))
      expect(out).toBe("no commands here")
    }),
  )
})
