import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Provider, createStore } from "jotai"
import { MessageList } from "../MessageList"
import { sessionMessagesAtomFamily } from "../../state/atoms/messages"
import { sessionInputAtomFamily } from "../../state/atoms/sessions"
import type { ClineMessage } from "@roo-code/types"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock vscode postMessage
vi.mock("../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock TooltipProvider for StandardTooltip
vi.mock("../../../../components/ui", () => ({
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("MessageList", () => {
	const sessionId = "test-session"

	describe("handleCopyToInput", () => {
		it("appends suggestion to empty input", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: JSON.stringify({
						question: "What do you want to do?",
						suggest: [{ answer: "Option A" }, { answer: "Option B" }],
					}),
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			const copyButtons = screen.getAllByLabelText("chat:followUpSuggest.copyToInput")
			fireEvent.click(copyButtons[0])

			expect(store.get(sessionInputAtomFamily(sessionId))).toBe("Option A")
		})

		it("appends suggestion to existing input with space and newline", () => {
			const store = createStore()
			store.set(sessionInputAtomFamily(sessionId), "Existing text")
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: JSON.stringify({
						question: "What do you want to do?",
						suggest: [{ answer: "Option A" }],
					}),
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			const copyButtons = screen.getAllByLabelText("chat:followUpSuggest.copyToInput")
			fireEvent.click(copyButtons[0])

			expect(store.get(sessionInputAtomFamily(sessionId))).toBe("Existing text \nOption A")
		})
	})

	describe("extractFollowUpData", () => {
		it("extracts question and suggestions from JSON text", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: JSON.stringify({
						question: "Choose an option",
						suggest: [{ answer: "Yes" }, { answer: "No" }],
					}),
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			expect(screen.getByText("Choose an option")).toBeInTheDocument()
			expect(screen.getByText("Yes")).toBeInTheDocument()
			expect(screen.getByText("No")).toBeInTheDocument()
		})

		it("falls back to plain text when JSON parsing fails", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: "Plain question without JSON",
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			expect(screen.getByText("Plain question without JSON")).toBeInTheDocument()
		})

		it("extracts from metadata when available", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: "",
					metadata: {
						question: "Metadata question",
						suggest: [{ answer: "From metadata" }],
					},
				} as unknown as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			expect(screen.getByText("Metadata question")).toBeInTheDocument()
			expect(screen.getByText("From metadata")).toBeInTheDocument()
		})

		it("prioritizes metadata over parsed JSON", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "followup",
					text: JSON.stringify({
						question: "JSON question",
						suggest: [{ answer: "From JSON" }],
					}),
					metadata: {
						question: "Metadata question",
						suggest: [{ answer: "From metadata" }],
					},
				} as unknown as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			expect(screen.getByText("Metadata question")).toBeInTheDocument()
			expect(screen.getByText("From metadata")).toBeInTheDocument()
			expect(screen.queryByText("JSON question")).not.toBeInTheDocument()
		})
	})
})
