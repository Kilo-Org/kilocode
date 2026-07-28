import { expect, test } from "bun:test"
import { browserUrl } from "../../src/kilocode/cli/cmd/console"
import type { Daemon } from "../../src/kilocode/daemon/daemon"

test("console launch URL carries daemon credentials into the server query", () => {
  const state = {
    url: "http://127.0.0.1:4097",
    username: "kilo",
    password: "secret",
  } as Daemon.State

  const url = new URL(browserUrl(state))
  const server = new URL(url.searchParams.get("server") ?? "")

  expect(url.pathname).toBe("/console")
  expect(url.username).toBe("kilo")
  expect(url.password).toBe("secret")
  expect(server.origin).toBe("http://127.0.0.1:4097")
  expect(server.username).toBe("kilo")
  expect(server.password).toBe("secret")
})
