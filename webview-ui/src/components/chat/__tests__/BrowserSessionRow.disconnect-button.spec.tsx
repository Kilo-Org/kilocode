import React from "react"
import { render, screen } from "@testing-library/react"
import BrowserSessionRow from "../BrowserSessionRow"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { TooltipProvider } from "@radix-ui/react-tooltip"

describe("BrowserSessionRow - Disconnect session button", () => {
	const renderRow = (isActive: boolean) => {
		const mockExtState: any = {
			browserViewportSize: "900x600",
			isBrowserSessionActive: isActive,
		}

		return render(
			<TooltipProvider>
				<ExtensionStateContext.Provider value={mockExtState}>
					<BrowserSessionRow
						messages={[] as any}
						isExpanded={() => false}
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

	it("shows the Disconnect session button when a session is active", () => {
		renderRow(true)
		const btn = screen.getByLabelText("Disconnect session")
		expect(btn).toBeInTheDocument()
	})

	it("does not render the button when no session is active", () => {
		renderRow(false)
		const btn = screen.queryByLabelText("Disconnect session")
		expect(btn).toBeNull()
	})
})
