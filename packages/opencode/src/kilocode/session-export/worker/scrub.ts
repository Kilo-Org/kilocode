import { lintSource } from "@secretlint/core"
import { creator } from "@secretlint/secretlint-rule-preset-recommend"

export type ScrubResult = {
  value: string
  redactionsByType: Record<string, number>
}

type Pattern = { name: string; regex: RegExp }

const PATTERNS: Pattern[] = [
  { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    name: "aws_secret_key",
    regex: /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key)\s*[=:]\s*["']?[0-9a-zA-Z/+]{40}["']?/gi,
  },
  { name: "gcp_service_key", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "openai_key", regex: /\bsk-[A-Za-z0-9_-]{20,}(?=\b|[^A-Za-z0-9_-])/g },
  { name: "anthropic_key", regex: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { name: "github_pat", regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "stripe_key", regex: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "slack_token", regex: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g },
  { name: "ssh_private_key", regex: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g },
  { name: "env_secret", regex: /\b(SECRET_[A-Z0-9_]+|[A-Z0-9_]+_TOKEN|PASSWORD|API_KEY)\s*=\s*["']?([^"'\s]+)["']?/g },
  { name: "database_uri", regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^:\s/@]+:[^@\s]+@[^\s"')]+/gi },
]

const RISK: RegExp[] = [
  /^\.env(\.|$)/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.ssh\/id_/,
  /\.pem$/,
  /\.key$/,
]

const CONFIG = {
  rules: [{ id: "@secretlint/secretlint-rule-preset-recommend", rule: creator }],
}

const FIELDS = new Set(["TOKEN", "KEY", "SECRET", "PASSWORD", "URL", "URI", "CONTENT", "VALUE", "CREDENTIAL"])

type Message = {
  ruleId: string
  ruleParentId?: string
  data?: Record<string, unknown>
}

export function scrubString(input: string, patterns: Pattern[] = PATTERNS): ScrubResult {
  const redactionsByType: Record<string, number> = {}
  let value = input
  for (const item of patterns) {
    value = value.replace(item.regex, () => {
      redactionsByType[item.name] = (redactionsByType[item.name] ?? 0) + 1
      return `<<REDACTED:${item.name}>>`
    })
  }
  return { value, redactionsByType }
}

async function scrubSecretlint(input: string): Promise<ScrubResult> {
  const result = await lintSource({
    source: { content: input, filePath: "", ext: ".json", contentType: "text" },
    options: {
      maskSecrets: false,
      noPhysicFilePath: true,
      config: CONFIG,
    },
  })
  const secrets = secretlintSecrets(result.messages)
  let value = input
  const redactionsByType: Record<string, number> = {}
  for (const [secret, rule] of secrets) {
    const name = `secretlint_${rule
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()}`
    const count = value.split(secret).length - 1
    if (count === 0) continue
    value = value.split(secret).join(`<<REDACTED:${name}>>`)
    redactionsByType[name] = (redactionsByType[name] ?? 0) + count
  }
  return { value, redactionsByType }
}

export function secretlintSecrets(messages: Message[]): Map<string, string> {
  const secrets = new Map<string, string>()
  for (const msg of messages) {
    const data = msg.data ?? {}
    for (const [key, val] of Object.entries(data)) {
      if (!FIELDS.has(key.toUpperCase())) continue
      if (typeof val !== "string") continue
      if (val.length < 4) continue
      secrets.set(val, msg.ruleParentId ?? msg.ruleId)
    }
  }
  return secrets
}

export function isHighRiskPath(path: string): boolean {
  return RISK.some((item) => item.test(path))
}

export type ScrubbedEvent<T> =
  | { success: true; data: T; report: { client_scrubbed: true; redactionsByType: Record<string, number> } }
  | {
      success: false
      data: T
      report: { client_scrubbed: false; redactionsByType: Record<string, number>; failureReason: string }
    }

export class Scrubber {
  constructor(private readonly opts: { patterns?: Pattern[] } = {}) {}

  async scrubEvent<T>(event: T): Promise<ScrubbedEvent<T>> {
    const totals: Record<string, number> = {}
    try {
      const data = (await this.walk(event, totals)) as T
      return { success: true, data, report: { client_scrubbed: true, redactionsByType: totals } }
    } catch (err) {
      return {
        success: false,
        data: event,
        report: {
          client_scrubbed: false,
          redactionsByType: totals,
          failureReason: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  private async walk(node: unknown, totals: Record<string, number>): Promise<unknown> {
    if (typeof node === "string") {
      const lint = await scrubSecretlint(node)
      const out = scrubString(lint.value, this.opts.patterns)
      for (const [key, val] of Object.entries(lint.redactionsByType)) totals[key] = (totals[key] ?? 0) + val
      for (const [key, val] of Object.entries(out.redactionsByType)) totals[key] = (totals[key] ?? 0) + val
      return out.value
    }
    if (Array.isArray(node)) {
      const out: unknown[] = []
      for (const item of node) out.push(await this.walk(item, totals))
      return out
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(node)) out[key] = await this.walk(val, totals)
      return out
    }
    return node
  }
}
