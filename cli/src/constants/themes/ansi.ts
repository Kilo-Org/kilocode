/**
 * ANSI theme for Kilo Code CLI
 *
 * Based on the ANSI color scheme using standard terminal colors
 */

import type { Theme } from "../../types/theme.js"

export const ansiTheme: Theme = {
	id: "ansi",
	name: "ANSI",

	brand: {
		primary: "cyan", // Use first gradient color for banner
		secondary: "green",
	},

	semantic: {
		success: "green",
		error: "red",
		warning: "yellow",
		info: "cyan",
		neutral: "gray",
	},

	interactive: {
		prompt: "cyan",
		selection: "green",
		hover: "bluebright",
		disabled: "gray",
		focus: "cyan",
	},

	messages: {
		user: "bluebright",
		assistant: "green",
		system: "white",
		error: "red",
	},

	actions: {
		approve: "green",
		reject: "red",
		cancel: "gray",
		pending: "yellow",
	},

	code: {
		addition: "green",
		deletion: "red",
		modification: "yellow",
		context: "gray",
		lineNumber: "gray",
	},

	ui: {
		border: {
			default: "gray",
			active: "cyan",
			warning: "yellow",
			error: "red",
		},
		text: {
			primary: "white",
			secondary: "gray",
			dimmed: "gray",
			highlight: "cyan",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "green",
		offline: "red",
		busy: "yellow",
		idle: "gray",
	},
}
