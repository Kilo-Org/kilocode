import { Resolver } from "node:dns/promises"
import { request } from "node:https"
import { isIP } from "node:net"
import ipaddr from "ipaddr.js"

export const REFERENCE_BYTES = 1024 * 1024

export function publicAddress(input: string): boolean {
  if (!ipaddr.isValid(input)) return false
  const address = ipaddr.parse(input)
  if (address.kind() === "ipv6") {
    const ipv6 = address as ipaddr.IPv6
    if (ipv6.isIPv4MappedAddress() || ipv6.match(ipaddr.IPv6.parse("::"), 96)) return false
  }
  return address.range() === "unicast"
}

export function publicReference(input: string): URL {
  if (input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) throw new Error("Invalid selected URL.")
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("Only credential-free public HTTPS documents on the standard port can be read.")
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase()
  let pathname = url.pathname
  for (let index = 0; index < 3; index++) {
    if (!/%[0-9a-f]{2}/i.test(pathname)) break
    const decoded = decodeURIComponent(pathname)
    if (decoded === pathname) break
    pathname = decoded
  }
  if (
    !host ||
    host === "localhost" ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host) ||
    (isIP(host) ? !publicAddress(host) : !host.includes("."))
  )
    throw new Error("Private-network and local-service links are not read by Response Lens.")
  if (
    [...url.searchParams.keys()].some((key) =>
      /^(?:access_token|token|api[_-]?key|key|secret|password|sig|signature|code|auth|authorization|credential|x-amz-.+|x-goog-.+|googleaccessid)$/i.test(
        key,
      ),
    ) ||
    (url.hash.includes("=") &&
      [...new URLSearchParams(url.hash.slice(1)).keys()].some((key) =>
        /^(?:access_token|token|api[_-]?key|code|password|secret)$/i.test(key),
      )) ||
    /\/(?:login|signin|sign-in|logout|log-out|signout|unsubscribe|delete|remove|deactivate|activate|checkout|purchase|approve|oauth|authorize|callback)(?:\/|$)/i.test(
      pathname,
    )
  )
    throw new Error("Account-action and signed/private links are not fetched. Use an approved local copy instead.")
  return url
}

async function resolve(host: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (isIP(host)) return [{ address: host, family: isIP(host) as 4 | 6 }]
  const resolver = new Resolver({ timeout: 2500, tries: 1 })
  const cancel = () => resolver.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  const absent = (error: unknown): string[] => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENODATA" || error.code === "ENOTFOUND")
    )
      return []
    throw error
  }
  try {
    const [v4, v6] = await Promise.all([resolver.resolve4(host).catch(absent), resolver.resolve6(host).catch(absent)])
    signal.throwIfAborted()
    const addresses = [
      ...v4.map((address) => ({ address, family: 4 as const })),
      ...v6.map((address) => ({ address, family: 6 as const })),
    ]
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
      throw new Error("The selected link does not resolve exclusively to public addresses.")
    return addresses
  } finally {
    signal.removeEventListener("abort", cancel)
    resolver.cancel()
  }
}

export async function fetchReference(input: string, signal: AbortSignal) {
  let url = publicReference(input)
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted()
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
    const addresses = await resolve(host, signal)
    signal.throwIfAborted()
    const deferred = Promise.withResolvers<{
      redirect?: string
      bytes: Uint8Array
      mime: string
    }>()
    const req = request(
      {
        hostname: host,
        port: 443,
        path: url.pathname + url.search,
        method: "GET",
        servername: isIP(host) ? undefined : host,
        rejectUnauthorized: true,
        agent: false,
        signal,
        headers: {
          Host: url.host,
          Accept:
            "text/html, text/plain, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/json;q=0.8",
          "Accept-Encoding": "identity",
          "User-Agent": "Kilo-Response-Lens/1.0",
        },
        // The socket uses exactly the checked addresses, never a second DNS
        // lookup. Redirects are validated as new destinations, without cookies.
        lookup: (_host, opts, callback) => {
          if (opts.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
          deferred.resolve({ redirect: res.headers.location, bytes: new Uint8Array(), mime: "" })
          res.destroy()
          return
        }
        const fail = (message: string) => {
          deferred.reject(new Error(message))
          res.destroy()
        }
        if (res.statusCode !== 200)
          return fail(`The document returned HTTP ${res.statusCode ?? "error"}. It may require sign-in.`)
        if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")
          return fail("The server ignored the uncompressed-document request. Use a local copy instead.")
        const length = Number(res.headers["content-length"])
        if (Number.isFinite(length) && length > REFERENCE_BYTES)
          return fail("The selected document exceeds the 1 MiB read limit.")
        const chunks: Buffer[] = []
        let size = 0
        res.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > REFERENCE_BYTES) return fail("The selected document exceeds the 1 MiB read limit.")
          chunks.push(chunk)
        })
        res.on("end", () => deferred.resolve({ bytes: Buffer.concat(chunks), mime: res.headers["content-type"] ?? "" }))
        res.on("aborted", () => deferred.reject(new Error("The document connection ended before completion.")))
        res.on("error", () => deferred.reject(new Error("Unable to read the document response.")))
      },
    )
    req.on("error", () => deferred.reject(new Error("Unable to securely fetch the public document.")))
    req.end()
    const result = await deferred.promise
    signal.throwIfAborted()
    if (!result.redirect) return { ...result, url }
    if (hop === 3) throw new Error("The document redirected too many times.")
    url = publicReference(new URL(result.redirect, url).href)
  }
  throw new Error("Unable to resolve the document link.")
}
