/**
 * Shades of Purple theme for Kilo Code CLI
 *
 * Based on the Shades of Purple color scheme
 */

import type { Theme } from "../../types/theme.js"

export const shadesOfPurpleTheme: Theme = {
	id: "shades-of-purple",
	name: "Shades of Purple",
	type: "dark",

	brand: {
		primary: "#4d21fc", // Use first gradient color for banner
		secondary: "#847ace",
	},

	semantic: {
		success: "#A5FF90",
		error: "#ff628c",
		warning: "#fad000",
		info: "#a1feff",
		neutral: "#B362FF",
	},

	interactive: {
		prompt: "#a1feff",
		selection: "#A5FF90",
		hover: "#ff628c",
		disabled: "#726c86",
		focus: "#a1feff",
	},

	messages: {
		user: "#a1feff",
		assistant: "#A5FF90",
		system: "#e3dfff",
		error: "#ff628c",
	},

	actions: {
		approve: "#A5FF90",
		reject: "#ff628c",
		cancel: "#726c86",
		pending: "#fad000",
	},

	code: {
		addition: "#A5FF90",
		deletion: "#ff628c",
		modification: "#fad000",
		context: "#726c86",
		lineNumber: "#726c86",
	},

	markdown: {
		text: "#e3dfff",
		heading: "#4d21fc",
		strong: "#ffffff",
		em: "#e3dfff",
		code: "#A5FF90",
		blockquote: "#726c86",
		link: "#a1feff",
		list: "#e3dfff",
	},

	ui: {
		border: {
			default: "#a599e9",
			active: "#a1feff",
			warning: "#fad000",
			error: "#ff628c",
		},
		text: {
			primary: "#e3dfff",
			secondary: "#726c86",
			dimmed: "#726c86",
			highlight: "#4d21fc",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#A5FF90",
		offline: "#ff628c",
		busy: "#fad000",
		idle: "#726c86",
	},
}
