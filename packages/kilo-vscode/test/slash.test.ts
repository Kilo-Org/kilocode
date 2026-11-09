import { describe, expect, test } from "bun:test"
import type { CommandInfo, ModelRef, SkillInfo } from "@opencode/client"
import { matchSlash, mergeCatalog, parseSlash, slashQuery, type SlashEntry } from "../webview-ui/src/v2/slash"
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

  test("an action hides a server command of the same name", () => {
    const list = mergeCatalog({ actions: [action("init")], commands, skills: [] })
    expect(list.filter((entry) => entry.name === "init").map((entry) => entry.kind)).toEqual(["action"])
  })

  test("drops nested entries without their parent command", () => {
    const children = [action("review staged"), action("memory show")]
    expect(names(mergeCatalog({ actions: children, commands, skills: [] }))).toContain("review staged")
    expect(names(mergeCatalog({ actions: children, commands, skills: [] }))).not.toContain("memory show")
    expect(names(mergeCatalog({ actions: children, commands: [], skills: [] }))).toEqual([])
  })
})

describe("slash matching", () => {
  const entries = mergeCatalog({
    actions: [action("new", ["clear"]), action("review staged"), action("review quick", ["fast"])],
    commands,
    skills: [skill("reviewer", "second opinion"), skill("pdf", "read a deploy log")],
  })

  test("an empty query lists every root entry in group order", () => {
    expect(names(matchSlash(entries, ""))).toEqual(["new", "init", "review", "deploy", "reviewer", "pdf"])
  })

  test("ranks exact, prefix, substring and description or hint matches within each group", () => {
    expect(names(matchSlash(entries, "review"))).toEqual(["review", "reviewer"])
    expect(names(matchSlash(entries, "dep"))).toEqual(["deploy", "pdf"])
    expect(names(matchSlash(entries, "CLEAR"))).toEqual(["new"])
  })

  test("a nested query lists the children of its command", () => {
    expect(names(matchSlash(entries, "review "))).toEqual(["review staged", "review quick"])
    expect(names(matchSlash(entries, "review q"))).toEqual(["review quick"])
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

  const deps = (current: ModelRef | undefined, selected: ModelRef | undefined = high) => {
    const calls: unknown[] = []
    const value: SlashDeps = {
      session: async () => "ses_1",
      current: () => current,
      selected,
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
    const run = deps(high)
    const files = [{ uri: "file:///a.ts", name: "a.ts" }]
    await dispatchSlash({ entry: entry("review"), args: "staged", files, delivery: "queue" }, run.value)
    expect(run.calls).toEqual([
      ["command", { sessionID: "ses_1", name: "review", text: "staged", files, delivery: "queue" }],
    ])
  })

  test("applies the selected model with its variant before a command without a model", async () => {
    const run = deps({ providerID: "kilo", id: "claude" })
    await dispatchSlash({ entry: entry("init"), args: "" }, run.value)
    expect(run.calls).toEqual([
      ["switchModel", high],
      ["command", { sessionID: "ses_1", name: "init", text: "", files: undefined, delivery: undefined }],
    ])
  })

  test("sends the default variant explicitly and leaves a command with its own model to the server", async () => {
    const plain = deps(high, { providerID: "kilo", id: "claude" })
    await dispatchSlash({ entry: entry("init"), args: "" }, plain.value)
    expect(plain.calls[0]).toEqual(["switchModel", { providerID: "kilo", id: "claude", variant: "default" }])
    const own = deps({ providerID: "kilo", id: "claude" })
    await dispatchSlash({ entry: entry("fast"), args: "" }, own.value)
    expect(own.calls.map((call) => (call as unknown[])[0])).toEqual(["command"])
  })

  test("runs a skill as a prompt that attaches it under its slash name", async () => {
    const run = deps(high)
    await dispatchSlash({ entry: entry("pdf"), args: "summarize" }, run.value)
    expect(run.calls).toEqual([
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

  test("runs a client action in the webview without a session", async () => {
    const ran: string[] = []
    const run = deps(high)
    run.value.session = async () => {
      throw new Error("no session for an action")
    }
    await dispatchSlash({ entry: action("models", [], () => ran.push("models")), args: "" }, run.value)
    expect(ran).toEqual(["models"])
    expect(run.calls).toEqual([])
  })
})
