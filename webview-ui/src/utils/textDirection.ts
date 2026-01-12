/**
 * Utility functions for detecting and handling text direction (RTL/LTR)
 */

// Unicode ranges for RTL scripts
const RTL_REGEX = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/

// List of RTL language codes
const RTL_LANGUAGES = ["ar", "he", "fa", "ur", "yi", "ps", "sd"]

/**
 * Checks if a language code represents an RTL language
 * @param languageCode - The language code to check (e.g., 'ar', 'he-IL')
 * @returns true if the language is RTL
 */
export function isRTLLanguage(languageCode: string | undefined | null): boolean {
	if (!languageCode) return false
	const primaryLang = languageCode.split("-")[0].toLowerCase()
	return RTL_LANGUAGES.includes(primaryLang)
}

/**
 * Checks if a text string contains RTL (Right-to-Left) characters
 * This includes Arabic, Hebrew, and other RTL scripts
 * @param text - The text to check
 * @returns true if the text contains RTL characters
 */
export function containsRTL(text: string | undefined | null): boolean {
	if (!text) return false
	return RTL_REGEX.test(text)
}

/**
 * Alias for containsRTL for backward compatibility
 */
export function containsRTLCharacters(text: string | undefined | null): boolean {
	return containsRTL(text)
}

/**
 * Determines the text direction based on language code or content
 * If input looks like a language code (e.g., 'ar', 'he-IL'), it uses language detection
 * Otherwise, it analyzes the first strong directional character
 * @param textOrLangCode - The text or language code to analyze
 * @returns 'rtl' or 'ltr'
 */
export function getTextDirection(textOrLangCode: string | undefined | null): "rtl" | "ltr" {
	if (!textOrLangCode) return "ltr"

	// Check if it looks like a language code (short string, with optional region)
	// Language codes are typically 2-3 letters, optionally followed by -XX region
	if (/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(textOrLangCode)) {
		// Treat as language code
		return isRTLLanguage(textOrLangCode) ? "rtl" : "ltr"
	}

	// Analyze text content - find the first strong directional character
	for (const char of textOrLangCode) {
		if (RTL_REGEX.test(char)) {
			return "rtl"
		}
		// Check for LTR characters (Latin, Greek, Cyrillic, etc.)
		if (/[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/.test(char)) {
			return "ltr"
		}
	}

	return "ltr"
}

/**
 * Alias for getTextDirection - determines direction from content
 * @param text - The text to analyze
 * @returns 'rtl' or 'ltr'
 */
export function getTextDirectionFromContent(text: string | undefined | null): "rtl" | "ltr" {
	return getTextDirection(text)
}

/**
 * Gets the CSS style object for text direction
 * @param text - The text to analyze
 * @returns CSS style object with direction and textAlign properties
 */
export function getTextDirectionStyle(text: string | undefined | null): React.CSSProperties {
	const direction = getTextDirection(text)
	return {
		direction,
		textAlign: direction === "rtl" ? "right" : "left",
	}
}
