/**
 * Dracula theme for Kilo Code CLI
 *
 * Based on the popular Dracula color scheme
 */

import type { Theme } from "../../types/theme.js"

export const draculaTheme: Theme = {
	id: "dracula",
	name: "Dracula",
	type: "dark",

	brand: {
		primary: "#ff79c6", // Use first gradient color for banner
		secondary: "#8be9fd",
	},

	semantic: {
		success: "#50fa7b",
		error: "#ff5555",
		warning: "#fff783",
		info: "#8be9fd",
		neutral: "#6272a4",
	},

	interactive: {
		prompt: "#8be9fd",
		selection: "#ff79c6",
		hover: "#ff79c6",
		disabled: "#6272a4",
		focus: "#8be9fd",
	},

	messages: {
		user: "#8be9fd",
		assistant: "#50fa7b",
		system: "#a3afb7",
		error: "#ff5555",
	},

	actions: {
		approve: "#50fa7b",
		reject: "#ff5555",
		cancel: "#6272a4",
		pending: "#fff783",
	},

	code: {
		addition: "#50fa7b",
		deletion: "#ff5555",
		modification: "#fff783",
		context: "#6272a4",
		lineNumber: "#6272a4",
	},

	markdown: {
		text: "#a3afb7",
		heading: "#ff79c6",
		strong: "#ffffff",
		em: "#a3afb7",
		code: "#50fa7b",
		blockquote: "#6272a4",
		link: "#8be9fd",
		list: "#a3afb7",
	},

	ui: {
		border: {
			default: "#6272a4",
			active: "#8be9fd",
			warning: "#fff783",
			error: "#ff5555",
		},
		text: {
			primary: "#a3afb7",
			secondary: "#6272a4",
			dimmed: "#6272a4",
			highlight: "#ff79c6",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#50fa7b",
		offline: "#ff5555",
		busy: "#fff783",
		idle: "#6272a4",
	},
}
