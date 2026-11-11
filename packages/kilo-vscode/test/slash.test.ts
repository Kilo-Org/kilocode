import { describe, expect, test } from "bun:test"
import type { CommandInfo, ModelRef, SkillInfo } from "@opencode/client"
import { matchSlash, mergeCatalog, parseSlash, slashQuery, type SlashEntry } from "../webview-ui/src/v2/slash"
import { createModelDrafts } from "../webview-ui/src/v2/model-draft"
import { reviewScopes, slashActions } from "../webview-ui/src/v2/slash-actions"
import { createSlashCatalog } from "../webview-ui/src/v2/slash-catalog"
import { dispatchSlash, type SlashDeps } from "../webview-ui/src/v2/slash-dispatch"

const skill = (name: string, description?: string): SkillInfo => ({
  id: `skill-${name}`,
  name,
  description,
  path: `/skills/${name}/SKILL.md`,
  content: "",
})

const action = (name: string, hints: string[] = [], run = () => {}): SlashEntry => ({
  kind: "action",
  name,
  description: `${name} action`,
  hints,
  run,
})

const commands: CommandInfo[] = [
  { name: "init", description: "guided AGENTS.md setup" },
  { name: "review", description: "review changes" },
  { name: "deploy", description: "ship the build" },
]

const names = (list: SlashEntry[]) => list.map((entry) => entry.name)

describe("slash catalog merge", () => {
  test("orders actions, commands and skills, and suffixes a skill whose name is taken", () => {
    const list = mergeCatalog({
      actions: [action("new")],
      commands,
      skills: [skill("review"), skill("new"), skill("pdf")],
    })
    expect(names(list)).toEqual(["new", "init", "review", "deploy", "review:skill", "new:skill", "pdf"])
  })

  test("a suffixed skill name never collides with a command of that name", () => {
    const list = mergeCatalog({
      actions: [],
      commands: [{ name: "foo" }, { name: "foo:skill" }],
      skills: [skill("foo")],
    })
    expect(names(list)).toEqual(["foo", "foo:skill", "foo:skill2"])
    expect(parseSlash(list, "/foo:skill2")?.entry.kind).toBe("skill")
  })

  test("an action hides a server command of the same name", () => {
    const list = mergeCatalog({ actions: [action("init")], commands, skills: [] })
    expect(list.filter((entry) => entry.name === "init").map((entry) => entry.kind)).toEqual(["action"])
  })

  test("lists review scopes only under a review command, and worktree only for a worktree", () => {
    const local = reviewScopes(commands, false)
    expect(names(local)).toEqual([
      "review uncommitted",
      "review staged",
      "review unpushed",
      "review branch",
      "review quick",
    ])
    expect(names(reviewScopes(commands, true))[0]).toBe("review worktree")
    expect(reviewScopes([], true)).toEqual([])
    const orphan = [action("memory show")]
    expect(names(mergeCatalog({ actions: orphan, commands, nested: local, skills: [] }))).not.toContain("memory show")
    expect(names(mergeCatalog({ actions: [], commands, nested: local, skills: [] }))).toContain("review staged")
  })
})

describe("slash actions", () => {
  test("lists only the actions this surface handles, in menu order", () => {
    const list = slashActions({ reload: () => {}, new: () => {}, compact: undefined }, (key) => `t:${key}`)
    expect(list.map((entry) => [entry.name, entry.description, entry.hints])).toEqual([
      ["new", "t:command.session.new", ["clear"]],
      ["reload", "t:common.reloadDescription", ["refresh"]],
    ])
  })

  test("offers caffeinate with the shared Keep Awake description and the TUI alias", () => {
    const calls: number[] = []
    const list = slashActions({ caffeinate: () => calls.push(1) }, (key) => `t:${key}`)
    expect(list.map((entry) => [entry.name, entry.description, entry.hints])).toEqual([
      ["caffeinate", "t:agentManager.caffeination.toggle", ["caffenate", "keep-awake", "awake", "sleep"]],
    ])
    expect(parseSlash(list, "/caffeinate")?.entry.name).toBe("caffeinate")
    expect(parseSlash(list, "/caffenate")?.entry.name).toBe("caffeinate")
    const entry = list[0]
    if (entry?.kind === "action") entry.run()
    expect(calls).toEqual([1])
  })
})

