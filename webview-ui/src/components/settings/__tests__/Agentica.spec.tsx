import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@/utils/test-utils"
import type { ProviderSettings } from "@roo-code/types"

import { Agentica } from "../providers/Agentica"
import { vscode } from "@/utils/vscode"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@/utils/passwordStorage", () => ({
	securePasswordStorage: {
		getPassword: vi.fn().mockResolvedValue(undefined),
		storePassword: vi.fn().mockResolvedValue(undefined),
		clearPassword: vi.fn().mockResolvedValue(undefined),
	},
}))

describe("Agentica provider settings", () => {
	const baseProps = {
		apiConfiguration: {} as ProviderSettings,
		setApiConfigurationField: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("sends a vscode message when GitHub device flow button is clicked", async () => {
		render(<Agentica {...baseProps} />)

		const button = screen.getByRole("button", { name: /continue with github/i })
		fireEvent.click(button)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "startAgenticaDeviceAuth" })
	})

	it("shows device auth details when extension notifies the webview", async () => {
		render(<Agentica {...baseProps} />)

		const deviceAuthEvent = new MessageEvent("message", {
			data: {
				type: "agenticaDeviceAuthStarted",
				deviceAuthCode: "ABCD-EFGH",
				deviceAuthVerificationUrl: "https://github.com/login/device",
				deviceAuthExpiresIn: 600,
			},
		})

		await act(async () => {
			window.dispatchEvent(deviceAuthEvent)
		})

		expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument()
		const link = screen.getByRole("link", { name: "https://github.com/login/device" })
		expect(link).toHaveAttribute("href", "https://github.com/login/device")
		expect(screen.getByText(/Time remaining:/)).toBeInTheDocument()
	})
})
