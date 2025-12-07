/**
 * Dark theme for Axon Code CLI
 *
 * Colors matched to VSCode extension's dark theme for consistency.
 */

import type { Theme } from "../../types/theme.js"

export const darkTheme: Theme = {
	id: "dark",
	name: "Dark",

	brand: {
		primary: "#3affa3",
		secondary: "#000000",
	},

	semantic: {
		success: "#3affa3",
		error: "#f48771",
		warning: "#cca700",
		info: "#3794ff",
		neutral: "#cccccc",
	},

	interactive: {
		prompt: "#3794ff",
		selection: "#264f78",
		hover: "#2a2d2e",
		disabled: "#858585",
		focus: "#007fd4",
	},

	messages: {
		user: "#3794ff",
		assistant: "#3affa3",
		system: "#cccccc",
		error: "#f48771",
	},

	actions: {
		approve: "#3affa3",
		reject: "#f48771",
		cancel: "#858585",
		pending: "#cca700",
	},

	code: {
		addition: "#3affa3",
		deletion: "#f48771",
		modification: "#cca700",
		context: "#858585",
		lineNumber: "#858585",
	},

	ui: {
		border: {
			default: "#3c3c3c",
			active: "#007fd4",
			warning: "#cca700",
			error: "#f48771",
		},
		text: {
			primary: "#cccccc",
			secondary: "#858585",
			dimmed: "#6e6e6e",
			highlight: "#faf74f",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#3affa3",
		offline: "#f48771",
		busy: "#cca700",
		idle: "#858585",
	},
}
