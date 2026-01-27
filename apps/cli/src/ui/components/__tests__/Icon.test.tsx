import { render } from "ink-testing-library"

import { Icon, isNerdFontSupported, resetNerdFontCache, getIconChar } from "../Icon.js"

describe("Icon", () => {
	beforeEach(() => {
		// Reset cache before each test
		resetNerdFontCache()
		// Clear environment variables
		delete process.env.ROOCODE_NERD_FONT
	})

	afterEach(() => {
		resetNerdFontCache()
		delete process.env.ROOCODE_NERD_FONT
	})

	describe("rendering", () => {
		it("should render folder icon", () => {
			const { lastFrame } = render(<Icon name="folder" />)
			// Should render something (either nerd font or fallback)
			expect(lastFrame()).toBeDefined()
		})

		it("should render file icon", () => {
			const { lastFrame } = render(<Icon name="file" />)
			expect(lastFrame()).toBeDefined()
		})

		it("should render check icon", () => {
			const { lastFrame } = render(<Icon name="check" />)
			expect(lastFrame()).toBeDefined()
		})

		it("should render cross icon", () => {
			const { lastFrame } = render(<Icon name="cross" />)
			expect(lastFrame()).toBeDefined()
		})

		it("should apply color prop", () => {
			const { lastFrame } = render(<Icon name="file" color="blue" />)
			expect(lastFrame()).toBeDefined()
		})

		it("should return null for unknown icon name", () => {
			// @ts-expect-error - testing invalid icon name
			const { lastFrame } = render(<Icon name="unknown-icon" />)
			expect(lastFrame()).toBe("")
		})
	})

	describe("Nerd Font detection", () => {
		it("should respect ROOCODE_NERD_FONT=1 environment variable", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(true)
		})

		it("should respect ROOCODE_NERD_FONT=true environment variable", () => {
			process.env.ROOCODE_NERD_FONT = "true"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(true)
		})

		it("should respect ROOCODE_NERD_FONT=0 environment variable", () => {
			process.env.ROOCODE_NERD_FONT = "0"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(false)
		})

		it("should respect ROOCODE_NERD_FONT=false environment variable", () => {
			process.env.ROOCODE_NERD_FONT = "false"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(false)
		})

		it("should cache detection result", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()
			const first = isNerdFontSupported()
			// Change env var - should still use cached value
			process.env.ROOCODE_NERD_FONT = "0"
			const second = isNerdFontSupported()
			expect(first).toBe(true)
			expect(second).toBe(true) // Still true because cached
		})

		it("should reset cache when resetNerdFontCache is called", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(true)

			// Reset and change
			process.env.ROOCODE_NERD_FONT = "0"
			resetNerdFontCache()
			expect(isNerdFontSupported()).toBe(false)
		})
	})

	describe("useNerdFont prop override", () => {
		it("should force Nerd Font when useNerdFont=true", () => {
			process.env.ROOCODE_NERD_FONT = "0"
			resetNerdFontCache()

			const { lastFrame } = render(<Icon name="folder" useNerdFont={true} />)
			// The nerd font icon is a surrogate pair
			const frame = lastFrame() || ""
			// Surrogate pair should be present (even if it renders oddly in tests)
			expect(frame.length).toBeGreaterThan(0)
		})

		it("should force fallback when useNerdFont=false", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()

			const { lastFrame } = render(<Icon name="folder" useNerdFont={false} />)
			const frame = lastFrame() || ""
			// Fallback for folder is "▼" (single char)
			expect(frame).toContain("▼")
		})
	})

	describe("getIconChar", () => {
		it("should return fallback character when Nerd Font disabled", () => {
			process.env.ROOCODE_NERD_FONT = "0"
			resetNerdFontCache()

			expect(getIconChar("folder")).toBe("▼")
			expect(getIconChar("file")).toBe("●")
			expect(getIconChar("check")).toBe("✓")
			expect(getIconChar("cross")).toBe("✗")
		})

		it("should return Nerd Font character when enabled", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()

			// Nerd Font icons are single characters (length 1)
			expect(getIconChar("folder").length).toBe(1)
			expect(getIconChar("file").length).toBe(1)
		})

		it("should respect useNerdFont override", () => {
			process.env.ROOCODE_NERD_FONT = "1"
			resetNerdFontCache()

			// Force fallback
			expect(getIconChar("folder", false)).toBe("▼")

			process.env.ROOCODE_NERD_FONT = "0"
			resetNerdFontCache()

			// Force Nerd Font
			expect(getIconChar("folder", true).length).toBe(1)
		})

		it("should return empty string for unknown icon", () => {
			// @ts-expect-error - testing invalid icon name
			expect(getIconChar("unknown")).toBe("")
		})
	})
})
