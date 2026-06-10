#!/usr/bin/env node
/**
 * Enterprise Network Audit Script
 *
 * Scans the source code for references to non-Bedrock network endpoints,
 * Kilo Gateway references, telemetry endpoints, and other forbidden patterns.
 *
 * Usage: node script/audit-network.js
 * Exit code 1 if forbidden patterns are found.
 */

const fs = require("fs")
const path = require("path")
const glob = require("glob")

const ROOT = path.resolve(__dirname, "..")
const SRC_DIRS = [
  path.join(ROOT, "packages", "opencode", "src"),
]

const FORBIDDEN_PATTERNS = [
  { pattern: /api\.kilo\.ai/g, name: "Kilo API endpoint (api.kilo.ai)" },
  { pattern: /app\.kilo\.ai/g, name: "Kilo Cloud UI (app.kilo.ai)" },
  { pattern: /kiloapps\.io/g, name: "Kilo Apps endpoint (kiloapps.io)" },
  { pattern: /kilosessions\.ai/g, name: "Kilo Sessions endpoint (kilosessions.ai)" },
  { pattern: /kilocode\.ai/g, name: "Kilo Code domain (kilocode.ai)" },
  { pattern: /posthog\.com/g, name: "PostHog analytics (posthog.com)" },
  { pattern: /us\.i\.posthog\.com/g, name: "PostHog US endpoint (us.i.posthog.com)" },
  { pattern: /models\.dev/g, name: "Models.dev catalog (models.dev)" },
  { pattern: /ingest\.kilosessions/g, name: "Session ingest endpoint (ingest.kilosessions)" },
  { pattern: /events\.kiloapps/g, name: "Event service endpoint (events.kiloapps)" },
  { pattern: /chat\.kiloapps/g, name: "Chat service endpoint (chat.kiloapps)" },
]

const WARN_PATTERNS = [
  { pattern: /@kilocode\/kilo-gateway/g, name: "Gateway import (@kilocode/kilo-gateway)" },
  { pattern: /createKilo/g, name: "Kilo provider creation (createKilo)" },
  { pattern: /KILO_BUNDLED_PROVIDERS/g, name: "Kilo bundled providers (KILO_BUNDLED_PROVIDERS)" },
  { pattern: /fetchDefaultModel.*kilo/g, name: "Kilo default model fetch" },
  { pattern: /fetchKiloModels/g, name: "Kilo model fetch (fetchKiloModels)" },
  { pattern: /fetchKiloEmbeddingModelCatalog/g, name: "Kilo embedding model catalog fetch" },
  { pattern: /fetchProfile.*kilo/g, name: "Kilo profile fetch" },
  { pattern: /KiloConnectionService/g, name: "Kilo connection service" },
]

const ALLOWED_PATTERNS = [
  /bedrock-runtime\..+\.amazonaws\.com/g,
  /bedrock\..+\.amazonaws\.com/g,
  /@ai-sdk\/amazon-bedrock/g,
  /amazonaws\.com/g,
]

const IGNORE_DIRS = ["node_modules", "dist", ".git", "test", "__tests__"]

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const findings = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    for (const { pattern, name } of FORBIDDEN_PATTERNS) {
      const match = pattern.test(line)
      if (match) {
        const isAllowed = ALLOWED_PATTERNS.some((ap) => ap.test(line))
        if (!isAllowed) {
          findings.push({
            type: "FORBIDDEN",
            file: path.relative(ROOT, filePath),
            line: lineNum,
            pattern: name,
            content: line.trim().substring(0, 120),
          })
        }
      }
    }
  }

  return findings
}

function scanDir(dir) {
  const findings = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue
      if (entry.name.startsWith(".")) continue

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        findings.push(...scanDir(fullPath))
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js")) {
        findings.push(...scanFile(fullPath))
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return findings
}

function main() {
  console.log("=== Enterprise Network Audit ===")
  console.log(`Scanning: ${SRC_DIRS.join(", ")}`)
  console.log("")

  const allFindings = []

  for (const dir of SRC_DIRS) {
    if (!fs.existsSync(dir)) {
      console.log(`SKIP: ${dir} (not found)`)
      continue
    }
    allFindings.push(...scanDir(dir))
  }

  if (allFindings.length === 0) {
    console.log("PASS: No forbidden network patterns found.")
    process.exit(0)
  }

  const forbidden = allFindings.filter((f) => f.type === "FORBIDDEN")

  if (forbidden.length > 0) {
    console.error(`FAIL: Found ${forbidden.length} forbidden network reference(s):\n`)
    for (const f of forbidden) {
      console.error(`  ${f.type}: ${f.pattern}`)
      console.error(`    File: ${f.file}:${f.line}`)
      console.error(`    ${f.content}`)
      console.error("")
    }
    process.exit(1)
  }

  console.log("PASS: Audit completed.")
  process.exit(0)
}

main()
