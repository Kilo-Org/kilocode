/**
 * redactor.ts — API key/token secret pattern masking
 * Ported from abtop (MIT)
 * Deps: none
 */

const PREFIXES = [
  "sk-ant-", "sk-proj-", "sk-or-",
  "sk_live_", "sk_test_", "rk_live_", "rk_test_",
  "ghp_", "gho_", "ghs_", "ghr_", "ghu_", "github_pat_",
  "glpat-",
  "xoxb-", "xoxp-", "xoxa-", "xoxs-",
  "AKIA", "ASIA",
  "Bearer ",
]

export function redact(input: string): string {
  let result = input
  for (const pat of PREFIXES) {
    let pos: number
    while ((pos = result.indexOf(pat)) !== -1) {
      const end = result.slice(pos).search(/\s/) 
      const boundary = end === -1 ? result.length : pos + end
      result = result.slice(0, pos) + "[REDACTED]" + result.slice(boundary)
    }
  }
  return result
}

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

export function sanitizeTerminal(input: string): string {
  return input.replace(CTRL, "").replace(BIDI, "")
}
