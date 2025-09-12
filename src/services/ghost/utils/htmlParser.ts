// kilocode_change: DOM adapter for browser/Node.js compatibility
import { JSDOM } from "jsdom"

// JSDOM is used in the extension for SVG code highlighting.
// We render sample SVGs in Storybook for testing/ debugging purposes,
// but use actual browser APIs instead of JSDOM there.
export function parseHtmlDocument(html: string): Document {
	if (typeof window !== "undefined" && typeof DOMParser !== "undefined") {
		// Browser environment - use native DOM
		return new DOMParser().parseFromString(html, "text/html")
	} else {
		// Node.js environment - use JSDOM (stubbed in browser builds)
		return new JSDOM(html).window.document
	}
}
