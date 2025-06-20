import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { TaskTimeline } from "../../../webview-ui/src/components/chat/TaskTimeline"
import {
	createComponentCreationMessages,
	createDebuggingMessages,
	createFullStackMessages,
	createQuickTaskMessages,
	createMessageTypeVarietyMessages,
} from "../src/mockData/clineMessages"

const meta = {
	title: "Chat/TaskTimeline",
	component: TaskTimeline,
	parameters: {
		layout: "padded",
	},
	tags: ["autodocs"],
	argTypes: {},
	args: {
		onMessageClick: fn(),
	},
} satisfies Meta<typeof TaskTimeline>

export default meta
type Story = StoryObj<typeof meta>

export const CompletedTask: Story = {
	args: {
		groupedMessages: createComponentCreationMessages(),
		onMessageClick: fn(),
		currentMessageIndex: undefined,
		isTaskActive: false,
	},
}

export const ActiveTask: Story = {
	args: {
		groupedMessages: createDebuggingMessages(),
		onMessageClick: fn(),
		currentMessageIndex: 7, // Last message is active
		isTaskActive: true,
	},
}

export const LongTask: Story = {
	args: {
		groupedMessages: createFullStackMessages(),
		onMessageClick: fn(),
		currentMessageIndex: undefined,
		isTaskActive: false,
	},
}

export const AllMessageTypes: Story = {
	name: "All Supported Message Types",
	args: {
		groupedMessages: createMessageTypeVarietyMessages(),
		onMessageClick: fn(),
		currentMessageIndex: undefined,
		isTaskActive: false,
	},
	parameters: {
		docs: {
			description: {
				story: "Displays examples of all message types supported by the timeline registry, including ask types (command, followup, tool, browser_action_launch, use_mcp_server, completion_result) and say types (text, reasoning, command_output, mcp_server_response, browser_action, browser_action_result, checkpoint_saved, completion_result, error, condense_context). Each message type has its own color and translation.",
			},
		},
	},
}
