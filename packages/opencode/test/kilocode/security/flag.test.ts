// How the mode is switched on, and what happens when the config cannot answer.
//
// The second half is the one that matters. These lookups run inside the plugin loader and the tool
// registry, long before a session exists, and they are handed whatever `Config` service the caller
// has. A service that does not implement `getGlobal` — every partial test layer, and any future
// caller that builds one — throws when the method is *accessed*, which is not an Effect failure and
// is therefore not caught by an error handler. A security flag that takes down the loader is a worse
// outcome than a security flag read as off, and off is what the user gets by default anyway.
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Config } from "@/config/config"
import { SecurityFlag } from "@/kilocode/security/flag"

type Partial = Pick<Config.Interface, "getGlobal">

const broken = {
  get getGlobal(): never {
    throw new Error('@opencode/Config: Unimplemented method "getGlobal"')
  },
} as unknown as Partial

const failing = { getGlobal: () => Effect.fail(new Error("config unreadable")) } as unknown as Partial

const answering = (experimental: Record<string, unknown>) =>
  ({ getGlobal: () => Effect.succeed({ experimental }) }) as unknown as Partial

const ENV = ["KILO_SECURITY_AUTO", "KILO_SECURITY_AUTO_CODE", "KILO_SECURITY_AUTO_EXTENSION_RUNTIME"]

afterEach(() => {
  for (const key of ENV) delete process.env[key]
})

describe("a config that cannot answer means the mode is off, never a crash", () => {
  for (const [name, service] of [
    ["a service without the method", broken],
    ["a service whose read fails", failing],
  ] as const) {
    test(`${name}: enabled`, async () => {
      expect(await Effect.runPromise(SecurityFlag.enabled(service))).toBe(false)
    })

    test(`${name}: the loader-time layer lookups`, async () => {
      expect(await Effect.runPromise(SecurityFlag.codeEnabled(service))).toBe(false)
      expect(await Effect.runPromise(SecurityFlag.runtimeEnabled(service))).toBe(false)
    })

    test(`${name}: the layer set and the declarations`, async () => {
      const layers = await Effect.runPromise(SecurityFlag.layers(service))
      // Every layer defaults on *with the mode*; the mode itself is off above, so this is the shape
      // the caller gets, not an authority it grants.
      expect(layers.packages).toBe(true)
      expect(await Effect.runPromise(SecurityFlag.declarations(service))).toEqual([])
    })
  }
})

describe("the switch itself", () => {
  test("off unless the global config says otherwise", async () => {
    expect(await Effect.runPromise(SecurityFlag.enabled(answering({})))).toBe(false)
    expect(await Effect.runPromise(SecurityFlag.enabled(answering({ security_auto: true })))).toBe(true)
  })

  test("the environment wins in both directions", async () => {
    process.env["KILO_SECURITY_AUTO"] = "1"
    expect(await Effect.runPromise(SecurityFlag.enabled(answering({})))).toBe(true)
    process.env["KILO_SECURITY_AUTO"] = "0"
    expect(await Effect.runPromise(SecurityFlag.enabled(answering({ security_auto: true })))).toBe(false)
  })

  test("a layer is on with the mode and off only when it is set to false", async () => {
    expect((await Effect.runPromise(SecurityFlag.layers(answering({})))).egress).toBe(true)
    expect((await Effect.runPromise(SecurityFlag.layers(answering({ security_auto_egress: false })))).egress).toBe(false)
  })

  test("a layer lookup that runs before any session still needs the mode on", async () => {
    expect(await Effect.runPromise(SecurityFlag.codeEnabled(answering({ security_auto_code: true })))).toBe(false)
    expect(
      await Effect.runPromise(SecurityFlag.codeEnabled(answering({ security_auto: true, security_auto_code: true }))),
    ).toBe(true)
  })
})
