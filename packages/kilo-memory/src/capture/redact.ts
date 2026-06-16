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
  const uri = /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|https?):\/\/)[^:\s/@]+:[^@\s/]+@/i

  function sensitive(input: string) {
    const name = input.replaceAll(/[_\s-]/g, "").toLowerCase()
    if (keys.has(name)) return true
    return [...keys].some((key) => name.endsWith(key))
  }

  export function has(input: string) {
    return uri.test(input) || secret.some((item) => item.test(input))
  }

  export function text(input: string) {
    const safe = input.replace(new RegExp(uri.source, "gi"), "$1[redacted]@")
    return secret.reduce((next, item) => {
      const flags = item.flags.includes("g") ? item.flags : `${item.flags}g`
      return next.replace(new RegExp(item.source, flags), "[redacted]")
    }, safe)
  }

  export function value(input: unknown, name?: string): unknown {
    if (name && sensitive(name)) return "[redacted]"
    if (typeof input === "string") return text(input)
    if (Array.isArray(input)) return input.map((item) => value(item))
    if (typeof input !== "object" || input === null) return input
    return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item, key)]))
  }
}
