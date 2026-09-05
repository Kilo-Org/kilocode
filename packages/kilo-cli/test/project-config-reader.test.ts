import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Layer } from "effect"
import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readProjectEntries } from "../src/project-config"

test("reads current and v1 markdown agents without following links outside the project", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "kilo-project-config-reader-"))
  try {
    await Promise.all([
      mkdir(path.join(project, ".kilo/agents/team"), { recursive: true }),
      mkdir(path.join(project, ".kilocode/agents"), { recursive: true }),
      mkdir(path.join(project, ".kilo/skills/local"), { recursive: true }),
    ])
    await Bun.write(
      path.join(project, ".kilo/agents/team/native.md"),
      "---\ndescription: Native markdown agent\nmode: subagent\n---\nNative instructions\n",
    )
    await Bun.write(
      path.join(project, ".kilocode/agents/legacy.md"),
      "---\nmodel: anthropic/claude-sonnet\ndescription: V1 markdown agent\ntools:\n  edit: false\n---\nV1 instructions\n",
    )
    await Bun.write(path.join(project, ".kilocode/agents/malformed.md"), "---\ndescription: 123\n---\nIgnored\n")
    const outside = await mkdtemp(path.join(os.tmpdir(), "kilo-project-config-outside-"))
    try {
      await Bun.write(path.join(outside, "linked.md"), "---\ndescription: Outside markdown agent\n---\nMust not load\n")
      await symlink(path.join(outside, "linked.md"), path.join(project, ".kilo/agents/linked.md"))

      const entries = await Effect.runPromise(
        readProjectEntries(project, project).pipe(
          Effect.provide(FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))),
        ),
      )
      const documents = entries.filter((entry) => entry.type === "document")
      const native = documents.find((entry) => entry.path?.endsWith("team/native.md"))
      const legacy = documents.find((entry) => entry.path?.endsWith("agents/legacy.md"))
      expect(native?.info.agents?.["team/native"]).toMatchObject({
        description: "Native markdown agent",
        mode: "subagent",
        system: "Native instructions",
      })
      expect(legacy?.info.agents?.legacy).toMatchObject({
        description: "V1 markdown agent",
        model: { providerID: "anthropic", model: "claude-sonnet" },
      })
      expect(documents.some((entry) => entry.path?.endsWith("malformed.md"))).toBe(false)
      expect(documents.some((entry) => entry.path?.endsWith("linked.md"))).toBe(false)
      expect(entries.some((entry) => entry.type === "agents")).toBe(true)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
