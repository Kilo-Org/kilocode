/**
 * Tests for redirect loop detection in previous-docs-redirects.js
 *
 * This test suite verifies that the redirect configuration has no loops:
 * 1. Direct loops: A path redirecting to itself (source === destination)
 * 2. Indirect loops: A chain of redirects leading back to a starting point (A → B → C → A)
 */

import { expect, describe, it } from "vitest"
import redirects from "../previous-docs-redirects.js"

interface Redirect {
	source: string
	destination: string
	basePath?: boolean
	permanent?: boolean
}

describe("previous-docs-redirects", () => {
	describe("direct loop detection", () => {
		it("should not have any redirects where source equals destination", () => {
			const directLoops: Redirect[] = []

			for (const redirect of redirects as Redirect[]) {
				if (redirect.source === redirect.destination) {
					directLoops.push(redirect)
				}
			}

			if (directLoops.length > 0) {
				const loopDetails = directLoops.map((r) => `  - "${r.source}" redirects to itself`).join("\n")
				expect.fail(`Found ${directLoops.length} direct redirect loop(s):\n${loopDetails}`)
			}
		})
	})

	describe("indirect loop detection", () => {
		it("should not have any redirect chains that form a cycle", () => {
			// Build a map of source -> destination for quick lookup
			// Note: We only consider exact path matches, not wildcard patterns like :path*
			// Also skip direct loops (source === destination) as they're caught by the direct loop test
			const redirectMap = new Map<string, string>()

			for (const redirect of redirects as Redirect[]) {
				// Skip wildcard redirects as they don't form exact chains
				// Skip direct loops as they're caught by the direct loop test
				if (
					!redirect.source.includes(":") &&
					!redirect.source.includes("*") &&
					redirect.source !== redirect.destination
				) {
					redirectMap.set(redirect.source, redirect.destination)
				}
			}

			const cycles: string[][] = []

			/**
			 * Detects if following redirects from a starting path leads back to any path in the chain.
			 * Uses a visited set to track the current chain and detect cycles.
			 */
			function detectCycle(startPath: string): string[] | null {
				const visited = new Set<string>()
				const chain: string[] = [startPath]
				let currentPath = startPath

				while (redirectMap.has(currentPath)) {
					const nextPath = redirectMap.get(currentPath)!

					if (visited.has(nextPath)) {
						// Found a cycle - return the chain from the cycle start
						const cycleStartIndex = chain.indexOf(nextPath)
						if (cycleStartIndex !== -1) {
							return [...chain.slice(cycleStartIndex), nextPath]
						}
						return null
					}

					visited.add(currentPath)
					chain.push(nextPath)
					currentPath = nextPath
				}

				return null
			}

			// Check each redirect source for potential cycles
			for (const source of redirectMap.keys()) {
				const cycle = detectCycle(source)
				if (cycle) {
					// Avoid duplicate cycle reports by checking if we've already found this cycle
					const cycleKey = [...cycle].sort().join(" -> ")
					const isDuplicate = cycles.some(
						(existingCycle) => [...existingCycle].sort().join(" -> ") === cycleKey,
					)
					if (!isDuplicate) {
						cycles.push(cycle)
					}
				}
			}

			if (cycles.length > 0) {
				const cycleDetails = cycles.map((cycle) => `  - ${cycle.join(" → ")}`).join("\n")
				expect.fail(`Found ${cycles.length} indirect redirect cycle(s):\n${cycleDetails}`)
			}
		})
	})

	describe("redirect structure validation", () => {
		it("should have valid redirect objects with required properties", () => {
			const invalidRedirects: { index: number; issues: string[] }[] = []

			;(redirects as Redirect[]).forEach((redirect, index) => {
				const issues: string[] = []

				if (typeof redirect.source !== "string" || redirect.source.trim() === "") {
					issues.push("missing or invalid 'source' property")
				}

				if (typeof redirect.destination !== "string" || redirect.destination.trim() === "") {
					issues.push("missing or invalid 'destination' property")
				}

				if (issues.length > 0) {
					invalidRedirects.push({ index, issues })
				}
			})

			if (invalidRedirects.length > 0) {
				const details = invalidRedirects
					.map((r) => `  - Redirect at index ${r.index}: ${r.issues.join(", ")}`)
					.join("\n")
				expect.fail(`Found ${invalidRedirects.length} invalid redirect(s):\n${details}`)
			}
		})
	})
})
