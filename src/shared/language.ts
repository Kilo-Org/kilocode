import { type Language, isLanguage } from "@roo-code/types"

/**
 * Language name mapping from ISO codes to full language names.
 */

export const LANGUAGES: Record<Language, string> = {
	en: "English",
	ru: "Русский",
}

/**
 * Formats a VSCode locale string to ensure the region code is uppercase.
 * For example, transforms "en-us" to "en-US" or "fr-ca" to "fr-CA".
 *
 * @param vscodeLocale - The VSCode locale string to format (e.g., "en-us", "fr-ca")
 * @returns The formatted locale string with uppercase region code
 */

export function formatLanguage(vscodeLocale: string): Language {
	if (!vscodeLocale) {
		return "en"
	}

	const formattedLocale = vscodeLocale.replace(/-(\w+)$/, (_, region) => `-${region.toUpperCase()}`)
	return isLanguage(formattedLocale) ? formattedLocale : "en"
}
