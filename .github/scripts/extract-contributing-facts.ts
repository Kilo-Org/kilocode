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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Extract a top-level scalar value from YAML text, e.g. `blank_issues_enabled: false` */
function yamlScalar(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m"))
  return match ? match[1].trim() : null
}

/** Extract a top-level list value from YAML text, e.g. `labels: ["bug"]` or `labels:\n  - bug` */
function yamlList(text: string, key: string): string[] {
  const escaped = escapeRegex(key)
  // Inline array: labels: ["bug", "discussion"]
  const inline = text.match(new RegExp(`^${escaped}:\\s*\\[([^\\]]+)\\]`, "m"))
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }
  // Block list: labels:\n  - bug
  const blockMatch = text.match(new RegExp(`^${escaped}:\\s*\\n((?:[ \\t]+-[^\\n]+\\n?)+)`, "m"))
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((l) =>
        l
          .replace(/^\s*-\s*/, "")
          .trim()
          .replace(/^["']|["']$/g, ""),
      )
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
  requiredOptionLabels?: string[]
}

interface ParsedTemplate {
  file: string
  name: string
  labels: string[]
  defaultTitle: string | null
  requiredFields: string[]
  requiredCheckboxLabels: string[]
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
      // - For checkboxes: any options[].required: true
      let required = false
      let requiredOptionLabels: string[] | undefined

      if (type === "checkboxes") {
        // Parse each option under `options:` to collect labels of required ones
        const optionsSection = item.match(/options:\s*\n([\s\S]+)/)
        if (optionsSection) {
          const optItems = optionsSection[1].split(/\n(?=\s+-\s+label:)/)
          const reqLabels: string[] = []
          for (const opt of optItems) {
            if (/required:\s*true/.test(opt)) {
              const optLabel = opt.match(/label:\s*(.+)/)
              if (optLabel) reqLabels.push(optLabel[1].trim().replace(/^["']|["']$/g, ""))
            }
          }
          if (reqLabels.length > 0) {
            required = true
            requiredOptionLabels = reqLabels
          }
        }
      } else {
        required = /validations:\s*\n\s+required:\s*true/.test(item)
      }

      fields.push({ id, label, required, type, requiredOptionLabels })
    }
  }

  const requiredFields = fields.filter((f) => f.required).map((f) => f.label)
  const requiredCheckboxLabels = fields
    .filter((f) => f.required && f.type === "checkboxes")
    .flatMap((f) => f.requiredOptionLabels ?? [])
  const optionalFields = fields.filter((f) => !f.required).map((f) => f.label)

  return { file, name, labels, defaultTitle, requiredFields, requiredCheckboxLabels, optionalFields }
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

  throw new Error(
    "Could not parse compliance window hours from compliance-close.yml — update the regex if the file format changed",
  )
}

/** Extract DAYS_BEFORE_STALE and DAYS_BEFORE_CLOSE from stale-issues.yml */
function extractStaleDays(raw: string): { staleDays: number; closeDays: number } {
  const staleMatch = raw.match(/DAYS_BEFORE_STALE:\s*(\d+)/)
  const closeMatch = raw.match(/DAYS_BEFORE_CLOSE:\s*(\d+)/)

  if (!staleMatch)
    throw new Error(
      "Could not parse DAYS_BEFORE_STALE from stale-issues.yml — update the regex if the file format changed",
    )
  if (!closeMatch)
    throw new Error(
      "Could not parse DAYS_BEFORE_CLOSE from stale-issues.yml — update the regex if the file format changed",
    )

  return {
    staleDays: parseInt(staleMatch[1], 10),
    closeDays: parseInt(closeMatch[1], 10),
  }
}

/** Extract DAYS_INACTIVE from close-stale-prs.yml */
function extractPrStaleDays(raw: string): number {
  const match = raw.match(/const\s+DAYS_INACTIVE\s*=\s*(\d+)/)
  if (match) return parseInt(match[1], 10)

  throw new Error(
    "Could not parse DAYS_INACTIVE from close-stale-prs.yml — update the regex if the file format changed",
  )
}

/** Extract the PR title regex pattern from pr-standards.yml */
function extractPrTitleRegex(raw: string): string {
  // Pattern: const titlePattern = /^(feat|fix|...)\s*(\([a-zA-Z0-9-]+\))?\s*:/;
  const match = raw.match(/const\s+titlePattern\s*=\s*\/([^/]+)\//)
  if (match) return match[1]

  throw new Error("Could not parse titlePattern from pr-standards.yml — update the regex if the file format changed")
}

/** Extract the list of valid prefixes from the titlePattern in pr-standards.yml */
function extractPrPrefixes(raw: string): string[] {
  const match = raw.match(/const\s+titlePattern\s*=\s*\/\^\(([^)]+)\)/)
  if (match) {
    return match[1]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  throw new Error("Could not parse PR prefixes from pr-standards.yml — update the regex if the file format changed")
}

/** Extract the skip-issue-check prefixes from pr-standards.yml */
function extractSkipIssuePrefixes(raw: string): string[] {
  // Pattern: const skipIssueCheck = /^(docs|refactor)\s*(\([a-zA-Z0-9-]+\))?\s*:/.test(title);
  const match = raw.match(/skipIssueCheck\s*=\s*\/\^\(([^)]+)\)/)
  if (match) {
    return match[1]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  throw new Error(
    "Could not parse skipIssueCheck prefixes from pr-standards.yml — update the regex if the file format changed",
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await Bun.file(path).text()
  } catch (err) {
    return null
  }
}

async function readFileRequired(path: string): Promise<string> {
  try {
    return await Bun.file(path).text()
  } catch (err) {
    throw new Error(`Required source file missing: ${path} — ${err}`)
  }
}

async function main() {
  // Parse --output argument
  const args = process.argv.slice(2)
  const outputIdx = args.indexOf("--output")
  const outputPath = outputIdx !== -1 && args[outputIdx + 1] ? args[outputIdx + 1] : "contributing-facts.json"

  // --- Issue templates ---
  const templateFiles = ["bug-report.yml", "feature-request.yml", "question.yml"]
  const templates: ParsedTemplate[] = []

  for (const file of templateFiles) {
    const raw = await readFileRequired(`.github/ISSUE_TEMPLATE/${file}`)
    templates.push(parseIssueTemplate(raw, file))
  }

  // --- config.yml ---
  const configRaw = await readFileSafe(".github/ISSUE_TEMPLATE/config.yml")
  const blankIssuesEnabled = configRaw ? yamlScalar(configRaw, "blank_issues_enabled") === "true" : false

  // --- compliance-close.yml ---
  const complianceRaw = await readFileRequired(".github/workflows/compliance-close.yml")
  const autoCloseWindowHours = extractComplianceHours(complianceRaw)

  // --- stale-issues.yml ---
  const staleRaw = await readFileRequired(".github/workflows/stale-issues.yml")
  const { staleDays, closeDays } = extractStaleDays(staleRaw)

  // --- close-stale-prs.yml ---
  const prStaleRaw = await readFileRequired(".github/workflows/close-stale-prs.yml")
  const prDaysBeforeClose = extractPrStaleDays(prStaleRaw)

  // --- pr-standards.yml ---
  const prRaw = await readFileRequired(".github/workflows/pr-standards.yml")
  const prTitlePattern = extractPrTitleRegex(prRaw)
  const prPrefixes = extractPrPrefixes(prRaw)
  const linkedIssueExemptions = extractSkipIssuePrefixes(prRaw)

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
  const bugTemplate = templates.find((t) => t.file === "bug-report.yml")
  const featureTemplate = templates.find((t) => t.file === "feature-request.yml")
  const questionTemplate = templates.find((t) => t.file === "question.yml")

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
            requiredCheckboxes: featureTemplate.requiredCheckboxLabels,
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

main().catch((err) => {
  console.error("ERROR:", err)
  process.exit(1)
})
