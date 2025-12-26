import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Provider, createStore } from "jotai"
import { MessageList } from "../MessageList"
import { sessionMessagesAtomFamily } from "../../state/atoms/messages"
import { sessionInputAtomFamily } from "../../state/atoms/sessions"
import { sessionMessageQueueAtomFamily } from "../../state/atoms/messageQueue"
import type { ClineMessage } from "@roo-code/types"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
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

// Mock react-virtuoso - tracks rendered items for testing
vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: any) => (
		<div data-testid="virtuoso-list" data-item-count={data.length}>
			{data.map((item: any, index: number) => (
				<div key={index} data-testid={`virtuoso-item-${index}`}>
					{itemContent(index, item)}
				</div>
			))}
		</div>
	),
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

	describe("updateTodoList filtering", () => {
		it("does not render updateTodoList tool messages (text format)", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "say",
					say: "text",
					text: "Starting task",
				} as ClineMessage,
				{
					ts: 2,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "updateTodoList",
						todos: [{ id: "1", content: "Task 1", status: "in_progress" }],
					}),
				} as ClineMessage,
				{
					ts: 3,
					type: "say",
					say: "text",
					text: "Task completed",
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			// The text messages should be rendered
			expect(screen.getByText("Starting task")).toBeInTheDocument()
			expect(screen.getByText("Task completed")).toBeInTheDocument()
			// The todo list tool message should NOT be rendered (displayed in header instead)
			expect(screen.queryByText(/updateTodoList/)).not.toBeInTheDocument()
			expect(screen.queryByText(/Task 1/)).not.toBeInTheDocument()
		})

		it("does not render updateTodoList tool messages (metadata format from CLI)", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "say",
					say: "text",
					text: "Starting task",
				} as ClineMessage,
				{
					ts: 2,
					type: "ask",
					ask: "tool",
					metadata: {
						tool: "updateTodoList",
						todos: [{ id: "1", content: "Task 1", status: "in_progress" }],
					},
				} as ClineMessage,
				{
					ts: 3,
					type: "say",
					say: "text",
					text: "Task completed",
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			// The text messages should be rendered
			expect(screen.getByText("Starting task")).toBeInTheDocument()
			expect(screen.getByText("Task completed")).toBeInTheDocument()
			// The todo list tool message should NOT be rendered (displayed in header instead)
			expect(screen.queryByText(/updateTodoList/)).not.toBeInTheDocument()
			expect(screen.queryByText(/Task 1/)).not.toBeInTheDocument()
		})

		it("renders other tool messages normally", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "ask",
					ask: "tool",
					text: JSON.stringify({
						tool: "readFile",
						path: "/some/file.ts",
					}),
				} as ClineMessage,
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			// Other tool messages should still be rendered
			expect(screen.getByText("messages.tool")).toBeInTheDocument()
		})
	})

	describe("isLast calculation with queued messages", () => {
		it("marks the last regular message as isLast even when queued messages exist", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "say",
					say: "text",
					text: "First message",
				} as ClineMessage,
				{
					ts: 2,
					type: "say",
					say: "text",
					text: "Second message",
				} as ClineMessage,
			])
			store.set(sessionMessageQueueAtomFamily(sessionId), [
				{
					id: "queued-1",
					sessionId,
					content: "Queued message",
					status: "queued" as const,
					retryCount: 0,
					maxRetries: 3,
					timestamp: Date.now(),
				},
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			// Verify all items are rendered (2 messages + 1 queued)
			const virtuosoList = screen.getByTestId("virtuoso-list")
			expect(virtuosoList.getAttribute("data-item-count")).toBe("3")

			// Verify all content is rendered
			expect(screen.getByText("First message")).toBeInTheDocument()
			expect(screen.getByText("Second message")).toBeInTheDocument()
			expect(screen.getByText("Queued message")).toBeInTheDocument()
		})

		it("renders queued messages after regular messages in the list", () => {
			const store = createStore()
			store.set(sessionMessagesAtomFamily(sessionId), [
				{
					ts: 1,
					type: "say",
					say: "text",
					text: "Regular message",
				} as ClineMessage,
			])
			store.set(sessionMessageQueueAtomFamily(sessionId), [
				{
					id: "queued-1",
					sessionId,
					content: "First queued",
					status: "queued" as const,
					retryCount: 0,
					maxRetries: 3,
					timestamp: Date.now(),
				},
				{
					id: "queued-2",
					sessionId,
					content: "Second queued",
					status: "queued" as const,
					retryCount: 0,
					maxRetries: 3,
					timestamp: Date.now(),
				},
			])

			render(
				<Provider store={store}>
					<MessageList sessionId={sessionId} />
				</Provider>,
			)

			// Verify order: regular message at index 0, queued at indices 1 and 2
			const item0 = screen.getByTestId("virtuoso-item-0")
			const item1 = screen.getByTestId("virtuoso-item-1")
			const item2 = screen.getByTestId("virtuoso-item-2")

			expect(item0).toHaveTextContent("Regular message")
			expect(item1).toHaveTextContent("First queued")
			expect(item2).toHaveTextContent("Second queued")
		})
	})
})
