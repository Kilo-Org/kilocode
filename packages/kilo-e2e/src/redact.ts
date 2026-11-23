const SECRET_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "authtoken",
  "bearertoken",
  "cleanuptoken",
  "apikey",
  "accesskey",
  "secretkey",
  "authorization",
  "cookie",
  "cookies",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "credential",
  "credentials",
  "privatekey",
  "devvars",
  "descriptor",
  "fixturedescriptor",
  "privatedescriptor",
])

const SECRET_VALUES = [
  /^\s*bearer\s+[a-z0-9._~+/-]{16,}/i,
  /^\s*basic\s+[a-z0-9+/=]{8,}={0,2}\s*$/i,
  /^gh[pousr]_[A-Za-z0-9]{8,}/,
  /^sk-[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
]

export class SecretFieldError extends Error {
  constructor(readonly path: string) {
    super(`secret material is not allowed in evidence (${path})`)
    this.name = "SecretFieldError"
  }
}

function norm(key: string) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function secretText(value: string) {
  return SECRET_VALUES.some((pattern) => pattern.test(value))
}

export function assertNoSecrets(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    if (secretText(value)) throw new SecretFieldError(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (SECRET_KEYS.has(norm(key))) throw new SecretFieldError(childPath)
    assertNoSecrets(child, childPath)
  }
}
