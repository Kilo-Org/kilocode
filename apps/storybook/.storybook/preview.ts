import type { Preview } from "@storybook/react-vite"

import { withExtensionState } from "../src/decorators/withExtensionState"
import { withPostMessageMock } from "../src/decorators/withPostMessageMock"
import { withQueryClient } from "../src/decorators/withQueryClient"
import { withTheme } from "../src/decorators/withTheme"
import { withI18n } from "../src/decorators/withI18n"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"
import { withFixedContainment } from "../src/decorators/withFixedContainment"
import { withChromaticDecorator } from "./ChromaticDecorator"

import "./storybook.css"

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
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
	decorators: [
		withI18n,
		withQueryClient,
		withExtensionState,
		withPostMessageMock,
		withTheme,
		withTooltipProvider,
		withFixedContainment,
		withChromaticDecorator,
	],
}

export default preview
