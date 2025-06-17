import type { Preview } from "@storybook/react"
import { withTheme } from "./decorators"

import "./storybook.css"

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			default: "dark",
			values: [
				{
					name: "dark",
					value: "var(--vscode-editor-background, #1e1e1e)",
				},
				{
					name: "light",
					value: "var(--vscode-editor-background, #ffffff)",
				},
			],
		},
	},
	globalTypes: {
		theme: {
			description: "Global Theme",
			defaultValue: "dark",
			toolbar: {
				title: "Theme",
				icon: "paintbrush",
				items: ["light", "dark"],
				dynamicTitle: true,
			},
		},
	},
	decorators: [withTheme],
}

export default preview
