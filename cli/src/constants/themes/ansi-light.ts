/**
 * ANSI Light theme for Kilo Code CLI
 *
 * Based on the ANSI Light color scheme using standard terminal colors
 */

import type { Theme } from "../../types/theme.js"

export const ansiLightTheme: Theme = {
	id: "ansi-light",
	name: "ANSI Light",
	type: "light",

	brand: {
		primary: "blue", // Use first gradient color for banner
		secondary: "green",
	},

	semantic: {
		success: "green",
		error: "red",
		warning: "orange",
		info: "cyan",
		neutral: "gray",
	},

	interactive: {
		prompt: "blue",
		selection: "green",
		hover: "blue",
		disabled: "gray",
		focus: "blue",
	},

	messages: {
		user: "blue",
		assistant: "green",
		system: "#444",
		error: "red",
	},

	actions: {
		approve: "green",
		reject: "red",
		cancel: "gray",
		pending: "orange",
	},

	code: {
		addition: "green",
		deletion: "red",
		modification: "orange",
		context: "gray",
		lineNumber: "gray",
	},

	markdown: {
		text: "#444",
		heading: "blue",
		strong: "#000",
		em: "#444",
		code: "green",
		blockquote: "gray",
		link: "blue",
		list: "#444",
	},

	ui: {
		border: {
			default: "#e1e4e8",
			active: "blue",
			warning: "orange",
			error: "red",
		},
		text: {
			primary: "#444",
			secondary: "gray",
			dimmed: "gray",
			highlight: "blue",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "green",
		offline: "red",
		busy: "orange",
		idle: "gray",
	},
}
