import { expect, test } from "bun:test"
import { $ } from "bun"
import { resolve } from "node:path"
import { directories, environment } from "../../script/response-lens-environment"

test("candidate build never inherits user accounts or configuration", () => {
  const root = resolve(".kilo-dev/build/test")
  const compiler = resolve("tools/bun.exe")
  const input = {
    PATH: "system-path",
    HOME: "real-home",
    USERPROFILE: "real-profile",
    XDG_DATA_HOME: "real-data",
    CODEX_HOME: "real-codex",
    KILO_CONFIG: "private-config",
    KILO_CONFIG_CONTENT: "private-config-values",
    KILO_RELEASE: "true",
    GH_TOKEN: "private-github",
    OPENAI_API_KEY: "private-provider",
    KILO_TOKEN: "private-account",
    HTTPS_PROXY: "private-proxy",
  }
  const env = environment(root, compiler, "7.5.16-snapshot.test", input)
  for (const key of ["GH_TOKEN", "OPENAI_API_KEY", "KILO_TOKEN", "KILO_CONFIG", "HTTPS_PROXY"])
    expect(key in env).toBe(false)
  expect(JSON.stringify(env)).not.toContain("private-")
  expect(env.HOME).toBe(resolve(root, "home"))
  expect(env.XDG_DATA_HOME).toBe(resolve(root, "data"))
  expect(env.CODEX_HOME).toBe(resolve(root, "codex"))
  expect(env.KILO_RELEASE).toBe("")
  expect(env.KILO_LOCAL_PACKAGE).toBe("1")
  expect(env.KILO_VERSION).toBe("7.5.16-snapshot.test")
  expect(JSON.parse(env.KILO_CONFIG_CONTENT)).toMatchObject({ mcp: {}, enabled_providers: [], autoupdate: false })
  expect(directories(root).every((dir) => dir.startsWith(root))).toBe(true)
})

test("build subprocess receives the isolated environment, not parent secrets", async () => {
  const key = "RESPONSE_LENS_PARENT_SENTINEL"
  const previous = process.env[key]
  process.env[key] = "synthetic-do-not-inherit"
  try {
    const env = environment(resolve(".kilo-dev/build/test"), process.execPath, "7.5.16-snapshot.test")
    const script = `process.stdout.write(JSON.stringify({leak: !!process.env.${key}, home: process.env.HOME, data: process.env.XDG_DATA_HOME}))`
    const output = await $`${process.execPath} -e ${script}`.env(env).text()
    expect(JSON.parse(output)).toEqual({ leak: false, home: env.HOME, data: env.XDG_DATA_HOME })
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})
