// npx vitest run src/components/settings/__tests__/DisplaySettings.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import { DisplaySettings } from "../DisplaySettings"

// Mock the translation context
vi.mock("../../../i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			// Return fixed English strings for tests
			const translations: { [key: string]: string } = {
				"settings:sections.display": "Display",
				"settings:display.taskTimeline.label": "Show task timeline",
				"settings:display.taskTimeline.description": "Display task messages as a color-coded visual timeline",
				"settings:display.showTimestamps.label": "Show event timestamps",
				"settings:display.showTimestamps.description": "Display timestamps for chat messages and events",
			}
			return translations[key] || key
		},
	}),
}))

// Mock VSCodeCheckbox to render as regular HTML checkbox for testing
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange({ target: { checked: e.target.checked } })}
				data-testid="vscode-checkbox"
			/>
			{children}
		</label>
	),
}))

// Mock the TaskTimeline component
vi.mock("../../chat/TaskTimeline", () => ({
	TaskTimeline: ({ groupedMessages, isTaskActive }: any) => (
		<div data-testid="task-timeline-preview">
			TaskTimeline Preview ({groupedMessages?.length || 0} messages, active: {isTaskActive ? "yes" : "no"})
		</div>
	),
}))

// Mock the timeline mockData utility
vi.mock("../../../utils/timeline/mockData", () => ({
	generateSampleTimelineData: () => [
		{ ts: 1000, type: "ask", ask: "command" },
		{ ts: 2000, type: "say", say: "text" },
		{ ts: 3000, type: "ask", ask: "tool" },
	],
}))

describe("DisplaySettings", () => {
	const mockSetCachedStateField = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders all display settings components", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		expect(screen.getByText("Display")).toBeInTheDocument()
		expect(screen.getByText("Show task timeline")).toBeInTheDocument()
		expect(screen.getByText("Show event timestamps")).toBeInTheDocument()
		expect(screen.getByTestId("task-timeline-preview")).toBeInTheDocument()
	})

	it("renders task timeline checkbox with correct initial state", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const taskTimelineCheckbox = screen.getByText("Show task timeline").closest("label")
		const checkbox = taskTimelineCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		expect(checkbox).toBeChecked()
	})

	it("renders showTimestamps checkbox with correct initial state", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const showTimestampsCheckbox = screen.getByText("Show event timestamps").closest("label")
		const checkbox = showTimestampsCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		expect(checkbox).not.toBeChecked()
	})

	it("calls setCachedStateField when task timeline checkbox is toggled", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const taskTimelineCheckbox = screen.getByText("Show task timeline").closest("label")
		const checkbox = taskTimelineCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(mockSetCachedStateField).toHaveBeenCalledWith("showTaskTimeline", false)
	})

	it("calls setCachedStateField when showTimestamps checkbox is toggled", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const showTimestampsCheckbox = screen.getByText("Show event timestamps").closest("label")
		const checkbox = showTimestampsCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		fireEvent.click(checkbox)

		expect(mockSetCachedStateField).toHaveBeenCalledWith("showTimestamps", true)
	})

	it("renders task timeline preview with sample data", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const preview = screen.getByTestId("task-timeline-preview")
		expect(preview).toHaveTextContent("TaskTimeline Preview (3 messages, active: no)")
	})

	it("renders descriptions for both settings", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		expect(screen.getByText("Display task messages as a color-coded visual timeline")).toBeInTheDocument()
		expect(screen.getByText("Display timestamps for chat messages and events")).toBeInTheDocument()
	})

	it("handles both checkboxes being checked", () => {
		render(
			<DisplaySettings
				showTaskTimeline={true}
				showTimestamps={true}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const taskTimelineCheckbox = screen.getByText("Show task timeline").closest("label")
		const showTimestampsCheckbox = screen.getByText("Show event timestamps").closest("label")

		const taskTimelineInput = taskTimelineCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement
		const showTimestampsInput = showTimestampsCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		expect(taskTimelineInput).toBeChecked()
		expect(showTimestampsInput).toBeChecked()
	})

	it("handles both checkboxes being unchecked", () => {
		render(
			<DisplaySettings
				showTaskTimeline={false}
				showTimestamps={false}
				reasoningBlockCollapsed={false} // kilocode_change
				setCachedStateField={mockSetCachedStateField}
			/>,
		)

		const taskTimelineCheckbox = screen.getByText("Show task timeline").closest("label")
		const showTimestampsCheckbox = screen.getByText("Show event timestamps").closest("label")

		const taskTimelineInput = taskTimelineCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement
		const showTimestampsInput = showTimestampsCheckbox?.querySelector('input[type="checkbox"]') as HTMLInputElement

		expect(taskTimelineInput).not.toBeChecked()
		expect(showTimestampsInput).not.toBeChecked()
	})
})
