import { describe, expect, test } from "bun:test"
import { isPublicAddress, normalizeDestinations, parseDestination } from "../src/destination"

describe("sandbox network destinations", () => {
  test("normalizes exact DNS hosts and ports", () => {
    expect(parseDestination("GitHub.COM.")).toEqual({
      host: "github.com",
      port: 443,
      authority: "github.com:443",
    })
    expect(parseDestination("api.github.com:8443").authority).toBe("api.github.com:8443")
    expect(normalizeDestinations(["github.com", "GITHUB.com:443", "api.github.com"])).toEqual([
      "api.github.com:443",
      "github.com:443",
    ])
  })

  test("rejects ambiguous and widening inputs", () => {
    for (const value of [
      "https://github.com",
      "*.github.com",
      ".github.com",
      "github.com/path",
      "github.com?x=1",
      "user@github.com",
      " github.com",
      "github.com ",
      "github.com:0",
      "github.com:65536",
      "127.0.0.1",
      "127.1",
      "[::1]",
      "github.com\0.evil.test",
    ]) {
      expect(() => parseDestination(value), value).toThrow("Invalid sandbox network destination")
    }
  })

  test("rejects known non-public resolved address ranges", () => {
    for (const [input, expected, note] of [
      ["8.8.8.8", true, "public IPv4"],
      ["1.1.1.1", true, "public IPv4"],
      ["2606:4700:4700::1111", true, "public IPv6 with unspecified-looking low 32 bits"],
      ["2001:4860:4860::8888", true, "Google public IPv6"],
      ["2607:f8b0:4005:805::200e", true, "Google public IPv6 endpoint"],
      ["2606:4700:4700:1:a:0:100:0", true, "unknown network-specific /64 NAT64 layout"],
      ["2606:4700:4700:1::a9fe:a9fe", true, "unknown network-specific /96 NAT64 layout"],
      ["169.254.169.254", false, "metadata and link-local IPv4"],
      ["10.0.0.1", false, "RFC1918 10/8"],
      ["172.16.0.1", false, "RFC1918 172.16/12"],
      ["192.168.0.1", false, "RFC1918 192.168/16"],
      ["127.0.0.1", false, "loopback IPv4"],
      ["100.64.0.1", false, "CGNAT IPv4"],
      ["192.0.2.1", false, "documentation IPv4"],
      ["198.51.100.1", false, "documentation IPv4"],
      ["203.0.113.1", false, "documentation IPv4"],
      ["240.0.0.1", false, "reserved IPv4"],
      ["224.0.0.1", false, "multicast IPv4"],
      ["::1", false, "loopback IPv6"],
      ["fe80::1", false, "link-local IPv6"],
      ["fc00::1", false, "unique-local IPv6"],
      ["::ffff:8.8.8.8", false, "IPv4-mapped IPv6 with public IPv4"],
      ["::8.8.8.8", false, "IPv4-compatible embedded IPv6"],
      ["::808:808", false, "hexadecimal IPv4-compatible IPv6"],
      ["64:ff9b::808:808", false, "well-known NAT64 with public IPv4"],
      ["64:ff9b::a9fe:a9fe", false, "well-known NAT64 with metadata IPv4"],
      ["64:ff9b:1::808:808", false, "local-use NAT64 with public IPv4"],
      ["2002:808:808::1", false, "6to4 with public IPv4"],
      ["2001:0:4136:e378:8000:63bf:3fff:fdd2", false, "Teredo"],
      ["not-an-address", false, "invalid address"],
    ] as const) {
      expect(isPublicAddress(input), `${note}: ${input}`).toBe(expected)
    }
  })
})
