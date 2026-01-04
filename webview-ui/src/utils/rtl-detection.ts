// RTL/Language Detection Utility
// kilocode_change - new file

/**
 * Detect if text contains Arabic characters
 */
export function isArabicText(text: string): boolean {
	// Arabic Unicode range: \u0600-\u06FF
	// Extended Arabic: \u0750-\u077F
	// Arabic Supplement: \u0870-\u089F
	// Arabic Presentation Forms-A: \uFB50-\uFDFF
	// Arabic Presentation Forms-B: \uFE70-\uFEFF
	const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\uFB50-\uFDFF\uFE70-\uFEFF]/
	return arabicRegex.test(text)
}

/**
 * Detect if text contains Hebrew characters
 */
export function isHebrewText(text: string): boolean {
	// Hebrew Unicode range: \u0590-\u05FF
	const hebrewRegex = /[\u0590-\u05FF]/
	return hebrewRegex.test(text)
}

/**
 * Detect if text contains Persian/Farsi characters
 */
export function isPersianText(text: string): boolean {
	// Persian uses Arabic script with additional characters
	// Additional Persian characters: \u067E-\u067F, \u0686-\u0687, \u0698-\u0699, \u06A4-\u06A5, \u06AF-\u06B0
	const persianRegex = /[\u067E-\u067F\u0686-\u0687\u0698-\u0699\u06A4-\u06A5\u06AF-\u06B0]/
	return persianRegex.test(text)
}

/**
 * Detect if text contains Urdu characters
 */
export function isUrduText(text: string): boolean {
	// Urdu uses Arabic script with additional characters
	// Additional Urdu characters: \u0621-\u0622, \u0628-\u062A, \u062E-\u062F, \u0641-\u0642, \u0648-\u064A, \u0679-\u067E, \u0686-\u0688, \u0691-\u0693, \u0698-\u0699, \u06A1-\u06A2, \u06AB-\u06AC, \u06BA-\u06BB, \u06BE-\u06C1, \u06C3-\u06C4, \u06CC-\u06CD, \u06D0-\u06D1
	const urduRegex =
		/[\u0621-\u0622\u0628-\u062A\u062E-\u062F\u0641-\u0642\u0648-\u064A\u0679-\u067E\u0686-\u0688\u0691-\u0693\u0698-\u0699\u06A1-\u06A2\u06AB-\u06AC\u06BA-\u06BB\u06BE-\u06C1\u06C3-\u06C4\u06CC-\u06CD\u06D0-\u06D1]/
	return urduRegex.test(text)
}

/**
 * Detect if text is RTL (Right-to-Left)
 */
export function isRTLText(text: string): boolean {
	return isArabicText(text) || isHebrewText(text) || isPersianText(text) || isUrduText(text)
}

/**
 * Get text direction for a given text
 */
export function getTextDirection(text: string): "rtl" | "ltr" {
	return isRTLText(text) ? "rtl" : "ltr"
}

/**
 * Detect if a line contains RTL text
 */
export function isLineRTL(line: string): boolean {
	// Remove common non-text characters that might interfere
	const cleanLine = line.replace(/[^\w\s\u0600-\u06FF\u0590-\u05FF]/g, "")
	return isRTLText(cleanLine)
}

/**
 * Get text direction for a line
 */
export function getLineDirection(line: string): "rtl" | "ltr" {
	return isLineRTL(line) ? "rtl" : "ltr"
}

/**
 * Split text into lines and detect direction for each line
 */
export function getLinesWithDirection(text: string): Array<{ line: string; direction: "rtl" | "ltr" }> {
	return text.split("\n").map((line) => ({
		line,
		direction: getLineDirection(line),
	}))
}

/**
 * Check if a mixed text has more RTL than LTR content
 */
export function getDominantDirection(text: string): "rtl" | "ltr" {
	const lines = getLinesWithDirection(text)
	const rtlCount = lines.filter((l) => l.direction === "rtl").length
	const ltrCount = lines.filter((l) => l.direction === "ltr").length

	return rtlCount > ltrCount ? "rtl" : "ltr"
}

/**
 * Get CSS direction style for text
 */
export function getDirectionStyle(text: string): React.CSSProperties {
	const direction = getTextDirection(text)
	return {
		direction,
		textAlign: direction === "rtl" ? "right" : "left",
		unicodeBidi: "plaintext",
	}
}

/**
 * Get CSS direction style for a line
 */
export function getLineDirectionStyle(line: string): React.CSSProperties {
	const direction = getLineDirection(line)
	return {
		direction,
		textAlign: direction === "rtl" ? "right" : "left",
		unicodeBidi: "plaintext",
	}
}
