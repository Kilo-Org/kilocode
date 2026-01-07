/**
 * Xcode theme for Kilo Code CLI
 *
 * Based on the Xcode color scheme
 */

import type { Theme } from "../../types/theme.js"

export const xcodeTheme: Theme = {
	id: "xcode",
	name: "Xcode",
	type: "light",

	brand: {
		primary: "#1c00cf", // Use first gradient color for banner
		secondary: "#007400",
	},

	semantic: {
		success: "#007400",
		error: "#c41a16",
		warning: "#836C28",
		info: "#0E0EFF",
		neutral: "#007400",
	},

	interactive: {
		prompt: "#0E0EFF",
		selection: "#007400",
		hover: "#c41a16",
		disabled: "#c0c0c0",
		focus: "#0E0EFF",
	},

	messages: {
		user: "#0E0EFF",
		assistant: "#007400",
		system: "#444",
		error: "#c41a16",
	},

	actions: {
		approve: "#007400",
		reject: "#c41a16",
		cancel: "#c0c0c0",
		pending: "#836C28",
	},

	code: {
		addition: "#007400",
		deletion: "#c41a16",
		modification: "#836C28",
		context: "#c0c0c0",
		lineNumber: "#c0c0c0",
	},

	markdown: {
		text: "#444",
		heading: "#0E0EFF",
		strong: "#000",
		em: "#444",
		code: "#007400",
		blockquote: "#c0c0c0",
		link: "#0E0EFF",
		list: "#444",
	},

	ui: {
		border: {
			default: "#e1e4e8",
			active: "#0E0EFF",
			warning: "#836C28",
			error: "#c41a16",
		},
		text: {
			primary: "#444",
			secondary: "#c0c0c0",
			dimmed: "#c0c0c0",
			highlight: "#0E0EFF",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#007400",
		offline: "#c41a16",
		busy: "#836C28",
		idle: "#c0c0c0",
	},
}
