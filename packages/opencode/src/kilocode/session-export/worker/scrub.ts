export type ScrubResult = {
  value: string
  redactionsByType: Record<string, number>
}

type Pattern = { name: string; regex: RegExp }

const PATTERNS: Pattern[] = [
  { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret_key", regex: /\b[0-9a-zA-Z/+]{40}\b(?=[^0-9a-zA-Z/+]|$)/g },
  { name: "gcp_service_key", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "openai_key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "anthropic_key", regex: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { name: "github_pat", regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "stripe_key", regex: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "slack_token", regex: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g },
  { name: "ssh_private_key", regex: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]+?-----END[^-]+PRIVATE KEY-----/g },
  { name: "env_secret", regex: /\b(SECRET_[A-Z0-9_]+|[A-Z0-9_]+_TOKEN|PASSWORD|API_KEY)\s*=\s*["']?([^"'\s]+)["']?/g },
]

const RISK: RegExp[] = [
  /^\.env(\.|$)/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.ssh\/id_/,
  /\.pem$/,
  /\.key$/,
]

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

export function isHighRiskPath(path: string): boolean {
  return RISK.some((item) => item.test(path))
}

export type ScrubbedEvent<T> =
  | { success: true; data: T; report: { client_scrubbed: true; redactionsByType: Record<string, number> } }
  | { success: false; data: T; report: { client_scrubbed: false; redactionsByType: Record<string, number>; failureReason: string } }

export class Scrubber {
  constructor(private readonly opts: { patterns?: Pattern[] } = {}) {}

  scrubEvent<T>(event: T): ScrubbedEvent<T> {
    const totals: Record<string, number> = {}
    try {
      const data = this.walk(event, totals) as T
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

  private walk(node: unknown, totals: Record<string, number>): unknown {
    if (typeof node === "string") {
      const out = scrubString(node, this.opts.patterns)
      for (const [key, val] of Object.entries(out.redactionsByType)) totals[key] = (totals[key] ?? 0) + val
      return out.value
    }
    if (Array.isArray(node)) return node.map((item) => this.walk(item, totals))
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(node)) out[key] = this.walk(val, totals)
      return out
    }
    return node
  }
}
