export namespace MemoryRedact {
  const keys = new Set([
    "accesskey",
    "apikey",
    "auth",
    "authorization",
    "bearer",
    "clientsecret",
    "credential",
    "passphrase",
    "password",
    "privatekey",
    "secret",
    "token",
  ])
  const secret = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /gh[pousr]_[A-Za-z0-9_]{20,}/,
    /AIza[0-9A-Za-z_-]{30,}/,
    /xox[baprs]-[A-Za-z0-9-]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/,
    /["']?[\w.-]*(?:password|passphrase|api[_ -]?key|secret|token|credential|authorization|auth|private[_ -]?key|access[_ -]?key)[\w.-]*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/i,
  ]
  // Loosely find URL-like spans; the parser (not this pattern) decides whether they carry credentials.
  const candidate = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi

  // Pull the raw userinfo segment out of a candidate without normalizing it, so redaction preserves
  // the original shape (encoding, ports, path/query untouched). Any non-empty userinfo counts — a bare
  // `user@host` may still be a token, so we fail closed rather than require a colon.
  function rawUserinfo(raw: string): string | undefined {
    const sep = raw.indexOf("//")
    if (sep < 0) return undefined
    const authority = raw.slice(sep + 2).split(/[/?#]/)[0] ?? ""
    const at = authority.lastIndexOf("@")
    if (at < 1) return undefined
    return authority.slice(0, at)
  }

  // Parser-primary: a well-formed URL with userinfo is authoritative (handles ports, paths, query
  // strings, percent-encoding, and @ in the path without false positives). Regex-style raw extraction
  // is the fallback so malformed-but-credentialed strings the parser rejects still redact.
  function userinfo(raw: string): string | undefined {
    try {
      const url = new URL(raw)
      if (!url.username && !url.password) return undefined
      return rawUserinfo(raw) ?? `${url.username}:${url.password}`
    } catch {
      return rawUserinfo(raw)
    }
  }

  function hasUri(input: string) {
    return (input.match(candidate) ?? []).some((raw) => userinfo(raw) !== undefined)
  }

  function redactUri(input: string) {
    return input.replace(candidate, (raw) => {
      const info = userinfo(raw)
      return info ? raw.replace(`${info}@`, "[redacted]@") : raw
    })
  }

  function sensitive(input: string) {
    const name = input.replaceAll(/[_\s-]/g, "").toLowerCase()
    if (keys.has(name)) return true
    return [...keys].some((key) => name.endsWith(key))
  }

  export function has(input: string) {
    return hasUri(input) || secret.some((item) => item.test(input))
  }

  export function text(input: string) {
    return secret.reduce((next, item) => {
      const flags = item.flags.includes("g") ? item.flags : `${item.flags}g`
      return next.replace(new RegExp(item.source, flags), "[redacted]")
    }, redactUri(input))
  }

  export function value(input: unknown, name?: string): unknown {
    if (name && sensitive(name)) return "[redacted]"
    if (typeof input === "string") return text(input)
    if (Array.isArray(input)) return input.map((item) => value(item))
    if (typeof input !== "object" || input === null) return input
    return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item, key)]))
  }
}
