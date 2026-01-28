import { createElement } from "react"

import { type OnboardingResult, OnboardingProviderChoice } from "@/types/index.js"
import { login } from "@/commands/index.js"
import { saveSettings } from "@/lib/storage/index.js"

export async function runOnboarding(): Promise<OnboardingResult> {
	const { render } = await import("ink")
	const { OnboardingScreen } = await import("../../ui/components/onboarding/index.js")

	return new Promise<OnboardingResult>((resolve) => {
		const onSelect = async (choice: OnboardingProviderChoice) => {
			await saveSettings({ onboardingProviderChoice: choice })

			app.unmount()

			console.log("")

			if (choice === OnboardingProviderChoice.Roo) {
				const { success: authenticated } = await login()
				await saveSettings({ onboardingProviderChoice: choice })
				resolve({ choice: OnboardingProviderChoice.Roo, authenticated, skipped: false })
			} else {
				console.log("Using your own API key.")
				console.log("Set your API key via --api-key or environment variable.")
				console.log("")
				resolve({ choice: OnboardingProviderChoice.Byok, skipped: false })
			}
		}

		const app = render(createElement(OnboardingScreen, { onSelect }))
	})
}
