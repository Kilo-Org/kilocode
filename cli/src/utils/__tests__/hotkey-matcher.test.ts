/**
 * Tests for hotkey matching utilities
 */

import { describe, it, expect } from "vitest"
import { matchesHotkey, isPrintableInput } from "../hotkey-matcher.js"
import type { Key } from "../../types/keypress.js"
import type { HotkeyDefinition } from "../../constants/keyboard/hotkeys.js"

describe("matchesHotkey", () => {
	it("should match exact key name", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return" }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should not match different key name", () => {
		const key: Key = {
			name: "escape",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\x1b",
		}

		const hotkey: HotkeyDefinition = [{ name: "return" }]

		expect(matchesHotkey(key, hotkey)).toBe(false)
	})

	it("should match key with ctrl modifier", () => {
		const key: Key = {
			name: "return",
			ctrl: true,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", ctrl: true }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should not match when ctrl modifier doesn't match", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", ctrl: true }]

		expect(matchesHotkey(key, hotkey)).toBe(false)
	})

	it("should match key with shift modifier", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: true,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", shift: true }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should match key with meta modifier", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: true,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", meta: true }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should match when modifier is undefined (don't care)", () => {
		const key: Key = {
			name: "a",
			ctrl: true,
			meta: false,
			shift: false,
			paste: false,
			sequence: "a",
		}

		// Hotkey doesn't specify ctrl, so it should match regardless
		const hotkey: HotkeyDefinition = [{ name: "a" }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should match when all modifiers are specified correctly", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", ctrl: false, meta: false, shift: false }]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should not match when one modifier is wrong", () => {
		const key: Key = {
			name: "return",
			ctrl: true,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		const hotkey: HotkeyDefinition = [{ name: "return", ctrl: false, meta: false, shift: false }]

		expect(matchesHotkey(key, hotkey)).toBe(false)
	})

	it("should match any combination in OR logic", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: true,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		// Hotkey matches either Shift+Enter OR Alt+Enter
		const hotkey: HotkeyDefinition = [
			{ name: "return", shift: true },
			{ name: "return", meta: true },
		]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should match first combination in OR logic", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: true,
			paste: false,
			sequence: "\r",
		}

		// Hotkey matches either Shift+Enter OR Alt+Enter
		const hotkey: HotkeyDefinition = [
			{ name: "return", shift: true },
			{ name: "return", meta: true },
		]

		expect(matchesHotkey(key, hotkey)).toBe(true)
	})

	it("should not match when no combination matches", () => {
		const key: Key = {
			name: "return",
			ctrl: true,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		// Hotkey matches either Shift+Enter OR Alt+Enter
		const hotkey: HotkeyDefinition = [
			{ name: "return", shift: true },
			{ name: "return", meta: true },
		]

		expect(matchesHotkey(key, hotkey)).toBe(false)
	})
})

describe("isPrintableInput", () => {
	it("should return true for regular character", () => {
		const key: Key = {
			name: "a",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "a",
		}

		expect(isPrintableInput(key)).toBe(true)
	})

	it("should return true for uppercase character with shift", () => {
		const key: Key = {
			name: "A",
			ctrl: false,
			meta: false,
			shift: true,
			paste: false,
			sequence: "A",
		}

		expect(isPrintableInput(key)).toBe(true)
	})

	it("should return false for paste event", () => {
		const key: Key = {
			name: "a",
			ctrl: false,
			meta: false,
			shift: false,
			paste: true,
			sequence: "abc",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for ctrl combination", () => {
		const key: Key = {
			name: "a",
			ctrl: true,
			meta: false,
			shift: false,
			paste: false,
			sequence: "a",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for meta combination", () => {
		const key: Key = {
			name: "a",
			ctrl: false,
			meta: true,
			shift: false,
			paste: false,
			sequence: "a",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for multi-character sequence", () => {
		const key: Key = {
			name: "abc",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "abc",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for special key: return", () => {
		const key: Key = {
			name: "return",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\r",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for special key: escape", () => {
		const key: Key = {
			name: "escape",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\x1b",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for special key: tab", () => {
		const key: Key = {
			name: "tab",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\t",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for arrow key", () => {
		const key: Key = {
			name: "up",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\x1b[A",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return false for function key", () => {
		const key: Key = {
			name: "f1",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "\x1bOP",
		}

		expect(isPrintableInput(key)).toBe(false)
	})

	it("should return true for space character", () => {
		const key: Key = {
			name: " ",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: " ",
		}

		expect(isPrintableInput(key)).toBe(true)
	})

	it("should return true for number", () => {
		const key: Key = {
			name: "5",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "5",
		}

		expect(isPrintableInput(key)).toBe(true)
	})

	it("should return true for punctuation", () => {
		const key: Key = {
			name: "!",
			ctrl: false,
			meta: false,
			shift: false,
			paste: false,
			sequence: "!",
		}

		expect(isPrintableInput(key)).toBe(true)
	})
})
