import { afterEach, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Filesystem } from "../../src/util/filesystem"
import {
  disposeAllInstances,
  provideInstance,
  provideTestInstance,
  testInstanceStoreLayer,
  tmpdir,
} from "../fixture/fixture"

function load(dir: string) {
  return Effect.runPromise(
    provideInstance(dir)(Agent.Service.use((svc) => svc.get("architect"))).pipe(
      Effect.provide(Agent.defaultLayer),
      Effect.provide(testInstanceStoreLayer),
    ),
  )
}

afterEach(async () => {
  await disposeAllInstances()
})

test("config subagent routing survives a colliding primary agent markdown file", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        architect: {
          mode: "subagent",
          model: "test/configured-subagent",
        },
      },
    },
  })
  await Filesystem.write(
    path.join(tmp.path, ".kilo", "agents", "architect.md"),
    [
      "---",
      "mode: primary",
      "description: Marketplace architect",
      "---",
      "",
      "You are the marketplace architect.",
    ].join("\n"),
  )

  const item = await provideTestInstance({
    directory: tmp.path,
    fn: () => load(tmp.path),
  })

  expect(item?.mode).toBe("subagent")
  expect(String(item?.model?.providerID)).toBe("test")
  expect(String(item?.model?.modelID)).toBe("configured-subagent")
  expect(item?.description).toBe("Marketplace architect")
})

test("config-only custom agent keeps its default all mode across a primary collision", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        architect: {
          model: "test/configured-subagent",
        },
      },
    },
  })
  await Filesystem.write(
    path.join(tmp.path, ".kilo", "agents", "architect.md"),
    ["---", "mode: primary", "---", "", "You are the marketplace architect."].join("\n"),
  )

  const item = await provideTestInstance({
    directory: tmp.path,
    fn: () => load(tmp.path),
  })

  expect(item?.mode).toBe("all")
  expect(String(item?.model?.providerID)).toBe("test")
  expect(String(item?.model?.modelID)).toBe("configured-subagent")
})

test("higher-priority markdown can override lower-priority markdown routing", async () => {
  await using tmp = await tmpdir()
  const project = path.join(tmp.path, "project")
  const global = path.join(tmp.path, "global")
  await Filesystem.write(
    path.join(global, "agents", "architect.md"),
    ["---", "mode: subagent", "description: Lower-priority architect", "---"].join("\n"),
  )
  await Filesystem.write(
    path.join(project, ".kilo", "agents", "architect.md"),
    ["---", "mode: primary", "description: Higher-priority architect", "---"].join("\n"),
  )

  const previous = Global.Path.config
  ;(Global.Path as { config: string }).config = global
  try {
    const item = await provideTestInstance({
      directory: project,
      fn: () => load(project),
    })

    expect(item?.mode).toBe("primary")
    expect(item?.description).toBe("Higher-priority architect")
  } finally {
    ;(Global.Path as { config: string }).config = previous
  }
})
