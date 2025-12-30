/**
 * Light theme for Kilo Code CLI
 *
 * Colors matched to VSCode extension's light theme for consistency.
 */

import type { Theme } from "../../types/theme.js"

export const lightTheme: Theme = {
	id: "light",
	name: "Light",
	type: "light",

	brand: {
		primary: "#616161",
		secondary: "#007acc",
	},

	semantic: {
		success: "#388a34",
		error: "#a1260d",
		warning: "#bf8803",
		info: "#1a85ff",
		neutral: "#717171",
	},

	interactive: {
		prompt: "#006ab1",
		selection: "#e8e8e8",
		hover: "#e8e8e8",
		disabled: "#959595",
		focus: "#0090f1",
	},

	messages: {
		user: "#006ab1",
		assistant: "#388a34",
		system: "#717171",
		error: "#a1260d",
	},

	actions: {
		approve: "#388a34",
		reject: "#a1260d",
		cancel: "#717171",
		pending: "#bf8803",
	},

	code: {
		addition: "#388a34",
		deletion: "#e51400",
		modification: "#bf8803",
		context: "#717171",
		lineNumber: "#237893",
	},

	markdown: {
		text: "#616161",
		heading: "#000000",
		strong: "#000000",
		em: "#616161",
		code: "#388a34",
		blockquote: "#717171",
		link: "#006ab1",
		list: "#616161",
	},

	ui: {
		border: {
			default: "#cecece",
			active: "#0090f1",
			warning: "#bf8803",
			error: "#a1260d",
		},
		text: {
			primary: "#616161",
			secondary: "#717171",
			dimmed: "#959595",
			highlight: "#faf74f",
		},
		background: {
			default: "default",
			elevated: "default",
		},
	},

	status: {
		online: "#388a34",
		offline: "#e51400",
		busy: "#bf8803",
		idle: "#717171",
	},
}
