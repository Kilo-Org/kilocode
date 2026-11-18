import { expect, test } from "bun:test"
import { bundle, host, serverText } from "./fixtures/branding-run"

// The compiled build bundles the server through the same plugin (script/build.ts), so the loader's path filter has
// to match the server modules in a bundle as well as in a source run.
for (const hosted of [false, true]) {
  test(`a bundle of the server modules ${hosted ? "names Kilo" : "keeps upstream wording"}`, async () => {
    const output = await bundle(serverText, hosted)
    for (const [, upstream, kilo] of serverText) {
      expect(output).toContain(hosted ? kilo : upstream)
      expect(output).not.toContain(hosted ? upstream : kilo)
    }
    // The basic-auth username is an identity the clients send, in both.
    expect(output).toContain('username: "opencode"')
  }, 60_000)
}

// The host entry from source, as `bun dev` runs it: a browser that opens a used pairing link reads the Kilo command.
test("the host's server names the Kilo command when a pairing link expired", async () => {
  await host({}, async (url) => {
    const response = await fetch(new URL("/auth/connect/not-a-code", url), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe(
      "This pairing link expired or was already used. Run `kilo2 pair` to get a new one.",
    )
  })
}, 60_000)
