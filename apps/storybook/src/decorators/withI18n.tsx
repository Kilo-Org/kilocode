import { useEffect } from "react"
import type { Decorator } from "@storybook/react-vite"
import i18n from "../../../../webview-ui/src/i18n/setup"
import { loadTranslations } from "../../../../webview-ui/src/i18n/setup"
import TranslationProvider from "@/i18n/TranslationContext"

/**
 * Storybook decorator that sets up i18n for all stories
 * This eliminates the need for individual wrapper components in each story file
 */
export const withI18n: Decorator = (Story) => {
	useEffect(() => {
		loadTranslations()
		i18n.changeLanguage("en") // English
	}, [])

	return (
		<TranslationProvider>
			<Story />
		</TranslationProvider>
	)
}
