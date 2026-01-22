/**
 * Ayu Light theme for Kilo Code CLI
 *
 * Based on the Ayu Light color scheme
 */

import type { Theme } from "../../types/theme.js"

export const ayuLightTheme: Theme = {
	id: "ayu-light",
	name: "Ayu Light",
	type: "light",

	brand: {
		primary: "#399ee6", // Use first gradient color for banner
		secondary: "#86b300",
	},

	semantic: {
		success: "#86b300",
		error: "#f07171",
		warning: "#f2ae49",
		info: "#55b4d4",
		neutral: "#ABADB1",
	},

	interactive: {
		prompt: "#55b4d4",
		selection: "#86b300",
		hover: "#f07171",
		disabled: "#a6aaaf",
		focus: "#55b4d4",
	},

	messages: {
		user: "#55b4d4",
		assistant: "#86b300",
		system: "#5c6166",
		error: "#f07171",
	},

	actions: {
		approve: "#86b300",
		reject: "#f07171",
		cancel: "#a6aaaf",
		pending: "#f2ae49",
	},

	code: {
		addition: "#86b300",
		deletion: "#f07171",
		modification: "#f2ae49",
		context: "#a6aaaf",
		lineNumber: "#a6aaaf",
	},

	markdown: {
		text: "#5c6166",
		heading: "#55b4d4",
		strong: "#000000",
		em: "#5c6166",
		code: "#86b300",
		blockquote: "#a6aaaf",
		link: "#55b4d4",
		list: "#5c6166",
	},

	ui: {
		border: {
			default: "#e1e4e8",
			active: "#55b4d4",
			warning: "#f2ae49",
			error: "#f07171",
		},
		text: {
			primary: "#5c6166",
			secondary: "#a6aaaf",
			dimmed: "#a6aaaf",
			highlight: "#55b4d4",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#86b300",
		offline: "#f07171",
		busy: "#f2ae49",
		idle: "#a6aaaf",
	},
}
