import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import BrowserSessionRow from "../BrowserSessionRow"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { TooltipProvider } from "@src/components/ui/tooltip"

describe("BrowserSessionRow - screenshot area", () => {
	const renderRow = (messages: any[]) => {
		const mockExtState: any = {
			// Ensure known viewport so expected aspect ratio is deterministic (600/900 = 66.67%)
			browserViewportSize: "900x600",
			isBrowserSessionActive: false,
		}

		return render(
			<TooltipProvider>
				<ExtensionStateContext.Provider value={mockExtState}>
					<BrowserSessionRow
						messages={messages as any}
						isExpanded={() => true}
						onToggleExpand={() => {}}
						lastModifiedMessage={undefined as any}
						isLast={true}
						onHeightChange={() => {}}
						isStreaming={false}
					/>
				</ExtensionStateContext.Provider>
			</TooltipProvider>,
		)
	}

	it("reserves height while screenshot is loading (no layout collapse)", () => {
		// Only a launch action, no corresponding browser_action_result yet (no screenshot)
		const messages = [
			{
				ts: 1,
				say: "browser_action",
				text: JSON.stringify({ action: "launch", url: "http://localhost:3000" }),
			},
		]

		renderRow(messages)

		// Open the browser session drawer
		const globe = screen.getByLabelText("Browser interaction")
		fireEvent.click(globe)

		const container = screen.getByTestId("screenshot-container") as HTMLDivElement
		// padding-bottom should reflect aspect ratio (600/900 * 100) even without an image
		const pb = parseFloat(container.style.paddingBottom || "0")
		expect(pb).toBeGreaterThan(0)
		// Be tolerant of rounding
		expect(Math.round(pb)).toBe(67)
	})
})
