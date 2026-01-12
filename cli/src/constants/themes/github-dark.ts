/**
 * GitHub Dark theme for Kilo Code CLI
 *
 * Based on the GitHub Dark color scheme
 */

import type { Theme } from "../../types/theme.js"

export const githubDarkTheme: Theme = {
	id: "github-dark",
	name: "GitHub Dark",
	type: "dark",

	brand: {
		primary: "#58a6ff", // Use first gradient color for banner
		secondary: "#3fb950",
	},

	semantic: {
		success: "#3fb950",
		error: "#f85149",
		warning: "#d29922",
		info: "#58a6ff",
		neutral: "#8b949e",
	},

	interactive: {
		prompt: "#58a6ff",
		selection: "#3fb950",
		hover: "#f85149",
		disabled: "#8b949e",
		focus: "#58a6ff",
	},

	messages: {
		user: "#58a6ff",
		assistant: "#3fb950",
		system: "#c9d1d9",
		error: "#f85149",
	},

	actions: {
		approve: "#3fb950",
		reject: "#f85149",
		cancel: "#8b949e",
		pending: "#d29922",
	},

	code: {
		addition: "#3fb950",
		deletion: "#f85149",
		modification: "#d29922",
		context: "#8b949e",
		lineNumber: "#8b949e",
	},

	markdown: {
		text: "#c9d1d9",
		heading: "#58a6ff",
		strong: "#ffffff",
		em: "#c9d1d9",
		code: "#3fb950",
		blockquote: "#8b949e",
		link: "#58a6ff",
		list: "#c9d1d9",
	},

	ui: {
		border: {
			default: "#30363d",
			active: "#58a6ff",
			warning: "#d29922",
			error: "#f85149",
		},
		text: {
			primary: "#c9d1d9",
			secondary: "#8b949e",
			dimmed: "#8b949e",
			highlight: "#58a6ff",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#3fb950",
		offline: "#f85149",
		busy: "#d29922",
		idle: "#8b949e",
	},
}
