import type { Preview } from "@storybook/react"

import "./vscode-theme.css"
import "./storybook-tailwind.css"

import "@vscode/codicons/dist/codicon.css"
import "../../../webview-ui/src/codicon-custom.css"

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			default: "vscode-dark",
			values: [
				{
					name: "vscode-dark",
					value: "var(--vscode-editor-background, #1e1e1e)",
				},
				{
					name: "vscode-light",
					value: "var(--vscode-editor-background, #ffffff)",
				},
			],
		},
	},
	globalTypes: {
		theme: {
			description: "Global theme for components",
			defaultValue: "dark",
			toolbar: {
				title: "Theme",
				icon: "paintbrush",
				items: ["light", "dark"],
				dynamicTitle: true,
			},
		},
	},
}

export default preview
