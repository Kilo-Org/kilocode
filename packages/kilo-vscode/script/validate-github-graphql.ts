#!/usr/bin/env bun
/**
 * Validates GraphQL queries against GitHub's public schema.
 * Automatically extracts all identifiers from GraphQL queries in
 * src/agent-manager/pr/graphql.ts and validates them.
 *
 * Note: Schema from GitHub docs may differ from api.github.com/graphql
 * especially for Enterprise Server or preview features.
 *
 * Run with: bun run validate:github-graphql
 */

// Schema from GitHub docs - version may differ from api.github.com/graphql
// especially for Enterprise Server or preview features
const SCHEMA_URL = "https://docs.github.com/public/fpt/schema.docs.graphql"
// NOTE: This script assumes it's run from packages/kilo-vscode/ directory
// (CI sets working-directory: packages/kilo-vscode before running)
const FIELDS_FILE = "src/agent-manager/pr/graphql.ts"

async function fetchSchema(): Promise<string> {
  console.log("Fetching GitHub GraphQL schema...")
  const response = await fetch(SCHEMA_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch schema: ${response.status}`)
  }
  return await response.text()
}

function extractFields(source: string): string[] {
  const fields: string[] = []

  // Find all template literals (GraphQL queries) - matches content between backticks
  const templateRegex = /`([\s\S]*?)`/g
  let match

  while ((match = templateRegex.exec(source)) !== null) {
    const content = match[1]
    // Only process template literals that contain GraphQL
    if (!content.match(/^(query|mutation|subscription)/)) continue

    // Extract all identifiers
    const fieldRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g
    let fieldMatch

    while ((fieldMatch = fieldRegex.exec(content)) !== null) {
      fields.push(fieldMatch[1])
    }
  }

  // Remove duplicates: fields appearing in multiple queries (like 'id') only need to be validated once
  // Convert to Set (automatically unique), spread back to array, then sort alphabetically for consistent output
  return [...new Set(fields)].sort()
}

async function main() {
  console.log("Validating GitHub GraphQL schema...\n")

  const schema = await fetchSchema()
  const sourceCode = await Bun.file(FIELDS_FILE).text()
  const fields = extractFields(sourceCode)

  if (fields.length === 0) {
    console.error(`ERROR: Could not extract fields from ${FIELDS_FILE}`)
    process.exit(1)
  }

  let missing = 0

  for (const field of fields) {
    if (schema.includes(field)) {
      console.log(`  ✓ ${field}`)
    } else {
      console.log(`  ✗ ${field} NOT FOUND`)
      missing++
    }
  }

  if (missing === 0) {
    console.log(`All ${fields.length} required fields present in schema`)
    process.exit(0)
  } else {
    console.error(`ERROR: ${missing}/${fields.length} field(s) not found in schema`)
    console.error("Schema may have changed or fields may be deprecated")
    console.error("Update GraphQL queries in src/agent-manager/pr/graphql.ts if needed")
    process.exit(1) // Fail so it's visible in CI logs, but continue-on-error allows merge
  }
}

main().catch((err) => {
  console.error("Validation failed:", err)
  process.exit(1)
})
