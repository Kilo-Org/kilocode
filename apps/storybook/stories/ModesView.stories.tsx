// kilocode_change - new file
import type { Meta, StoryObj } from "@storybook/react-vite"

import ModesView from "../../../webview-ui/src/components/modes/ModesView"
import { mockModes } from "../src/mockData"
import { createExtensionStateMock } from "../src/utils/createExtensionStateMock"

const meta = {
	title: "Views/ModesView",
	component: ModesView,
	argTypes: {
		onDone: {
			action: "onDone",
			description: "Callback when done button is clicked",
		},
	},
	decorators: [
		(Story) => (
			<div className="w-[400px] min-h-[600px] bg-vscode-sideBar-background relative scale-100">
				<Story />
			</div>
		),
	],
	parameters: {
		extensionState: createExtensionStateMock({
			customModePrompts: {},
			listApiConfigMeta: [],
			currentApiConfigName: "anthropic",
			mode: "code",
			customInstructions: "",
			setCustomInstructions: () => {},
			customModes: mockModes as any, // Cast to bypass complex type requirements for Storybook
		}),
	},
} satisfies Meta<typeof ModesView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		onDone: () => {},
	},
}
