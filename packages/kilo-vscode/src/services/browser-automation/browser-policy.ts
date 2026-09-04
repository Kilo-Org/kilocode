import { isPublicAddress, parseDestination } from "@kilocode/sandbox/destination"
import { isIP } from "node:net"

export function parse(value: string): URL {
  if (value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value) || !/^https?:\/\//i.test(value)) {
    throw new TypeError("Browser URL is invalid")
  }
  const url = new URL(value)
  if (url.port === "0") throw new TypeError("Browser URL port is invalid")
  if (url.username || url.password || /^https?:\/\/[^/?#]*@/i.test(value)) {
    throw new TypeError("Browser URLs must not contain credentials")
  }
  if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
    return url
  }
  if (url.protocol !== "https:") {
    throw new TypeError("Browser URLs must use public HTTPS or HTTP localhost/127.0.0.1")
  }
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new TypeError("Browser HTTPS destinations must be public")
    return url
  }
  const dest = parseDestination(url.host)
  if (dest.host === "localhost" || dest.host.endsWith(".localhost")) {
    throw new TypeError("Browser HTTPS destinations must be public")
  }
  url.hostname = dest.host
  return url
}
