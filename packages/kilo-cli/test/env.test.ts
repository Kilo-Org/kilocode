import { expect, test } from "bun:test"
import { names, storage, translate } from "../src/env"

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

test("the Kilo Gateway token does not become the OpenCode Zen key", () => {
  const env: Record<string, string | undefined> = { KILO_API_KEY: "kilo-token" }
  translate(env)
  expect(env.OPENCODE_API_KEY).toBeUndefined()
})

test("v1 storage variables do not reach v2, the KILO2_ names do", () => {
  const v1: Record<string, string | undefined> = {
    KILO_CONFIG: "/v1/kilo.json",
    KILO_CONFIG_DIR: "/v1/config",
    KILO_DB: "/v1/kilo.db",
  }
  translate(v1)
  expect(v1.OPENCODE_CONFIG).toBeUndefined()
  expect(v1.OPENCODE_CONFIG_DIR).toBeUndefined()
  expect(v1.OPENCODE_DB).toBeUndefined()

  const v2: Record<string, string | undefined> = {
    ...v1,
    KILO2_CONFIG: "/v2/kilo2.json",
    KILO2_CONFIG_DIR: "/v2/config",
    KILO2_DB: "/v2/kilo2.db",
  }
  translate(v2)
  expect(v2.OPENCODE_CONFIG).toBe("/v2/kilo2.json")
  expect(v2.OPENCODE_CONFIG_DIR).toBe("/v2/config")
  expect(v2.OPENCODE_DB).toBe("/v2/kilo2.db")
})

// KILO_CONFIG, KILO_CONFIG_DIR and KILO_DB belong to v1 while v1 and v2 ship side by side (D-4). Fails if a later
// change copies them to the OPENCODE_ names again.
test("v1 storage variables are not in the translated KILO_ names", () => {
  for (const name of storage) expect(names).not.toContain(name)
})
