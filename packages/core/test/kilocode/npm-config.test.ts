import path from "path"
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { tmpdir } from "../fixture/tmpdir"

async function probe(agent?: string, npmrc?: string, lifecycle = false) {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "user.npmrc"), "")
  await Bun.write(path.join(tmp.path, "global.npmrc"), "")
  await Bun.write(path.join(tmp.path, ".npmrc"), npmrc ?? "registry=https://registry.example.test/\n")
  await Bun.write(
    path.join(tmp.path, "package.json"),
    JSON.stringify({
      name: "npm-config-fixture",
      version: "1.0.0",
      private: true,
      scripts: lifecycle ? { preinstall: "bun ./observe.ts" } : undefined,
    }),
  )
  await Bun.write(
    path.join(tmp.path, "observe.ts"),
    'await Bun.write("observed.json", JSON.stringify(process.env.npm_config_user_agent ?? null))',
  )
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"].map((key) => [key, process.env[key]]),
    ),
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: tmp.path,
    USERPROFILE: tmp.path,
    XDG_CONFIG_HOME: path.join(tmp.path, "config"),
    XDG_CACHE_HOME: path.join(tmp.path, "cache"),
    XDG_DATA_HOME: path.join(tmp.path, "data"),
    npm_config_userconfig: path.join(tmp.path, "user.npmrc"),
    npm_config_globalconfig: path.join(tmp.path, "global.npmrc"),
    npm_config_cache: path.join(tmp.path, "npm-cache"),
    BUN_INSTALL_CACHE_DIR: path.join(tmp.path, "bun-cache"),
    ...(agent === undefined ? {} : { npm_config_user_agent: agent }),
  }
  const code = `
    import { Effect } from "effect"
    import { NpmConfig } from "./src/npm-config.ts"
    const dir = ${JSON.stringify(tmp.path)}
    const config = await Effect.runPromise(NpmConfig.load(dir))
    const agent = process.env.npm_config_user_agent ?? null
    const observed = ${lifecycle} ? await (async () => {
      const child = Bun.spawnSync([process.execPath, "install", "--no-progress"], {
        cwd: dir, stdout: "pipe", stderr: "pipe",
      })
      if (child.exitCode !== 0) throw new Error(child.stderr.toString())
      return Bun.file(dir + "/observed.json").json()
    })() : null
    console.log(JSON.stringify({ agent, config, observed }))
  `
  const child = Bun.spawn([process.execPath, "--eval", code], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, err }).toEqual({ exit: 0, err: "" })
  return z
    .object({
      agent: z.string().nullable(),
      config: z.record(z.string(), z.unknown()),
      observed: z.string().nullable(),
    })
    .parse(JSON.parse(out))
}

describe("npm configuration environment isolation", () => {
  test.each([undefined, "", "bun/fixture"])("preserves the parent user-agent %p", async (agent) => {
    const result = await probe(agent)
    expect(result.agent).toBe(agent ?? null)
    expect(result.config.registry).toBe("https://registry.example.test/")
    expect(typeof result.config.userAgent).toBe("string")
  })

  test("retains explicit user-agent options without replacing the parent's value", async () => {
    const result = await probe(undefined, "user-agent=registry-client/fixture\n")
    expect(result.agent).toBeNull()
    expect(result.config.userAgent).toBe("registry-client/fixture")
  })

  test("lets a subsequent Bun lifecycle script identify its package manager", async () => {
    const result = await probe(undefined, undefined, true)
    expect(result.observed).toStartWith("bun/")
  })
})
