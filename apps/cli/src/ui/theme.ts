/**
 * Theme configuration for Roo Code CLI TUI
 * Using Hardcore color scheme
 */

// Hardcore palette
const hardcore = {
	// Accent colors
	pink: "#F92672",
	pinkLight: "#FF669D",
	green: "#A6E22E",
	greenLight: "#BEED5F",
	orange: "#FD971F",
	yellow: "#E6DB74",
	cyan: "#66D9EF",
	purple: "#9E6FFE",

	// Text colors
	text: "#F8F8F2",
	subtext1: "#CCCCC6",
	subtext0: "#A3BABF",

	// Overlay colors
	overlay2: "#A3BABF",
	overlay1: "#5E7175",
	overlay0: "#505354",

	// Surface colors
	surface2: "#505354",
	surface1: "#383a3e",
	surface0: "#2d2e2e",

	// Base colors
	base: "#1B1D1E",
	mantle: "#161819",
	crust: "#101112",
}

// Title and branding colors
export const titleColor = hardcore.orange // Orange for title
export const welcomeText = hardcore.text // Standard text
export const asciiColor = hardcore.cyan // Cyan for ASCII art

// Tips section colors
export const tipsHeader = hardcore.orange // Orange for tips headers
export const tipsText = hardcore.subtext0 // Subtle text for tips

// Header text colors (for messages)
export const userHeader = hardcore.purple // Purple for user header
export const rooHeader = hardcore.yellow // Yellow for roo
export const toolHeader = hardcore.cyan // Cyan for tool headers
export const thinkingHeader = hardcore.overlay1 // Subtle gray for thinking header

// Message text colors
export const userText = hardcore.text // Standard text for user
export const rooText = hardcore.text // Standard text for roo
export const toolText = hardcore.subtext0 // Subtle text for tool output
export const thinkingText = hardcore.overlay2 // Subtle gray for thinking text

// UI element colors
export const borderColor = hardcore.surface1 // Surface color for borders
export const borderColorActive = hardcore.purple // Active/focused border color
export const dimText = hardcore.overlay1 // Dim text
export const promptColor = hardcore.overlay2 // Prompt indicator
export const promptColorActive = hardcore.cyan // Active prompt color
export const placeholderColor = hardcore.overlay0 // Placeholder text

// Status colors
export const successColor = hardcore.green // Green for success
export const errorColor = hardcore.pink // Pink for errors
export const warningColor = hardcore.yellow // Yellow for warnings

// Focus indicator colors
export const focusColor = hardcore.cyan // Focus indicator (cyan accent)
export const scrollActiveColor = hardcore.purple // Scroll area active indicator (purple)
export const scrollTrackColor = hardcore.surface1 // Muted scrollbar track color

// Base text color
export const text = hardcore.text // Standard text color
