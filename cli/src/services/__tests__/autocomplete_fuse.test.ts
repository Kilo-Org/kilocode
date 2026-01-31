
import { describe, it, expect } from "vitest"
import { getSuggestions } from "../autocomplete"

describe("Autocomplete Fuse Integration (Public API)", () => {

    it("should return suggestions for fuzzy queries", () => {
        // "hepl" vs "help" - Transposition
        // Current implementation linear scan fails here.
        // Fuse should handle "hepl" -> "help" with a good score.

        const strictResults = getSuggestions("/hepl")
        const strictHelpMatch = strictResults.find(r => r.command.name === "help")

        // This EXPECTATION is that it currently FAILS (returns undefined) and will PASS with Fuse.
        expect(strictHelpMatch).toBeDefined()
    })

    it("should provide highlightedName with ANSI colors", () => {
        const results = getSuggestions("/help")
        const helpMatch = results.find(r => r.command.name === "help")

        expect(helpMatch).toBeDefined()
        if (helpMatch) {
            // Current implementation returns plain text
            // We want it to be highlighted.
            // Typically ANSI codes start with \u001b or \x1b
            expect(helpMatch.highlightedName).toMatch(/\u001b\[/)
        }
    })

    it("falls back gracefully for no matches", () => {
        const results = getSuggestions("/zzzzzz")
        expect(results).toHaveLength(0)
    })
})
