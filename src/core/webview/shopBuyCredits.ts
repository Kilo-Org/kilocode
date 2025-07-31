// kilocode_change new file

import axios from "axios"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { ClineProvider } from "./ClineProvider"
import * as vscode from "vscode"

export async function shopBuyCredits(provider: ClineProvider, message: WebviewMessage) {
	console.log("shopBuyCredits message received", message)
	try {
		const { apiConfiguration } = await provider.getState()
		const kilocodeToken = apiConfiguration?.kilocodeToken
		if (!kilocodeToken) {
			provider.log("KiloCode token not found in extension state for buy credits.")
			return
		}
		const credits = message.values?.credits || 50
		const uriScheme = message.values?.uriScheme || "vscode"
		const uiKind = message.values?.uiKind || "Desktop"
		const source = uiKind === "Web" ? "web" : uriScheme

		const response = await axios.post(
			`https://kilocode.ai/payments/topup?origin=extension&source=${source}&amount=${credits}`,
			{},
			{
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
				maxRedirects: 0, // Prevent axios from following redirects automatically
				validateStatus: (status) => status < 400, // Accept 3xx status codes
			},
		)

		if (response.status !== 303 || !response.headers.location) {
			return
		}
		await vscode.env.openExternal(vscode.Uri.parse(response.headers.location))
	} catch (error: any) {
		// Handle axios errors that might include redirect information
		if (error.response?.status === 303 && error.response?.headers?.location) {
			try {
				const redirectUrl = error.response.headers.location
				await vscode.env.openExternal(vscode.Uri.parse(redirectUrl))
				provider.log(`Opened Stripe payment URL from error response: ${redirectUrl}`)
				return
			} catch (openError) {
				provider.log(`Failed to open redirect URL from error response: ${openError}`)
			}
		}

		const errorMessage = error.response?.data?.message || error.message || "Failed to initiate payment"
		provider.log(`Error redirecting to payment page: ${errorMessage}`)
		vscode.window.showErrorMessage(`Payment error: ${errorMessage}`)
	}
}
