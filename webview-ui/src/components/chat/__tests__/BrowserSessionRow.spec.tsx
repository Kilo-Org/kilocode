import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import BrowserSessionRow from "../BrowserSessionRow"

// Mock ExtensionStateContext so BrowserSessionRow falls back to props
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => {
		throw new Error("No ExtensionStateContext in test environment")
	},
}))

// Simplify i18n usage and provide initReactI18next for i18n setup
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Replace ProgressIndicator with a simple test marker
vi.mock("../ProgressIndicator", () => ({
	ProgressIndicator: () => <div data-testid="browser-session-spinner" />,
}))

const baseProps = {
	isExpanded: () => false,
	onToggleExpand: () => {},
	lastModifiedMessage: undefined,
	isLast: true,
	onHeightChange: () => {},
	isStreaming: false,
}

describe("BrowserSessionRow - action spinner", () => {
	it("does not show spinner when there are no browser actions", () => {
		const messages = [
			{
				type: "say",
				say: "task",
				ts: 1,
				text: "Task started",
			} as any,
		]

		render(<BrowserSessionRow {...baseProps} messages={messages} />)

		expect(screen.queryByTestId("browser-session-spinner")).toBeNull()
	})

	it("shows spinner while the latest browser action is still running", () => {
		const messages = [
			{
				type: "say",
				say: "task",
				ts: 1,
				text: "Task started",
			} as any,
			{
				type: "say",
				say: "browser_action",
				ts: 2,
				text: JSON.stringify({ action: "click" }),
			} as any,
			{
				type: "say",
				say: "browser_action_result",
				ts: 3,
				text: JSON.stringify({ currentUrl: "https://example.com" }),
			} as any,
			{
				type: "say",
				say: "browser_action",
				ts: 4,
				text: JSON.stringify({ action: "scroll_down" }),
			} as any,
		]

		render(<BrowserSessionRow {...baseProps} messages={messages} />)

		expect(screen.getByTestId("browser-session-spinner")).toBeInTheDocument()
	})

	it("hides spinner once the latest browser action has a result", () => {
		const messages = [
			{
				type: "say",
				say: "task",
				ts: 1,
				text: "Task started",
			} as any,
			{
				type: "say",
				say: "browser_action",
				ts: 2,
				text: JSON.stringify({ action: "click" }),
			} as any,
			{
				type: "say",
				say: "browser_action_result",
				ts: 3,
				text: JSON.stringify({ currentUrl: "https://example.com" }),
			} as any,
			{
				type: "say",
				say: "browser_action",
				ts: 4,
				text: JSON.stringify({ action: "scroll_down" }),
			} as any,
			{
				type: "say",
				say: "browser_action_result",
				ts: 5,
				text: JSON.stringify({ currentUrl: "https://example.com/page2" }),
			} as any,
		]

		render(<BrowserSessionRow {...baseProps} messages={messages} />)

		expect(screen.queryByTestId("browser-session-spinner")).toBeNull()
	})
})
