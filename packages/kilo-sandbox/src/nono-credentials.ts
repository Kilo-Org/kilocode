import { readFileSync } from "node:fs"

/** A credential a sandboxed command may use only through nono's proxy. */
export interface Credential {
  readonly name: string
  readonly source: string
  readonly envVar: string
  readonly upstream: string
  readonly header?: string
  readonly format?: string
  readonly phantom?: string
}

const name = /^[a-z0-9_]+$/
const variable = /^[A-Z_][A-Z0-9_]*$/
const header = /^[A-Za-z0-9-]+$/
const phantom = /^[A-Za-z0-9._~-]+\{\}[A-Za-z0-9._~-]*$/

/** Names Kilo knows hold the same secret as the configured variable. */
const known: Record<string, ReadonlyArray<string>> = {
  GITHUB_TOKEN: ["GH_TOKEN", "GITHUB_OAUTH_TOKEN"],
  GITLAB_TOKEN: ["GL_TOKEN"],
  ANTHROPIC_API_KEY: ["ANTHROPIC_KEY"],
  OPENAI_API_KEY: ["OPENAI_KEY"],
  NPM_TOKEN: ["NPM_AUTH_TOKEN"],
}

export function aliases(variable_: string) {
  return known[variable_] ?? []
}

function invalid(message: string) {
  return new TypeError(`Invalid nono credential: ${message}`)
}

function text(entry: Record<string, unknown>, key: string) {
  const value = entry[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) throw invalid(`${key} must be a non-empty string`)
  return value
}

function upstream(value: string) {
  if (!URL.canParse(value)) throw invalid(`upstream is not a URL: ${JSON.stringify(value)}`)
  const url = new URL(value)
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, ""))
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw invalid(`upstream must be HTTPS or loopback HTTP: ${JSON.stringify(value)}`)
  }
  return value
}

function entry(input: unknown, index: number): Credential {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw invalid(`entry ${index} is not an object`)
  const value = input as Record<string, unknown>
  const credentialName = text(value, "name") ?? ""
  if (!name.test(credentialName))
    throw invalid(`name ${JSON.stringify(credentialName)} must use letters, digits and underscores`)
  const source = text(value, "source") ?? ""
  if (!source.startsWith("env://"))
    throw invalid(`source must be env://NAME for the POC, got ${JSON.stringify(source)}`)
  const declared = text(value, "envVar") ?? source.slice("env://".length)
  if (!variable.test(declared)) throw invalid(`envVar ${JSON.stringify(declared)} is not a shell variable name`)
  if (source !== `env://${declared}`) throw invalid(`source and envVar disagree for ${credentialName}`)
  const format = text(value, "format")
  if (format !== undefined && format.split("{}").length !== 2) throw invalid(`format must contain exactly one {}`)
  const shaped = text(value, "phantom")
  if (shaped !== undefined && (!phantom.test(shaped) || shaped.includes("nono_"))) {
    throw invalid(`phantom must be a non-empty prefix, one {}, and must not contain nono_`)
  }
  const injected = text(value, "header")
  if (injected !== undefined && !header.test(injected))
    throw invalid(`header ${JSON.stringify(injected)} is not a header name`)
  return {
    name: credentialName,
    source,
    envVar: declared,
    upstream: upstream(text(value, "upstream") ?? ""),
    ...(injected === undefined ? {} : { header: injected }),
    ...(format === undefined ? {} : { format }),
    ...(shaped === undefined ? {} : { phantom: shaped }),
  }
}

export function parse(input: unknown): Array<Credential> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("file must hold an object")
  const values = (input as Record<string, unknown>).credentials
  if (values === undefined) return []
  if (!Array.isArray(values)) throw invalid("credentials must be an array")
  const parsed = values.map(entry)
  const names = new Set<string>()
  const variables = new Set<string>()
  for (const credential of parsed) {
    if (names.has(credential.name)) throw invalid(`duplicate name ${credential.name}`)
    names.add(credential.name)
    if (variables.has(credential.envVar)) throw invalid(`two credentials read ${credential.envVar}`)
    variables.add(credential.envVar)
  }
  return parsed
}

/** Reads the POC credential file. A missing file means no credential routes. */
export function load(file: string | undefined) {
  if (!file) return []
  try {
    return parse(JSON.parse(readFileSync(file, "utf8")))
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return []
    throw cause
  }
}
