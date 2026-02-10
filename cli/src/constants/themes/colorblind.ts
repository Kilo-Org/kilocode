/**
 * Colorblind-friendly theme for Kilo Code CLI
 *
 * Designed for users with various forms of color vision deficiency.
 * Uses high contrast colors and patterns to ensure accessibility.
 */
import type { Theme } from "../../types/theme.js"

export const colorblindTheme: Theme = {
	id: "colorblind",
	name: "Colorblind Friendly",
	type: "dark",

	brand: {
		primary: "#0072e3", // High contrast blue
		secondary: "#00b3ff", // Bright cyan for contrast
	},

	semantic: {
		success: "#00b3ff", // Bright cyan instead of green
		error: "#ff4d4d", // Bright red
		warning: "#ffcc00", // Bright yellow
		info: "#0072e3", // Blue
		neutral: "#ffffff", // White for maximum contrast
	},

	interactive: {
		prompt: "#0072e3",
		selection: "#333333",
		hover: "#404040",
		disabled: "#808080",
		focus: "#00b3ff",
	},

	messages: {
		user: "#0072e3",
		assistant: "#00b3ff",
		system: "#ffffff",
		error: "#ff4d4d",
	},

	actions: {
		approve: "#00b3ff", // Cyan instead of green
		reject: "#ff4d4d", // Red
		cancel: "#808080", // Gray
		pending: "#ffcc00", // Yellow
	},

	code: {
		addition: "#00b3ff", // Cyan for additions
		deletion: "#ff4d4d", // Red for deletions
		modification: "#ffcc00", // Yellow for modifications
		context: "#808080",
		lineNumber: "#808080",
	},

	markdown: {
		text: "#ffffff",
		heading: "#0072e3",
		strong: "#ffffff",
		em: "#cccccc",
		code: "#00b3ff",
		blockquote: "#808080",
		link: "#0072e3",
		list: "#ffffff",
	},

	ui: {
		border: {
			default: "#404040",
			active: "#00b3ff",
			warning: "#ffcc00",
			error: "#ff4d4d",
		},
		text: {
			primary: "#ffffff",
			secondary: "#cccccc",
			dimmed: "#808080",
			highlight: "#0072e3",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#00b3ff", // Cyan
		offline: "#ff4d4d", // Red
		busy: "#ffcc00", // Yellow
		idle: "#808080", // Gray
	},
}
