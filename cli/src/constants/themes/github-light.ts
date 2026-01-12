/**
 * GitHub Light theme for Kilo Code CLI
 *
 * Based on the GitHub Light color scheme
 */

import type { Theme } from "../../types/theme.js"

export const githubLightTheme: Theme = {
	id: "github-light",
	name: "GitHub Light",
	type: "light",

	brand: {
		primary: "#458", // Use first gradient color for banner
		secondary: "#008080",
	},

	semantic: {
		success: "#008080",
		error: "#d14",
		warning: "#990073",
		info: "#0086b3",
		neutral: "#998",
	},

	interactive: {
		prompt: "#0086b3",
		selection: "#008080",
		hover: "#d14",
		disabled: "#999",
		focus: "#0086b3",
	},

	messages: {
		user: "#0086b3",
		assistant: "#008080",
		system: "#24292e",
		error: "#d14",
	},

	actions: {
		approve: "#008080",
		reject: "#d14",
		cancel: "#999",
		pending: "#990073",
	},

	code: {
		addition: "#008080",
		deletion: "#d14",
		modification: "#990073",
		context: "#998",
		lineNumber: "#999",
	},

	markdown: {
		text: "#24292e",
		heading: "#0086b3",
		strong: "#000000",
		em: "#24292e",
		code: "#008080",
		blockquote: "#998",
		link: "#0086b3",
		list: "#24292e",
	},

	ui: {
		border: {
			default: "#e1e4e8",
			active: "#0086b3",
			warning: "#990073",
			error: "#d14",
		},
		text: {
			primary: "#24292e",
			secondary: "#998",
			dimmed: "#999",
			highlight: "#0086b3",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#008080",
		offline: "#d14",
		busy: "#990073",
		idle: "#999",
	},
}
