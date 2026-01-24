/**
 * Architecture test: Agent Manager CSS must use "am-" prefix
 *
 * The agent manager runs in the same webview context as other UI.
 * All its CSS classes must be prefixed with "am-" to avoid conflicts.
 *
 * @vitest-environment node
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// CSS file is in webview-ui, navigate from src/core/kilocode/agent-manager/__tests__
const CSS_FILE = path.resolve(
	__dirname,
	"../../../../../webview-ui/src/kilocode/agent-manager/components/AgentManagerApp.css",
)

describe("Agent Manager CSS Prefix", () => {
	it("all class selectors should use am- prefix", () => {
		const css = fs.readFileSync(CSS_FILE, "utf-8")

		// Extract all class selectors (e.g., .foo-bar, .am-sidebar)
		const classPattern = /\.([a-z][a-z0-9-]*)/gi
		const matches = [...css.matchAll(classPattern)]
		const classNames = [...new Set(matches.map((m) => m[1]))]

		const invalid = classNames.filter((name) => !name.startsWith("am-") && name !== "agent-manager-container")

		expect(invalid, `Classes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
	})

	it("all CSS custom properties should use am- prefix", () => {
		const css = fs.readFileSync(CSS_FILE, "utf-8")

		// Find custom property definitions (--foo-bar:)
		const propPattern = /--([a-z][a-z0-9-]*)\s*:/gi
		const matches = [...css.matchAll(propPattern)]
		const propNames = [...new Set(matches.map((m) => m[1]))]

		const invalid = propNames.filter((name) => !name.startsWith("am-") && !name.startsWith("vscode-"))

		expect(invalid, `CSS properties missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
	})

	it("all @keyframes should use am- prefix", () => {
		const css = fs.readFileSync(CSS_FILE, "utf-8")

		const keyframePattern = /@keyframes\s+([a-z][a-z0-9-]*)/gi
		const matches = [...css.matchAll(keyframePattern)]
		const names = matches.map((m) => m[1])

		const invalid = names.filter((name) => !name.startsWith("am-"))

		expect(invalid, `Keyframes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
	})
})
