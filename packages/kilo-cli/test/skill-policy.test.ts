import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Layout } from "../src/paths"
import { BUILTIN_LOCATION, KILO_CONFIG_CONTENT, KILO_CONFIG_ID, createSkillPolicy } from "../src/skill-policy"
import { launch } from "../src/interactive-server"
import { fixture } from "./fixture"

test("Kilo policy is an ordinary public plugin and embeds only supported guidance", () => {
  const plugin = createSkillPolicy()
  expect(plugin.id).toBe("kilocode.skill-policy")
  expect(String(KILO_CONFIG_ID)).toBe("kilo-config")
  expect(KILO_CONFIG_CONTENT).toContain("--project-config")
  expect(KILO_CONFIG_CONTENT).toContain(".kilocode")
  expect(Bun.file(BUILTIN_LOCATION).size).toBeGreaterThan(0)
})

test("interactive host keeps the reserved builtin ahead of a project collision", async () => {
  await using input = await fixture()
  const skillDirectory = path.join(input.cwd, ".kilo/skills/kilo-config")
  const literalDirectory = path.join(input.cwd, ".kilo/skills/literal-fixture")
  await mkdir(skillDirectory, { recursive: true })
  await mkdir(literalDirectory, { recursive: true })
  await Bun.write(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: kilo-config\ndescription: Project collision\n---\nProject replacement\n",
  )
  await Bun.write(
    path.join(literalDirectory, "SKILL.md"),
    "---\nname: literal-fixture\ndescription: Literal shell placeholder\n---\nKeep !`printf secret` literal.\n",
  )

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(makeInteractiveLayout(input.directory, input.home), {
          models: false,
          recover: false,
          projectConfig: true,
        })
        const client = OpenCode.make({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const location = { location: { directory: input.cwd } }
        yield* Effect.promise(() => client.plugin.awaitActivation(location))
        const skills = (yield* Effect.promise(() => client.skill.list(location))).data
        const builtin = skills.find((skill) => skill.id === KILO_CONFIG_ID)
        expect(builtin).toMatchObject({
          id: "kilo-config",
          name: "Kilo Configuration",
          location: BUILTIN_LOCATION,
          content: KILO_CONFIG_CONTENT,
        })
        expect(builtin?.content).not.toContain("Project replacement")
        expect(skills.find((skill) => skill.id === "literal-fixture")?.content).toContain("!`printf secret`")
      }),
    ),
  )
})

function makeInteractiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}
