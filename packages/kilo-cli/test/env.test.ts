import { expect, test } from "bun:test"
import { translate } from "../src/env"

test("KILO_ variables reach their OPENCODE_ name, and the Kilo name wins", () => {
  const env: Record<string, string | undefined> = {
    KILO_CONFIG_DIR: "/kilo/config",
    OPENCODE_CONFIG_DIR: "/opencode/config",
    KILO_DISABLE_AUTOUPDATE: "1",
    OPENCODE_MODELS_URL: "https://models.example.test",
  }
  translate(env)
  expect(env.OPENCODE_CONFIG_DIR).toBe("/kilo/config")
  expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  expect(env.OPENCODE_MODELS_URL).toBe("https://models.example.test")
})

test("the Kilo Gateway token does not become the OpenCode Zen key", () => {
  const env: Record<string, string | undefined> = { KILO_API_KEY: "kilo-token" }
  translate(env)
  expect(env.OPENCODE_API_KEY).toBeUndefined()
})