describe("slash matching", () => {
  const entries = mergeCatalog({
    actions: [action("new", ["clear"])],
    commands,
    nested: reviewScopes(commands, false).filter((entry) => /staged|quick/.test(entry.name)),
    skills: [skill("reviewer", "second opinion"), skill("pdf", "read a deploy log")],
  })

  test("an empty query lists every root entry in group order", () => {
    expect(names(matchSlash(entries, ""))).toEqual(["new", "init", "review", "deploy", "reviewer", "pdf"])
  })

  test("ranks exact before prefix before substring before description or hint within one group", () => {
    const list = mergeCatalog({
      actions: [],
      commands: [
        { name: "recommit", description: "" },
        { name: "notes", description: "commit notes" },
        { name: "commit-all", description: "" },
        { name: "commit", description: "" },
      ],
      skills: [],
    })
    expect(names(matchSlash(list, "commit"))).toEqual(["commit", "commit-all", "recommit", "notes"])
    expect(names(matchSlash(list, "COMMIT"))).toEqual(["commit", "commit-all", "recommit", "notes"])
  })

  test("keeps the group order across ranks", () => {
    expect(names(matchSlash(entries, "review"))).toEqual(["review", "reviewer"])
    expect(names(matchSlash(entries, "dep"))).toEqual(["deploy", "pdf"])
    expect(names(matchSlash(entries, "CLEAR"))).toEqual(["new"])
  })

  test("a nested query lists the children of its command", () => {
    expect(names(matchSlash(entries, "review "))).toEqual(["review staged", "review quick"])
    expect(names(matchSlash(entries, "review q"))).toEqual(["review quick"])
    expect(names(matchSlash(entries, "review fast"))).toEqual(["review quick"])
    expect(slashQuery(entries, "/review --quick")).toBe("review --quick")
    // Only a root entry matches its description, so free guidance typed after a command keeps the menu closed.
    const described = mergeCatalog({
      actions: [],
      commands,
      nested: [
        {
          kind: "command",
          name: "review branch",
          description: "Review the current branch",
          hints: [],
          command: commands[1]!,
        },
      ],
      skills: [],
    })
    expect(slashQuery(described, "/review the")).toBeUndefined()
  })

  test("opens at a leading slash and for a command with matching children", () => {
    expect(slashQuery(entries, "/")).toBe("")
    expect(slashQuery(entries, "/rev")).toBe("rev")
    expect(slashQuery(entries, "/review st")).toBe("review st")
    expect(slashQuery(entries, "/review focus on tests")).toBeUndefined()
    expect(slashQuery(entries, "/init now")).toBeUndefined()
    expect(slashQuery(entries, "say /init")).toBeUndefined()
  })

  test("a sent draft resolves by exact name before an action hint", () => {
    expect(parseSlash(entries, "/review branch main")).toMatchObject({ entry: { name: "review" }, args: "branch main" })
    expect(parseSlash(entries, "/clear")).toMatchObject({ entry: { name: "new", kind: "action" }, args: "" })
    expect(parseSlash(entries, "/pdf:skill")).toBeUndefined()
    expect(parseSlash(entries, "/usr/bin is a path")).toBeUndefined()
    const clash = mergeCatalog({ actions: [action("new")], commands, skills: [skill("init")] })
    expect(parseSlash(clash, "/init:skill fix")).toMatchObject({ entry: { kind: "skill", name: "init:skill" } })
  })
})

