import type { Preview } from "@storybook/react"
import isChromatic from "chromatic/isChromatic"

import { withExtensionState } from "../src/decorators/withExtensionState"
import { withQueryClient } from "../src/decorators/withQueryClient"
import { withTheme } from "../src/decorators/withTheme"
import { withI18n } from "../src/decorators/withI18n"
import { withChromaticDecorator } from "./ChromaticDecorator"

import "./storybook.css"

const preview: Preview = {
	parameters: {
		layout: isChromatic() ? "fullscreen" : "padded",
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
				items: ["light", "dark", "both"],
				dynamicTitle: true,
			},
		},
	},
	decorators: [withQueryClient, withExtensionState, withTheme, withI18n, withChromaticDecorator],
}

export default preview
