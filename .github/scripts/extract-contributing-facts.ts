// kilocode_change - new file
/**
 * extract-contributing-facts.ts
 *
 * Reads source-of-truth files (issue templates, workflow files) and writes a
 * structured JSON summary to contributing-facts.json (or a path given via
 * --output <path>).
 *
 * Usage:
 *   bun .github/scripts/extract-contributing-facts.ts
 *   bun .github/scripts/extract-contributing-facts.ts --output contributing-facts.json
 */

// ---------------------------------------------------------------------------
// Minimal YAML parser helpers (no external dependency needed for these simple files)
// ---------------------------------------------------------------------------

/** Extract a top-level scalar value from YAML text, e.g. `blank_issues_enabled: false` */
function yamlScalar(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match ? match[1].trim() : null
}

/** Extract a top-level list value from YAML text, e.g. `labels: ["bug"]` or `labels:\n  - bug` */
function yamlList(text: string, key: string): string[] {
  // Inline array: labels: ["bug", "discussion"]
  const inline = text.match(new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, "m"))
  if (inline) {
    return inline[1]
      .split(",")
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }
  // Block list: labels:\n  - bug
  const blockMatch = text.match(new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[^\\n]+\\n?)+)`, "m"))
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map(l => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }
  return []
}

// ---------------------------------------------------------------------------
// Issue template parsing
// ---------------------------------------------------------------------------

interface TemplateField {
  id: string
  label: string
  required: boolean
  type: string
}

interface ParsedTemplate {
  file: string
  name: string
  labels: string[]
  defaultTitle: string | null
  requiredFields: string[]
  optionalFields: string[]
}

/**
 * Very lightweight parser for GitHub issue form YAML.
 * Handles textarea, input, and checkboxes body items.
 */
function parseIssueTemplate(raw: string, file: string): ParsedTemplate {
  const name = yamlScalar(raw, "name") ?? file
  const labels = yamlList(raw, "labels")
  const titleRaw = yamlScalar(raw, "title")
  const defaultTitle = titleRaw ? titleRaw.replace(/^["']|["']$/g, "") : null

  // Split body items by `  - type:` lines
  const bodySection = raw.match(/^body:\s*\n([\s\S]+)/m)
  const fields: TemplateField[] = []

  if (bodySection) {
    // Split on lines that start a new item (two-space indent + `- type:`)
    const items = bodySection[1].split(/\n(?=  - type:)/)
    for (const item of items) {
      const typeMatch = item.match(/^\s*-\s*type:\s*(\S+)/)
      if (!typeMatch) continue
      const type = typeMatch[1]

      // Extract id (may be absent for some items)
      const idMatch = item.match(/^\s+id:\s*(\S+)/m)
      const id = idMatch ? idMatch[1] : ""

      // Extract label from attributes.label
      const labelMatch = item.match(/^\s+label:\s*(.+)$/m)
      const label = labelMatch ? labelMatch[1].trim().replace(/^["']|["']$/g, "") : id

      // Determine required:
      // - For textarea/input: validations.required: true
      // - For checkboxes: options[].required: true
      let required = false
      if (type === "checkboxes") {
        required = /required:\s*true/.test(item)
      } else {
        required = /validations:\s*\n\s+required:\s*true/.test(item)
      }

      fields.push({ id, label, required, type })
    }
  }

  const requiredFields = fields.filter(f => f.required).map(f => f.label)
  const optionalFields = fields.filter(f => !f.required).map(f => f.label)

  return { file, name, labels, defaultTitle, requiredFields, optionalFields }
}

// ---------------------------------------------------------------------------
// Workflow file parsing helpers
// ---------------------------------------------------------------------------

/** Extract the twoHours constant value in hours from compliance-close.yml */
function extractComplianceHours(raw: string): number {
  // Pattern: const twoHours = 2 * 60 * 60 * 1000
  const match = raw.match(/const\s+twoHours\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  if (match) return parseInt(match[1], 10)

  // Fallback: look for any N * 60 * 60 * 1000 pattern near "compliance" or "twoHours"
  const generic = raw.match(/=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  if (generic) return parseInt(generic[1], 10)

  console.warn("WARNING: Could not parse compliance window hours from compliance-close.yml; using default 2")
  return 2
}

/** Extract DAYS_BEFORE_STALE and DAYS_BEFORE_CLOSE from stale-issues.yml */
function extractStaleDays(raw: string): { staleDays: number; closeDays: number } {
  const staleMatch = raw.match(/DAYS_BEFORE_STALE:\s*(\d+)/)
  const closeMatch = raw.match(/DAYS_BEFORE_CLOSE:\s*(\d+)/)

  if (!staleMatch) {
    console.warn("WARNING: Could not parse DAYS_BEFORE_STALE from stale-issues.yml; using default 90")
  }
  if (!closeMatch) {
    console.warn("WARNING: Could not parse DAYS_BEFORE_CLOSE from stale-issues.yml; using default 7")
  }

  return {
    staleDays: staleMatch ? parseInt(staleMatch[1], 10) : 90,
    closeDays: closeMatch ? parseInt(closeMatch[1], 10) : 7,
  }
}

/** Extract DAYS_INACTIVE from close-stale-prs.yml */
function extractPrStaleDays(raw: string): number {
  const match = raw.match(/const\s+DAYS_INACTIVE\s*=\s*(\d+)/)
  if (match) return parseInt(match[1], 10)

  console.warn("WARNING: Could not parse DAYS_INACTIVE from close-stale-prs.yml; using default 60")
  return 60
}

/** Extract the PR title regex pattern from pr-standards.yml */
function extractPrTitleRegex(raw: string): string {
  // Pattern: const titlePattern = /^(feat|fix|...)\s*(\([a-zA-Z0-9-]+\))?\s*:/;
  const match = raw.match(/const\s+titlePattern\s*=\s*\/([^/]+)\//)
  if (match) return match[1]

  console.warn("WARNING: Could not parse titlePattern from pr-standards.yml; using default")
  return "^(feat|fix|docs|chore|refactor|test)\\s*(\\([a-zA-Z0-9-]+\\))?\\s*:"
}

/** Extract the list of valid prefixes from the titlePattern in pr-standards.yml */
function extractPrPrefixes(raw: string): string[] {
  const match = raw.match(/const\s+titlePattern\s*=\s*\/\^\(([^)]+)\)/)
  if (match) {
    return match[1].split("|").map(s => s.trim()).filter(Boolean)
  }

  console.warn("WARNING: Could not parse PR prefixes from pr-standards.yml; using defaults")
  return ["feat", "fix", "docs", "chore", "refactor", "test"]
}

/** Extract the skip-issue-check prefixes from pr-standards.yml */
function extractSkipIssuePrefixes(raw: string): string[] {
  // Pattern: const skipIssueCheck = /^(docs|refactor)\s*(\([a-zA-Z0-9-]+\))?\s*:/.test(title);
  const match = raw.match(/skipIssueCheck\s*=\s*\/\^\(([^)]+)\)/)
  if (match) {
    return match[1].split("|").map(s => s.trim()).filter(Boolean)
  }

  console.warn("WARNING: Could not parse skipIssueCheck prefixes from pr-standards.yml; using defaults")
  return ["docs", "refactor"]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text()
  } catch (err) {
    console.warn(`WARNING: Could not read ${path}: ${err}`)
    return null
  }
}

async function main() {
  // Parse --output argument
  const args = process.argv.slice(2)
  const outputIdx = args.indexOf("--output")
  const outputPath = outputIdx !== -1 && args[outputIdx + 1]
    ? args[outputIdx + 1]
    : "contributing-facts.json"

  // --- Issue templates ---
  const templateFiles = ["bug-report.yml", "feature-request.yml", "question.yml"]
  const templates: ParsedTemplate[] = []

  for (const file of templateFiles) {
    const raw = await readFileSafe(`.github/ISSUE_TEMPLATE/${file}`)
    if (raw) {
      templates.push(parseIssueTemplate(raw, file))
    } else {
      console.warn(`WARNING: Skipping template ${file} (could not read)`)
    }
  }

  // --- config.yml ---
  const configRaw = await readFileSafe(".github/ISSUE_TEMPLATE/config.yml")
  const blankIssuesEnabled = configRaw
    ? yamlScalar(configRaw, "blank_issues_enabled") === "true"
    : false

  // --- compliance-close.yml ---
  const complianceRaw = await readFileSafe(".github/workflows/compliance-close.yml")
  const autoCloseWindowHours = complianceRaw ? extractComplianceHours(complianceRaw) : 2

  // --- stale-issues.yml ---
  const staleRaw = await readFileSafe(".github/workflows/stale-issues.yml")
  const { staleDays, closeDays } = staleRaw ? extractStaleDays(staleRaw) : { staleDays: 90, closeDays: 7 }

  // --- close-stale-prs.yml ---
  const prStaleRaw = await readFileSafe(".github/workflows/close-stale-prs.yml")
  const prDaysBeforeClose = prStaleRaw ? extractPrStaleDays(prStaleRaw) : 60

  // --- pr-standards.yml ---
  const prRaw = await readFileSafe(".github/workflows/pr-standards.yml")
  const prTitlePattern = prRaw ? extractPrTitleRegex(prRaw) : "^(feat|fix|docs|chore|refactor|test)\\s*(\\([a-zA-Z0-9-]+\\))?\\s*:"
  const prPrefixes = prRaw ? extractPrPrefixes(prRaw) : ["feat", "fix", "docs", "chore", "refactor", "test"]
  const linkedIssueExemptions = prRaw ? extractSkipIssuePrefixes(prRaw) : ["docs", "refactor"]

  // --- Compliance rules (hardcoded: extracted from the AI prompt in duplicate-issues.yml)
  // These are hardcoded because they live inside a natural-language AI prompt and cannot
  // be reliably parsed programmatically. Update this list if the prompt in
  // .github/workflows/duplicate-issues.yml changes.
  const complianceRules = [
    "Must use one of the three issue templates (Bug Report, Feature Request, or Question)",
    "Required fields must contain real content (not placeholder text)",
    "No AI-generated walls of text",
    "Bug reports must include reproduction context",
    "Feature requests must explain the problem or need",
  ]

  // --- Build structured output ---
  const bugTemplate = templates.find(t => t.file === "bug-report.yml")
  const featureTemplate = templates.find(t => t.file === "feature-request.yml")
  const questionTemplate = templates.find(t => t.file === "question.yml")

  const facts = {
    generatedAt: new Date().toISOString(),
    blankIssuesEnabled,
    templates: {
      bugReport: bugTemplate
        ? {
            labels: bugTemplate.labels,
            requiredFields: bugTemplate.requiredFields,
            optionalFields: bugTemplate.optionalFields,
          }
        : { labels: ["bug"], requiredFields: ["Description"], optionalFields: [] },
      featureRequest: featureTemplate
        ? {
            labels: featureTemplate.labels,
            titlePrefix: featureTemplate.defaultTitle ?? "[FEATURE]:",
            requiredCheckboxes: featureTemplate.requiredFields.filter((_, i) => {
              // Checkboxes are the first required fields in feature-request.yml
              const field = templates
                .find(t => t.file === "feature-request.yml")
              return field !== undefined
            }),
            requiredFields: featureTemplate.requiredFields,
          }
        : {
            labels: ["discussion"],
            titlePrefix: "[FEATURE]:",
            requiredCheckboxes: ["I have verified this feature hasn't been suggested before"],
            requiredFields: ["description"],
          },
      question: questionTemplate
        ? {
            labels: questionTemplate.labels,
            requiredFields: questionTemplate.requiredFields,
          }
        : { labels: ["question"], requiredFields: ["question"] },
    },
    compliance: {
      autoCloseWindowHours,
      rules: complianceRules,
    },
    stale: {
      issueDaysBeforeStale: staleDays,
      issueDaysBeforeClose: closeDays,
      prDaysBeforeClose,
    },
    prTitles: {
      pattern: prTitlePattern,
      prefixes: prPrefixes,
      linkedIssueExemptions,
    },
  }

  await Bun.write(outputPath, JSON.stringify(facts, null, 2) + "\n")
  console.log(`Facts written to ${outputPath}`)
}

main().catch(err => {
  console.error("ERROR:", err)
  process.exit(1)
})
