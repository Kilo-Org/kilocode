import { describe, expect, it } from "bun:test"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import {
  buildWorkStyleApplyPlan,
  getDisplayPreset,
  getInitialWorkStyle,
  WORK_STYLE_PRESETS,
} from "../../src/shared/work-style-presets"

/** The readers and searchers `envGuards` derives a rule for, in table order. */
const READERS = ["cat", "head", "tail", "less", "diff", "sort", "uniq", "cut", "jq"]
const SEARCHERS = ["grep", "rg", "ag"]

describe("work style presets", () => {
  it("shows onboarding for users without sessions", () => {
    expect(getInitialWorkStyle(false)).toBe("unset")
  })

  it("skips onboarding for users with existing sessions", () => {
    expect(getInitialWorkStyle(true)).toBe("skipped")
  })

  it("uses ask-first permissions for human in the loop", () => {
    const cfg = WORK_STYLE_PRESETS["human-in-the-loop"].config
    const bash = cfg.permission?.bash as Record<string, string>
    expect(cfg.terminal_command_display).toBe("expanded")
    expect(cfg.reasoning_display).toBe("expanded")
    expect(cfg.permission?.["*"]).toBeUndefined()
    expect(cfg.permission?.edit).toBe("ask")
    expect(bash).toMatchObject({ "*": "ask", "rg *": "allow", "*>*": "ask" })
    expect(Object.keys(bash).at(-1)).toBe("*>*")
    // The shell readers apply the same level as the read rule for environment
    // files. `envGuards` derives a rule only for a command the map already allows
    // as `cmd *`, so the preset gates exactly this subset of the table.
    const derived = (table: string[]) => table.filter((command) => `${command} *` in bash)
    expect(derived(READERS)).toEqual(["cat", "head", "tail", "less", "diff", "uniq", "cut", "jq"])
    expect(derived(SEARCHERS)).toEqual([...SEARCHERS])
    // The table is pinned key by key, and resolution is checked the way
    // `Permission.evaluate` does it: the last matching pattern wins.
    const resolve = (command: string) => {
      const entries = Object.entries(bash)
      for (let index = entries.length - 1; index >= 0; index--) {
        const [pattern, action] = entries[index]
        if (Wildcard.match(command, pattern)) return action
      }
      return undefined
    }
    for (const command of derived(READERS)) {
      expect(bash[`${command} *.env*`]).toBe("ask")
      expect(bash[`${command} .env.example`]).toBe("allow")
      // A nested sample path needs a `*` before the sample name, and that `*`
      // spans a real environment file earlier on the command, so it is not
      // emitted at all.
      expect(bash[`${command} */.env.example`]).toBeUndefined()
      expect(resolve(`${command} .env.example`)).toBe("allow")
      expect(resolve(`${command} config/.env.example`)).toBe("ask")
      expect(resolve(`${command} -n .env .env.example`)).toBe("ask")
      expect(resolve(`${command} -n .env config/.env.example`)).toBe("ask")
    }
    // A sample allow names the sample path alone, never behind a wildcard.
    for (const key of Object.keys(bash)) expect(key).not.toMatch(/\*\/\.env\.example$|^\S+ \*\.env\.example$/)
    // Operand shapes the map states a level for.
    expect(resolve("cat *.env*")).toBe("ask")
    expect(resolve("cat -n .env .env.example")).toBe("ask")
    expect(resolve("grep -n KEY .env config/.env.example")).toBe("ask")
    for (const command of derived(SEARCHERS)) {
      for (const file of [".env", ".env.*"]) {
        // A searcher's first operand is its pattern, so a bare name there is not
        // gated and the keys naming it must not exist.
        expect(bash[`${command} ${file}`]).toBeUndefined()
        expect(bash[`${command} ${file} *`]).toBeUndefined()
        expect(bash[`${command} * ${file}`]).toBe("ask")
        expect(bash[`${command} * ${file} *`]).toBe("ask")
        expect(resolve(`${command} ${file}`)).toBe("allow")
      }
      expect(bash[`${command} * *.env`]).toBe("ask")
      expect(bash[`${command} * *.env.*`]).toBe("ask")
      expect(bash[`${command} * */.env *`]).toBe("ask")
      expect(bash[`${command} * */.env.* *`]).toBe("ask")
      // A nested name in a middle position is gated, while an ordinary search
      // term that merely mentions `process.env` stays allowed.
      expect(resolve(`${command} KEY config/.env src/`)).toBe("ask")
      expect(resolve(`${command} -n process.env src/`)).toBe("allow")
      expect(bash[`${command} .env.example`]).toBe("allow")
      // A sample allow carries no wildcard before the sample name, and the
      // searcher stays name-anchored: a lone search term that merely contains
      // `.env` is not gated, so no `cmd *.env` form exists to catch it.
      expect(bash[`${command} *.env.example`]).toBeUndefined()
      expect(bash[`${command} * .env.example`]).toBeUndefined()
      expect(bash[`${command} */.env.example`]).toBeUndefined()
      expect(bash[`${command} *.env`]).toBeUndefined()
      expect(resolve(`${command} process.env`)).toBe("allow")
    }
    expect(bash["printenv *"]).toBe("ask")
    // A stream filter's input redirect follows the same rule, and the
    // trailing-operand suffix form covers a bare search term as well.
    expect(bash["tr *<*.env*"]).toBe("ask")
    expect(resolve("tr -d ',' < .env")).toBe("ask")
    expect(resolve("tr -d ',' < notes.txt")).toBe("allow")
    expect(resolve("rg -n process.env")).toBe("ask")
    expect(resolve("cat .env")).toBe("ask")
    expect(resolve("cat prod.env")).toBe("ask")
    expect(resolve("cat config/prod.env")).toBe("ask")
    expect(resolve(`cat ".env"`)).toBe("ask")
    for (const command of [
      "touch *",
      "mkdir *",
      "cp *",
      "mv *",
      "sort *",
      "tsc *",
      "tsgo *",
      "tar *",
      "unzip *",
      "gzip *",
      "gunzip *",
    ]) {
      expect(command in bash).toBe(false)
    }
    expect("git diff *" in bash).toBe(false)
    expect(WORK_STYLE_PRESETS["human-in-the-loop"].settings).toEqual({
      showTaskTimeline: true,
      showAutoApprovalReason: true,
    })
  })

  it("does not loosen permissions for high autonomy", () => {
    const cfg = WORK_STYLE_PRESETS.autonomous.config
    expect(cfg.terminal_command_display).toBe("collapsed")
    expect(cfg.reasoning_display).toBe("preview")
    expect(cfg.permission).toBeUndefined()
    expect(WORK_STYLE_PRESETS.autonomous.settings).toEqual({
      showTaskTimeline: true,
      showAutoApprovalReason: false,
    })
  })

  it("never defines a top-level permission choice in onboarding presets", () => {
    for (const preset of Object.values(WORK_STYLE_PRESETS)) {
      expect(["ask", "allow", "deny"]).not.toContain(preset.config.permission?.["*"])
    }
  })

  it("does not overwrite existing new-user settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "human-in-the-loop",
      config: {
        permission: { edit: "allow" },
        terminal_command_display: "collapsed",
        reasoning_display: "headline",
        code_edit_display: "collapsed",
        mcp_tool_display: "expanded",
      },
      settingDefault: () => false,
    })
    expect(plan).toEqual({ config: {}, settings: {} })
  })

  it.each([false, true])("respects legacy auto_collapse_reasoning=%s", (legacy) => {
    const plan = buildWorkStyleApplyPlan({
      style: "autonomous",
      config: { auto_collapse_reasoning: legacy },
      settingDefault: () => false,
    })
    expect(plan.config.reasoning_display).toBeUndefined()
  })

  it.each(["human-in-the-loop", "autonomous"] as const)("limits the %s display preset to display fields", (style) => {
    const human = style === "human-in-the-loop"
    const preset = getDisplayPreset(style)
    expect(preset).toEqual({
      config: {
        reasoning_display: human ? "expanded" : "preview",
        terminal_command_display: human ? "expanded" : "collapsed",
        code_edit_display: human ? "expanded" : "collapsed",
        mcp_tool_display: "collapsed",
      },
      settings: { showAutoApprovalReason: human },
    })
    const plan = buildWorkStyleApplyPlan({ style, config: {} })
    expect(plan).toEqual({
      config: { ...preset.config, ...(human ? { permission: WORK_STYLE_PRESETS[style].config.permission } : {}) },
      settings: { ...preset.settings, showTaskTimeline: true },
    })
  })

  it("only fills unset config fields and default extension settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "autonomous",
      config: { code_edit_display: "expanded", mcp_tool_display: "expanded" },
      settingDefault: (key) => key === "showAutoApprovalReason",
    })
    expect(plan).toEqual({
      config: { terminal_command_display: "collapsed", reasoning_display: "preview" },
      settings: { showAutoApprovalReason: false },
    })
  })
})
