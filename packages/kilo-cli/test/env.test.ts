import { expect, test } from "bun:test"
import { storage, translate } from "../src/env"

test.each([undefined, "0", "1"])("startup defaults preserve an explicit host setting (%s)", (setting) => {
  const env = { OPENCODE_TUI_USE_PINNED_MODE: setting, OPENCODE_TUI_OVERLAP_STARTUP: setting }
  translate(env)
  expect(env.OPENCODE_TUI_USE_PINNED_MODE).toBe(setting ?? "1")
  expect(env.OPENCODE_TUI_OVERLAP_STARTUP).toBe(setting ?? "1")
})

test("KILO_ variables reach their OPENCODE_ name, and the Kilo name wins", () => {
  const env: Record<string, string | undefined> = {
    KILO_CLIENT: "kilo",
    OPENCODE_CLIENT: "opencode",
    KILO_DISABLE_AUTOUPDATE: "1",
    OPENCODE_MODELS_URL: "https://models.example.test",
  }
  translate(env)
  expect(env.OPENCODE_CLIENT).toBe("kilo")
  expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  expect(env.OPENCODE_MODELS_URL).toBe("https://models.example.test")
})

test("KILO_TEST_HOME overrides the home directory as OPENCODE_TEST_HOME", () => {
  const env: Record<string, string | undefined> = { KILO_TEST_HOME: "/tmp/kilo-home" }
  translate(env)
  expect(env.OPENCODE_TEST_HOME).toBe("/tmp/kilo-home")
})

test("the Kilo Gateway token does not become the OpenCode Zen key", () => {
  const env: Record<string, string | undefined> = { KILO_API_KEY: "kilo-token" }
  translate(env)
  expect(env.OPENCODE_API_KEY).toBeUndefined()
})

test("KILO storage overrides win over inherited runtime paths", () => {
  for (const key of storage) {
    const env = { [`KILO_${key}`]: "/selected", [`OPENCODE_${key}`]: "/inherited" }
    translate(env)
    expect(env[`OPENCODE_${key}`]).toBe("/selected")
  }
})
