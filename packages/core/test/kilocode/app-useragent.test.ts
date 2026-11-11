import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"

// The user agent seam in App.useragent: an embedder's product id replaces the leading segment, and nothing else.
const build = { name: "sdk", version: "1.2.3", channel: "beta" }

test("the user agent keeps the upstream value without a product", () => {
  expect(App.useragent(App.make())).toBe("opencode/unknown/unknown/opencode")
  expect(App.useragent(App.make(build))).toBe("opencode/beta/1.2.3/sdk")
  expect(App.useragent(App.make({ ...build, product: undefined }))).toBe("opencode/beta/1.2.3/sdk")
})

test("an embedder's product id leads the user agent", () => {
  expect(App.useragent(App.make({ ...build, product: { id: "acme", name: "Acme" } }))).toBe("acme/beta/1.2.3/sdk")
})

test("the product changes neither the channel, the version nor the client name", () => {
  const plain = App.useragent(App.make(build)).split("/")
  const branded = App.useragent(App.make({ ...build, product: { id: "acme", name: "Acme Code" } })).split("/")
  expect(branded.slice(1)).toEqual(plain.slice(1))
})
