import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { KilocodeNotifications } from "@/components/kilocode/KilocodeNotifications"

const meta = {
	title: "Components/KilocodeNotifications",
	component: KilocodeNotifications,
	parameters: {
		extensionState: {
			dismissedNotificationIds: [],
		},
	},
	args: {
		onDismiss: fn(),
	},
} satisfies Meta<typeof KilocodeNotifications>

export default meta
type Story = StoryObj<typeof meta>

const defaultNotification = {
	id: "1",
	title: "Welcome to Kilo Code!",
	message: "Get started by setting up your API configuration in the settings.",
	action: {
		actionText: "Open Settings",
		actionURL: "https://example.com/settings",
	},
}

export const Default: Story = {
	parameters: {
		postMessages: [
			{
				type: "kilocodeNotificationsResponse",
				notifications: [defaultNotification],
			},
		],
	},
}

export const MultipleNotifications: Story = {
	parameters: {
		postMessages: [
			{
				type: "kilocodeNotificationsResponse",
				notifications: [
					{
						id: "1",
						title: "First Notification",
						message: "This is the first notification in a series.",
					},
					{
						id: "2",
						title: "Second Notification",
						message: "You can navigate between notifications using the arrows.",
					},
					{
						id: "3",
						title: "Third Notification",
						message: "This is the last notification in this set.",
						action: {
							actionText: "Visit Website",
							actionURL: "https://example.com",
						},
					},
				],
			},
		],
	},
}
