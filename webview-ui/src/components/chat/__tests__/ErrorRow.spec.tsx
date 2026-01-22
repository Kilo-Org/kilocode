import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"

import { ErrorRow } from "../ErrorRow"

// Mock vscode webview messaging
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock ExtensionState context
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		version: "1.0.0",
		apiConfiguration: {},
	}),
}))

// Mock selected model hook
vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		provider: "test-provider",
		id: "test-model",
	}),
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:error": "Error",
				"chat:errorDetails.title": "Error Details",
				"chat:errorDetails.copyToClipboard": "Copy to Clipboard",
				"chat:errorDetails.copied": "Copied!",
				"chat:errorDetails.diagnostics": "Get detailed error info",
			}
			return map[key] ?? key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}))

describe("ErrorRow diagnostics download", () => {
	it("sends downloadErrorDiagnostics message with error metadata", () => {
		const mockPostMessage = vi.mocked(vscode.postMessage)

		render(<ErrorRow type="error" message="Something went wrong" errorDetails="Detailed error body" />)

		// Open the Error Details dialog via the info button
		const infoButton = screen.getByRole("button", { name: "Error Details" })
		fireEvent.click(infoButton)

		// Click the diagnostics button
		const downloadButton = screen.getByRole("button", { name: "Get detailed error info" })
		fireEvent.click(downloadButton)

		expect(mockPostMessage).toHaveBeenCalled()
		const call = mockPostMessage.mock.calls.find(([arg]) => arg.type === "downloadErrorDiagnostics")
		expect(call).toBeTruthy()
		if (!call) return

		const payload = call[0] as { type: string; values?: any }
		expect(payload.values).toBeTruthy()
		if (!payload.values) return

		expect(payload.values).toMatchObject({
			version: "1.0.0",
			provider: "test-provider",
			model: "test-model",
		})
		// Timestamp is generated at runtime, but should be a string
		expect(typeof payload.values.timestamp).toBe("string")
	})
})
