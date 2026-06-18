import { describe, expect, test } from "bun:test"
import { explicitNetworkOptions } from "../../../../src/cli/network"
import { Daemon } from "../../../../src/kilocode/daemon/daemon"

function opts(input: Partial<Daemon.Network> = {}): Daemon.Options {
  return {
    hostname: "127.0.0.1",
    port: 4097,
    mdns: false,
    mdnsDomain: "kilo.local",
    cors: [],
    ...input,
  }
}

function state(input: Partial<Daemon.Network> = {}) {
  const options = Daemon.Network.parse(opts(input))
  return Daemon.State.parse({
    pid: 1,
    hostname: options.hostname,
    port: options.port,
    url: `http://${options.hostname}:${options.port}`,
    username: "kilo",
    password: "kilo",
    token: "token",
    version: "test",
    startedAt: new Date(0).toISOString(),
    log: "/tmp/daemon.log",
    options,
  })
}

describe("console daemon startup", () => {
  test("detects every explicit network option form", () => {
    expect(
      explicitNetworkOptions([
        "kilo",
        "console",
        "--port=4321",
        "--hostname",
        "0.0.0.0",
        "--no-mdns",
        "--mdns-domain=test.local",
        "--cors",
        "https://example.com",
      ]),
    ).toStrictEqual(["port", "hostname", "mdns", "mdnsDomain", "cors"])
    expect(explicitNetworkOptions(["kilo", "console", "--", "--port=4321"])).toStrictEqual([])
  })

  test("matches every explicit network option", () => {
    const current = state({ mdns: true, cors: ["https://b.example", "https://a.example"] })
    const input = opts({
      port: current.port,
      mdns: true,
      cors: ["https://a.example", "https://b.example", "https://a.example"],
    })

    expect(Daemon.matches(current, input, ["port", "hostname", "mdns", "mdnsDomain", "cors"])).toBe(true)
  })

  test("treats an explicit auto port as compatible", () => {
    expect(Daemon.matches(state(), opts({ port: 0 }), ["port"])).toBe(true)
  })

  test("supports daemon state written before network options were persisted", () => {
    const current = { ...state(), options: undefined }

    expect(Daemon.matches(current, opts(), ["hostname", "port"])).toBe(true)
    expect(Daemon.matches(current, opts(), ["mdns"])).toBe(false)
    expect(Daemon.matches(current, opts(), ["mdnsDomain"])).toBe(false)
    expect(Daemon.matches(current, opts(), ["cors"])).toBe(false)
  })

  test("rejects each mismatched explicit network option", () => {
    const current = state()

    expect(Daemon.matches(current, opts({ hostname: "0.0.0.0" }), ["hostname"])).toBe(false)
    expect(Daemon.matches(current, opts({ port: current.port + 1 }), ["port"])).toBe(false)
    expect(Daemon.matches(current, opts({ mdns: true }), ["mdns"])).toBe(false)
    expect(Daemon.matches(current, opts({ mdnsDomain: "test.local" }), ["mdnsDomain"])).toBe(false)
    expect(Daemon.matches(current, opts({ cors: ["https://example.com"] }), ["cors"])).toBe(false)

    const mdns = state({ mdns: true })
    expect(Daemon.matches(mdns, opts({ hostname: "0.0.0.0", mdns: true }), ["mdns"])).toBe(false)
  })
})
