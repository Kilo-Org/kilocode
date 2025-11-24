/**
 * Atom One Dark theme for Kilo Code CLI
 *
 * Based on the Atom One Dark color scheme
 */

import type { Theme } from "../../types/theme.js"

export const atomOneDarkTheme: Theme = {
	id: "atom-one-dark",
	name: "Atom One Dark",
	type: "dark",

	brand: {
		primary: "#61aeee", // Use first gradient color for banner
		secondary: "#98c379",
	},

	semantic: {
		success: "#98c379",
		error: "#e06c75",
		warning: "#e6c07b",
		info: "#61aeee",
		neutral: "#5c6370",
	},

	interactive: {
		prompt: "#61aeee",
		selection: "#98c379",
		hover: "#e06c75",
		disabled: "#5c6370",
		focus: "#61aeee",
	},

	messages: {
		user: "#61aeee",
		assistant: "#98c379",
		system: "#abb2bf",
		error: "#e06c75",
	},

	actions: {
		approve: "#98c379",
		reject: "#e06c75",
		cancel: "#5c6370",
		pending: "#e6c07b",
	},

	code: {
		addition: "#98c379",
		deletion: "#e06c75",
		modification: "#e6c07b",
		context: "#5c6370",
		lineNumber: "#5c6370",
	},

	ui: {
		border: {
			default: "#5c6370",
			active: "#61aeee",
			warning: "#e6c07b",
			error: "#e06c75",
		},
		text: {
			primary: "#abb2bf",
			secondary: "#5c6370",
			dimmed: "#5c6370",
			highlight: "#61aeee",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#98c379",
		offline: "#e06c75",
		busy: "#e6c07b",
		idle: "#5c6370",
	},
}
