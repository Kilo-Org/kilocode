#!/usr/bin/env bun
/**
 * Validates GraphQL queries against GitHub's public schema using AST type checking.
 * Parses all queries in src/agent-manager/pr/graphql.ts and validates them against
 * the schema using the `graphql` package — catching wrong fields, type mismatches,
 * and missing required arguments, not just substring matches.
 *
 * Note: Schema fetched from GitHub Docs (FPT) — may lag slightly behind
 * api.github.com/graphql after GitHub deploys schema changes. For exact parity,
 * run introspection locally via `gh api graphql` (requires authenticated gh CLI).
 *
 * Run with: bun run validate:github-graphql
 */

import { buildASTSchema, parse, validate } from "graphql"
import * as queries from "../src/agent-manager/pr/graphql"

const SCHEMA_URL = "https://docs.github.com/public/fpt/schema.docs.graphql"

async function fetchSchema(): Promise<string> {
	console.log("Fetching GitHub GraphQL schema...")
	const response = await fetch(SCHEMA_URL)
	if (!response.ok) throw new Error(`Failed to fetch schema: ${response.status}`)
	return response.text()
}

function extractQueries(): { name: string; query: string }[] {
	return Object.entries(queries)
		.filter(([ , val]) => typeof val === "string" && /^(query|mutation|subscription)/.test(val.trim()))
		.map(([name, val]) => ({ name, query: (val as string).trim() }))
}

async function main() {
	console.log("Validating GitHub GraphQL queries...\n")

	const sdl = await fetchSchema()
	// buildASTSchema with assumeValid: skip internal schema consistency checks —
	// the GitHub Docs SDL has deprecated-field interface mismatches that would
	// otherwise throw before we get to validate our queries
	const schema = buildASTSchema(parse(sdl), { assumeValid: true })
	const found = extractQueries()

	if (found.length === 0) {
		console.error("ERROR: No GraphQL queries found in src/agent-manager/pr/graphql.ts")
		process.exit(1)
	}

	let failed = 0

	for (const { name, query } of found) {
		const doc = parse(query)
		const errors = validate(schema, doc)
		if (errors.length === 0) {
			console.log(`  ✓ ${name}`)
		} else {
			console.log(`  ✗ ${name}`)
			for (const err of errors) console.log(`      ${err.message}`)
			failed++
		}
	}

	if (failed === 0) {
		console.log(`\nAll ${found.length} queries valid`)
		process.exit(0)
	} else {
		console.error(`\n${failed}/${found.length} queries failed validation`)
		console.error("Update GraphQL queries in src/agent-manager/pr/graphql.ts")
		process.exit(1)
	}
}

main().catch((err) => {
	console.error("Validation failed:", err)
	process.exit(1)
})
