/**
 * Dark theme for Kilo Code CLI
 *
 * The default dark theme using standard terminal colors for maximum compatibility.
 */

import type { Theme } from "../../types/theme.js"

/**
 * Dark theme implementation
 * Uses standard terminal colors for maximum compatibility
 */
export const alphaTheme: Theme = {
	id: "alpha",
	name: "Alpha",
	type: "dark",

	brand: {
		primary: "#faf74f", // Kilo Code yellow
		secondary: "cyan",
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
		hover: "white",
		disabled: "gray",
		focus: "yellow",
	},

	messages: {
		user: "blue",
		assistant: "green",
		system: "gray",
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
		lineNumber: "cyan",
	},

	markdown: {
		text: "white",
		heading: "yellow",
		strong: "white",
		em: "white",
		code: "green",
		blockquote: "gray",
		link: "cyan",
		list: "white",
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
			dimmed: "gray", // Use with dimColor prop in Ink
			highlight: "yellow",
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
