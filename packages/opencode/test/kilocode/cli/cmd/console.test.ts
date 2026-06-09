import { describe, expect, test } from "bun:test"
import { addresses, covers, wildcard } from "../../../../src/kilocode/cli/cmd/console"

describe("console command", () => {
  test("wildcard detects all-interface bindings", () => {
    expect(wildcard("0.0.0.0")).toBe(true)
    expect(wildcard("::")).toBe(true)
    expect(wildcard("127.0.0.1")).toBe(false)
    expect(wildcard("192.168.1.7")).toBe(false)
  })

  test("covers accepts a wildcard daemon for any requested hostname", () => {
    expect(covers({ hostname: "0.0.0.0", port: 4097 }, { hostname: "127.0.0.1", port: 0 })).toBe(true)
    expect(covers({ hostname: "0.0.0.0", port: 4097 }, { hostname: "0.0.0.0", port: 4097 })).toBe(true)
  })

  test("covers rejects a loopback daemon for a wildcard request", () => {
    expect(covers({ hostname: "127.0.0.1", port: 4097 }, { hostname: "0.0.0.0", port: 0 })).toBe(false)
  })

  test("covers rejects an explicit port mismatch", () => {
    expect(covers({ hostname: "0.0.0.0", port: 4097 }, { hostname: "0.0.0.0", port: 10000 })).toBe(false)
  })

  test("covers ignores port when any port was requested", () => {
    expect(covers({ hostname: "127.0.0.1", port: 4097 }, { hostname: "127.0.0.1", port: 0 })).toBe(true)
  })

  test("addresses lists external IPv4 addresses only", () => {
    const fake = {
      lo: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "::1", family: "IPv6", internal: true },
      ],
      eth0: [
        { address: "192.168.1.7", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      down: undefined,
    }
    expect(addresses(fake)).toStrictEqual(["192.168.1.7"])
  })
})
