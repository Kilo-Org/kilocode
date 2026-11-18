import { describe, expect, test } from "bun:test"
import { BrowserHub } from "@kilocode/kilo-plugin/browser/hub"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HubError } from "../../src/browser/client"
import * as proto from "../../src/browser/protocol"
import { failure, hub as connection } from "../../src/browser/port"

const codes = Object.fromEntries(
  (Object.keys(proto.ErrorCodes) as proto.ErrorName[]).map((name) => [name, proto.ErrorCodes[name]]),
) as Record<proto.ErrorName, number>

function hub(name: proto.ErrorName, data?: unknown) {
  return new HubError({ code: codes[name], message: `${name} happened`, ...(data === undefined ? {} : { data }) })
}

describe("hub failures as the extension backend reads them", () => {
  test("every protocol error becomes its own kind", () => {
    expect(failure(hub("browser_unavailable")).kind).toBe("unavailable")
    expect(failure(hub("tab_busy")).kind).toBe("busy")
    expect(failure(hub("tab_taken")).kind).toBe("taken")
    expect(failure(hub("user_stopped")).kind).toBe("stopped")
    expect(failure(hub("unsupported_in_browser")).kind).toBe("unsupported")
    expect(failure(hub("blocked")).kind).toBe("blocked")
    expect(failure(hub("protocol_mismatch")).kind).toBe("mismatch")
    expect(failure(hub("needs_permission")).kind).toBe("permission")
    expect(failure(hub("origin_changed")).kind).toBe("moved")
  })

  test("a dropped connection keeps its uncertainty marker", () => {
    const dropped = new HubError({
      code: proto.ErrorCodes.browser_unavailable,
      message: "The browser connection dropped: the hub closed the connection",
      data: { effectsUncertain: true },
    })
    expect(failure(dropped)).toMatchObject({ kind: "unavailable", uncertain: true })
  })

  test("a permission error carries its items, step token and post-action marker", () => {
    const mapped = failure(
      hub("needs_permission", {
        items: [{ class: "sensitive", origin: "https://example.com", reason: "password field" }],
        stepToken: "token",
        afterAction: true,
        url: "https://example.com",
      }),
    )
    expect(mapped).toMatchObject({
      kind: "permission",
      afterAction: true,
      stepToken: "token",
      items: [{ class: "sensitive", origin: "https://example.com", reason: "password field" }],
      meta: { url: "https://example.com" },
    })
  })

  test("a redirect names the origin it landed on, so the retry asks for the right read", () => {
    expect(failure(hub("origin_changed", { from: "https://a.example.com", to: "https://b.example.com/login" }))).toMatchObject({
      kind: "moved",
      items: [{ class: "read", origin: "https://b.example.com" }],
    })
    // A destination that is not an http(s) origin cannot be granted, so it asks for nothing.
    expect(failure(hub("origin_changed", { from: "https://a.example.com", to: "about:blank" })).items).toEqual([])
  })

  test("a malformed payload leaves the items empty instead of guessing", () => {
    const mapped = failure(hub("needs_permission", { items: "everything" }))
    expect(mapped.kind).toBe("permission")
    expect(mapped.items).toEqual([])
  })

  test("a transport failure from ready is the backend's own failure, not a raw error", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-port-"))
    try {
      const linked = connection({ dir, install: () => Promise.resolve(), start: () => {}, timeout: 300 })
      const error = await linked.port(null).ready(300).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BrowserHub.Failure)
      expect((error as BrowserHub.Failure).kind).toBe("unavailable")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a client that cannot be created is mapped, not leaked raw", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-port-"))
    try {
      const linked = connection({
        dir,
        install: () => Promise.resolve(),
        start: () => {},
        timeout: 300,
        create: () => {
          throw new Error("the transport cannot start")
        },
      })
      const error = await linked.port(null).ready(300).catch((value: unknown) => value)
      expect(error).toBeInstanceOf(BrowserHub.Failure)
      expect((error as BrowserHub.Failure).kind).toBe("unknown")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a code the protocol does not name is unknown, never a guessed kind", () => {
    const mapped = failure(new HubError({ code: -32099, message: "who knows" }))
    expect(mapped.kind).toBe("unknown")
    expect(mapped.message).toBe("who knows")
  })

  test("a non-hub error is unknown with its own message", () => {
    expect(failure(new Error("plain"))).toMatchObject({ kind: "unknown", message: "plain" })
    expect(failure("text").message).toBe("text")
  })
})
