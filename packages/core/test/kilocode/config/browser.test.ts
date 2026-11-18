import { expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"

function entries(...browser: NonNullable<KiloConfigPolicy.BrowserConfig>[]) {
  return browser.map((value) => new Document({ type: "document", info: new KiloConfigPolicy.Info({ browser: value }) }))
}

test("browser is decoded beside canonical config", () => {
  const input = {
    browser: { backend: "extension", observation: "diff", allow_sensitive: true, headless: true, target: "chrome:1" },
    shell: "valid",
  } as const
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(input, normalized.encoded)?.browser).toEqual(input.browser)
  expect(KiloConfigPolicy.parse({}, {})?.browser).toBeUndefined()
})

test("browser accepts each backend, observation and the null target", () => {
  for (const backend of ["playwright", "extension", "off"] as const)
    expect(KiloConfigPolicy.parse({ browser: { backend } }, {})?.browser?.backend).toBe(backend)
  for (const observation of ["full", "diff", "none"] as const)
    expect(KiloConfigPolicy.parse({ browser: { observation } }, {})?.browser?.observation).toBe(observation)
  expect(KiloConfigPolicy.parse({ browser: { target: null } }, {})?.browser?.target).toBeNull()
})

test("an invalid browser block is reported and dropped, the rest of the document survives", () => {
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse(
    { browser: { backend: "chrome" }, shell: "valid" },
    { shell: "valid" },
    (diagnostic) => diagnostics.push(diagnostic),
  )
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.browser).toBeUndefined()
  expect(diagnostics).toEqual([
    {
      kind: "invalid",
      path: ["browser"],
      message: expect.stringContaining("expected an object with optional backend"),
    },
  ])
})

test("browser is a known top-level key, so a settings write is allowed", () => {
  expect(KiloConfigPolicy.known.has("browser")).toBe(true)
  expect(KiloConfigPolicy.parse({ browser: { backend: "off" } }, {})?.browser).toEqual({ backend: "off" })
})

test("browserConfig merges documents field by field", () => {
  expect(KiloConfigPolicy.browserConfig([])).toEqual({})
  expect(
    KiloConfigPolicy.browserConfig(
      entries({ backend: "extension", headless: true }, { observation: "none", target: null }),
    ),
  ).toEqual({ backend: "extension", headless: true, observation: "none", target: null })
  // A later document only overrides the fields it sets.
  expect(KiloConfigPolicy.browserConfig(entries({ backend: "off" }, { observation: "diff" })).backend).toBe("off")
})
