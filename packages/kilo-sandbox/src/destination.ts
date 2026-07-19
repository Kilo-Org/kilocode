import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { domainToASCII } from "node:url"
import ipaddr from "ipaddr.js"

export interface Destination {
  readonly host: string
  readonly port: number
  readonly authority: string
}

function invalid(input: string) {
  return new TypeError(`Invalid sandbox network destination: ${JSON.stringify(input)}`)
}

function hostname(input: string) {
  if (input.length === 0 || input.length > 253 || isIP(input) !== 0 || /^[0-9.]+$/.test(input)) throw invalid(input)
  const host = domainToASCII(input.toLowerCase())
  if (!host || host.length > 253) throw invalid(input)
  const labels = host.split(".")
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    throw invalid(input)
  }
  return host
}

export function parseDestination(input: string, defaultPort = 443): Destination {
  if (input !== input.trim() || /[\u0000-\u0020\u007f/@?#*]/.test(input)) throw invalid(input)
  const colon = input.lastIndexOf(":")
  const hasPort = colon > -1
  const value = hasPort ? input.slice(0, colon) : input
  const raw = value.endsWith(".") ? value.slice(0, -1) : value
  const text = hasPort ? input.slice(colon + 1) : String(defaultPort)
  if (!/^\d+$/.test(text)) throw invalid(input)
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid(input)
  const host = hostname(raw)
  return { host, port, authority: `${host}:${port}` }
}

export function normalizeDestinations(input: ReadonlyArray<string>) {
  return [...new Set(input.map((value) => parseDestination(value).authority))].sort()
}

export function isPublicAddress(input: string) {
  if (!ipaddr.isValid(input)) return false
  const address = ipaddr.parse(input)
  if (address.kind() === "ipv6") {
    const ipv6 = address as ipaddr.IPv6
    if (ipv6.isIPv4MappedAddress() || ipv6.match(ipaddr.IPv6.parse("::"), 96)) return false
  }
  // Unknown network-specific NAT64 prefixes are indistinguishable from ordinary global IPv6 addresses.
  // Identifying them requires trusted prefix configuration; range() rejects the recognized transition ranges.
  return address.range() === "unicast"
}

export async function resolveDestination(dest: Destination) {
  const addresses = await lookup(dest.host, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error(`Sandbox denied a non-public address for ${dest.authority}`)
  }
  return addresses[0]
}
