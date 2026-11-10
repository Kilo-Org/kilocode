import { expect, test } from "bun:test"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Tool } from "@opencode/schema/tool"
import { DateTime } from "effect"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { PlanFile } from "../src/plan/plan-file"
import { created, workspace } from "./plan-harness"

const session = { time: { created, updated: created } }

function write(file: string, agent = "plan"): SessionMessage.Info {
  return {
    id: SessionMessage.ID.create(),
    time: { created },
    type: "assistant",
    agent: Agent.ID.make(agent),
    model: { id: Model.ID.make("m"), providerID: Provider.ID.make("p") },
    content: [
      {
        type: "tool",
        id: Tool.CallID.make("call-write"),
        name: "write",
        time: { created },
        state: { status: "completed", input: { path: file }, content: [{ type: "text", text: "done" }], metadata: {} },
      },
    ],
  }
}

test("a version-controlled project keeps plans in .kilo2/plans, other directories in the Kilo data directory", async () => {
  const space = await workspace()
  try {
    expect(PlanFile.directory(space.location, space.data)).toBe(path.join(space.project, ".kilo2", "plans"))
    // A plain directory has a hashed project ID, an unidentified repository the global one: only the marker counts.
    const plain = path.join(space.root, "plain")
    await mkdir(plain)
    const scratch = new Location.Info({
      directory: AbsolutePath.make(plain),
      project: { id: Project.ID.make("prj_hashed"), directory: AbsolutePath.make(plain), canonical: AbsolutePath.make(plain) },
    })
    expect(PlanFile.directory(scratch, space.data)).toBe(path.join(space.data, "plans"))
    const unidentified = new Location.Info({ ...space.location, project: { ...space.location.project, id: Project.ID.global } })
    expect(PlanFile.directory(unidentified, space.data)).toBe(path.join(space.project, ".kilo2", "plans"))
    expect(PlanFile.defaultPath(session, space.location, space.data)).toBe(
      path.join(space.project, ".kilo2", "plans", `${DateTime.toEpochMillis(created)}-plan.md`),
    )
  } finally {
    await space.dispose()
  }
})

test("a named path must be a file in the workspace, the project or the plan directory", async () => {
  const space = await workspace()
  try {
    expect(PlanFile.resolve(".kilo2/plans/new.md", space.location, space.data)).toBe(
      path.join(space.project, ".kilo2", "plans", "new.md"),
    )
    expect(PlanFile.resolve(path.join(space.root, "elsewhere.md"), space.location, space.data)).toBeUndefined()
    expect(PlanFile.resolve(".kilo2/plans", space.location, space.data)).toBeUndefined()
  } finally {
    await space.dispose()
  }
})

test("a newer generated plan wins over a stale exact target", async () => {
  const space = await workspace()
  try {
    const target = path.join(space.project, ".kilo2", "plans", "1000-plan.md")
    await Bun.write(target, "Stale plan")
    await Bun.sleep(20)
    const fresh = path.join(space.project, ".kilo2", "plans", "1000-refined-plan.md")
    await Bun.write(fresh, "Fresh plan")
    expect(PlanFile.locate(target, [], space.location, space.data)).toBe(fresh)
  } finally {
    await space.dispose()
  }
})

test("the plan a planning message wrote is found when the name has another prefix", async () => {
  const space = await workspace()
  try {
    const file = path.join(space.project, "plans", "dark-mode.md")
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, "# Plan")
    const target = path.join(space.project, ".kilo2", "plans", "2000-plan.md")
    expect(PlanFile.locate(target, [write("plans/dark-mode.md")], space.location, space.data)).toBe(file)
    expect(PlanFile.locate(target, [write("plans/dark-mode.md", "code")], space.location, space.data)).toBeUndefined()
  } finally {
    await space.dispose()
  }
})

test("an unrelated plan of another session or project is never picked", async () => {
  const space = await workspace()
  try {
    await mkdir(path.join(space.data, "plans"), { recursive: true })
    await Bun.write(path.join(space.data, "plans", "9999-other-project-plan.md"), "# Other")
    const target = path.join(space.project, ".kilo2", "plans", "2000-plan.md")
    expect(PlanFile.locate(target, [], space.location, space.data)).toBeUndefined()
  } finally {
    await space.dispose()
  }
})

test("a session opened through a symlinked directory displays the plan relative to its workspace", async () => {
  const space = await workspace()
  try {
    const link = path.join(space.root, "link")
    await symlink(space.project, link)
    const location = new Location.Info({ ...space.location, directory: AbsolutePath.make(link) })
    const file = path.join(space.project, ".kilo2", "plans", "1000-dark-mode-plan.md")
    expect(PlanFile.display(file, location)).toBe(".kilo2/plans/1000-dark-mode-plan.md")
  } finally {
    await space.dispose()
  }
})

test("a subdirectory session displays and resolves the plan relative to its own workspace", async () => {
  const space = await workspace()
  try {
    const directory = path.join(space.project, "packages", "app")
    const location = new Location.Info({ ...space.location, directory: AbsolutePath.make(directory) })
    const file = path.join(space.project, ".kilo2", "plans", "1000-dark-mode-plan.md")
    expect(PlanFile.display(file, location)).toBe("../../.kilo2/plans/1000-dark-mode-plan.md")
    expect(PlanFile.resolve("../../.kilo2/plans/1000-dark-mode-plan.md", location, space.data)).toBe(file)
  } finally {
    await space.dispose()
  }
})
