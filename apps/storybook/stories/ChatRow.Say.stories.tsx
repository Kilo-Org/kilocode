// kilocode_change - new file
import React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import ChatRow from "../../../webview-ui/src/components/chat/ChatRow"
import { ChatRowGallery } from "../src/components/ChatRowGallery"

const meta = {
	title: "Chat/ChatRow",
	component: ChatRow,
	argTypes: {
		message: {
			control: false,
			description: "The message to display",
		},
		isExpanded: {
			control: "boolean",
			description: "Whether the row is expanded",
		},
		isLast: {
			control: "boolean",
			description: "Whether this is the last message",
		},
		isStreaming: {
			control: "boolean",
			description: "Whether the message is currently streaming",
		},
	},
	args: {
		isExpanded: false,
		isLast: true,
		isStreaming: false,
		onToggleExpand: fn(),
		onHeightChange: fn(),
		onSuggestionClick: fn(),
		onBatchFileResponse: fn(),
		highlighted: false,
		enableCheckpoints: true,
		onFollowUpUnmount: fn(),
		isFollowUpAnswered: false,
		editable: false,
		hasCheckpoint: false,
	},
} satisfies Meta<typeof ChatRow>

export default meta
type Story = StoryObj<typeof meta>

export const AllSayStories: Story = {
	render: () => <ChatRowGallery category="say" meta={meta} />,
}
