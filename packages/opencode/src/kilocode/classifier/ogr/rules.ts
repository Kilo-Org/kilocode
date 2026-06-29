import type { Composition, ConfigRules } from "@openguardrails/core"

// kilocode_change start — default OGR policy for the command-approval gate (issue #9138)

/**
 * Default deterministic OGR `config_rules` — the regex layer that runs alongside
 * the LLM judge. High-confidence, resource-based rules that don't need a model.
 * Override via the `classifier.rules` config (copy-the-default-then-edit).
 */
export const DEFAULT_RULES: ConfigRules = {
  command_rules: [
    {
      id: "rm-rf-root",
      regex: "rm\\s+-rf\\s+/(\\s|$)",
      category: "security.malicious_command",
      domain: "security",
      decision: "block",
      score: 1.0,
      why: "destructive recursive delete of the filesystem root",
    },
    {
      id: "pipe-to-shell",
      regex: "(curl|wget)\\b.*\\|\\s*(ba)?sh",
      category: "security.malicious_command",
      domain: "security",
      decision: "block",
      score: 0.9,
      why: "remote script fetched and piped directly into a shell",
    },
    {
      id: "secret-file-access",
      regex: "(\\.env\\b|/\\.aws/credentials|/\\.ssh/id_|auth\\.json)",
      category: "security.secret_leak",
      domain: "security",
      decision: "block",
      score: 0.95,
      why: "command references a credential file — independent of the reader",
    },
  ],
}

/**
 * Default composition: deny-wins across the detectors, failing closed for
 * `security.*`. Override via `classifier.composition`.
 */
export const DEFAULT_COMPOSITION: Composition = {
  "security.*": { strategy: "deny-wins", on_all_failed: "block" },
  default: { strategy: "deny-wins" },
}

// kilocode_change end