describe("slash catalog refresh", () => {
  const resource = <T>(items: T[]) => {
    const state = { items, calls: [] as string[] }
    return {
      state,
      list: () => state.items,
      sync: async () => void state.calls.push("sync"),
      invalidate: () => void state.calls.push("invalidate"),
    }
  }

  test("reloads skills on command.updated and both lists on config.updated once loaded", async () => {
    const handlers = new Map<string, () => void>()
    const command = resource<CommandInfo>(commands)
    const skills = resource<SkillInfo>([skill("pdf")])
    const catalog = createSlashCatalog({
      command,
      skill: skills,
      on: (type, handler) => {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
      report: () => {},
    })
    handlers.get("config.updated")?.()
    expect(command.state.calls).toEqual(["invalidate"])
    await catalog.load()
    expect(names(mergeCatalog({ actions: [], commands: catalog.commands(), skills: catalog.skills() }))).toContain(
      "pdf",
    )
    command.state.calls = []
    skills.state.calls = []
    handlers.get("command.updated")?.()
    await Promise.resolve()
    expect(command.state.calls).toEqual([])
    expect(skills.state.calls).toEqual(["invalidate", "sync"])
    handlers.get("config.updated")?.()
    await Promise.resolve()
    expect(command.state.calls).toEqual(["invalidate", "sync"])
    catalog.dispose()
    expect(handlers.size).toBe(0)
  })
})

describe("slash dispatch", () => {
  const high: ModelRef = { providerID: "kilo", id: "claude", variant: "high" }

  const deps = (selected: ModelRef | undefined = high) => {
    const calls: unknown[] = []
    const value: SlashDeps = {
      session: async () => "ses_1",
      selected: () => selected,
      switchModel: async (input) => void calls.push(["switchModel", input.model]),
      command: async (input) => void calls.push(["command", input]),
      prompt: async (input) => void calls.push(["prompt", input]),
    }
    return { calls, value }
  }
  const entries = mergeCatalog({
    actions: [],
    commands: [...commands, { name: "fast", model: { providerID: "kilo", model: "mini" } }],
    skills: [skill("pdf")],
  })
  const entry = (name: string) => entries.find((item) => item.name === name)!

  test("runs a server command with its text, files and delivery on the session", async () => {
    const run = deps()
    const files = [{ uri: "file:///a.ts", name: "a.ts" }]
    await dispatchSlash({ entry: entry("review"), args: "staged", files, delivery: "queue" }, run.value)
    expect(run.calls).toEqual([
      ["switchModel", high],
      ["command", { sessionID: "ses_1", name: "review", text: "staged", files, delivery: "queue" }],
    ])
  })

  test("sends the default variant explicitly and leaves a command with its own model to the server", async () => {
    const plain = deps({ providerID: "kilo", id: "claude" })
    await dispatchSlash({ entry: entry("init"), args: "" }, plain.value)
    expect(plain.calls[0]).toEqual(["switchModel", { providerID: "kilo", id: "claude", variant: "default" }])
    const own = deps()
    await dispatchSlash({ entry: entry("fast"), args: "" }, own.value)
    expect(own.calls.map((call) => (call as unknown[])[0])).toEqual(["command"])
  })

  test("runs on the composer's uncommitted effort, not the one the session stores", async () => {
    // Shift+Tab moved the composer to high; the session reports low until a send commits the draft.
    const low: ModelRef = { providerID: "kilo", id: "claude", variant: "low" }
    const drafts = createModelDrafts()
    drafts.set("ses_1", high)
    const run = deps()
    run.value.selected = (id) => drafts.get(id) ?? low
    await dispatchSlash({ entry: entry("init"), args: "" }, run.value)
    expect(run.calls[0]).toEqual(["switchModel", high])
  })

  test("a review scope runs the review command with the scope as its first argument", async () => {
    const run = deps()
    const scope = reviewScopes(commands, true).find((item) => item.name === "review worktree")!
    await dispatchSlash({ entry: scope, args: "focus on tests" }, run.value)
    expect(run.calls).toEqual([
      ["switchModel", high],
      [
        "command",
        { sessionID: "ses_1", name: "review", text: "worktree focus on tests", files: undefined, delivery: undefined },
      ],
    ])
  })

  test("runs a skill as a prompt that attaches it under its slash name", async () => {
    const run = deps()
    await dispatchSlash({ entry: entry("pdf"), args: "summarize" }, run.value)
    expect(run.calls).toEqual([
      ["switchModel", high],
      [
        "prompt",
        {
          sessionID: "ses_1",
          text: "/pdf summarize",
          files: undefined,
          skills: [{ id: "skill-pdf", mention: { start: 0, end: 4, text: "/pdf" } }],
          delivery: undefined,
        },
      ],
    ])
  })

  test("runs a client action from the registry in the webview without a session", async () => {
    const ran: string[] = []
    const run = deps()
    run.value.session = async () => {
      throw new Error("no session for an action")
    }
    const actions = slashActions({ models: () => ran.push("models") }, (key) => key)
    await dispatchSlash({ entry: actions[0], args: "" }, run.value)
    expect(ran).toEqual(["models"])
    expect(run.calls).toEqual([])
  })
})
