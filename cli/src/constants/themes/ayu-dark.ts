/**
 * Ayu Dark theme for Kilo Code CLI
 *
 * Based on the Ayu Dark color scheme
 */

import type { Theme } from "../../types/theme.js"

export const ayuDarkTheme: Theme = {
	id: "ayu-dark",
	name: "Ayu Dark",
	type: "dark",

	brand: {
		primary: "#FFB454", // Use first gradient color for banner
		secondary: "#F26D78",
	},

	semantic: {
		success: "#AAD94C",
		error: "#F26D78",
		warning: "#FFB454",
		info: "#59C2FF",
		neutral: "#646A71",
	},

	interactive: {
		prompt: "#59C2FF",
		selection: "#FFB454",
		hover: "#D2A6FF",
		disabled: "#646A71",
		focus: "#59C2FF",
	},

	messages: {
		user: "#59C2FF",
		assistant: "#AAD94C",
		system: "#aeaca6",
		error: "#F26D78",
	},

	actions: {
		approve: "#AAD94C",
		reject: "#F26D78",
		cancel: "#646A71",
		pending: "#FFB454",
	},

	code: {
		addition: "#AAD94C",
		deletion: "#F26D78",
		modification: "#FFB454",
		context: "#646A71",
		lineNumber: "#646A71",
	},

	markdown: {
		text: "#aeaca6",
		heading: "#FFB454",
		strong: "#ffffff",
		em: "#aeaca6",
		code: "#AAD94C",
		blockquote: "#646A71",
		link: "#59C2FF",
		list: "#aeaca6",
	},

	ui: {
		border: {
			default: "#3D4149",
			active: "#59C2FF",
			warning: "#FFB454",
			error: "#F26D78",
		},
		text: {
			primary: "#aeaca6",
			secondary: "#646A71",
			dimmed: "#646A71",
			highlight: "#FFB454",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#AAD94C",
		offline: "#F26D78",
		busy: "#FFB454",
		idle: "#646A71",
	},
}
