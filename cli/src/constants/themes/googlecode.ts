/**
 * Google Code theme for Kilo Code CLI
 *
 * Based on the Google Code color scheme
 */

import type { Theme } from "../../types/theme.js"

export const googleCodeTheme: Theme = {
	id: "googlecode",
	name: "Google Code",
	type: "light",

	brand: {
		primary: "#066", // Use first gradient color for banner
		secondary: "#606",
	},

	semantic: {
		success: "#080",
		error: "#800",
		warning: "#660",
		info: "#066",
		neutral: "#5f6368",
	},

	interactive: {
		prompt: "#066",
		selection: "#080",
		hover: "#800",
		disabled: "#5f6368",
		focus: "#066",
	},

	messages: {
		user: "#066",
		assistant: "#080",
		system: "#444",
		error: "#800",
	},

	actions: {
		approve: "#080",
		reject: "#800",
		cancel: "#5f6368",
		pending: "#660",
	},

	code: {
		addition: "#080",
		deletion: "#800",
		modification: "#660",
		context: "#5f6368",
		lineNumber: "#5f6368",
	},

	markdown: {
		text: "#444",
		heading: "#066",
		strong: "#000",
		em: "#444",
		code: "#080",
		blockquote: "#5f6368",
		link: "#066",
		list: "#444",
	},

	ui: {
		border: {
			default: "#e1e4e8",
			active: "#066",
			warning: "#660",
			error: "#800",
		},
		text: {
			primary: "#444",
			secondary: "#5f6368",
			dimmed: "#5f6368",
			highlight: "#066",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#080",
		offline: "#800",
		busy: "#660",
		idle: "#5f6368",
	},
}
