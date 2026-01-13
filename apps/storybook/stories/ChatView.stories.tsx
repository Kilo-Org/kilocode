// kilocode_change - new file
import React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import ChatView from "../../../webview-ui/src/components/chat/ChatView"
import { createTaskHeaderMessages, createMockTask, BASE_TIMESTAMP } from "../src/mockData/clineMessages"

const meta = {
	title: "Chat/ChatView",
	component: ChatView,
	tags: ["autodocs"],
	argTypes: {
		isHidden: {
			control: "boolean",
			description: "Whether the chat view is hidden",
		},
		showAnnouncement: {
			control: "boolean",
			description: "Whether to show the announcement banner",
		},
		hideAnnouncement: {
			action: "hideAnnouncement",
			description: "Function to hide the announcement",
		},
	},
	args: {
		isHidden: false,
		showAnnouncement: false,
		hideAnnouncement: fn(),
	},
	decorators: [
		(Story) => (
			<div className="min-h-[600px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ChatView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		isHidden: false,
		showAnnouncement: false,
		hideAnnouncement: fn(),
	},
	parameters: {
		extensionState: {
			clineMessages: [createMockTask(), ...createTaskHeaderMessages()],
			organizationAllowList: {
				allowAll: true,
				providers: {},
			},
			dismissedNotificationIds: [], // Add this for consistency
			currentTaskItem: {
				id: "task-1",
				ts: BASE_TIMESTAMP,
				task: "Create a React component with TypeScript",
				tokensIn: 1250,
				tokensOut: 850,
				cacheWrites: 45,
				cacheReads: 120,
				totalCost: 0.15,
				conversationStats: {
					messagesTotal: 12,
					messagesEnvironment: 3,
					messagesUser: 2,
					messagesAssistant: 7,
				},
			},
			taskHistory: [
				{
					id: "task-1",
					ts: BASE_TIMESTAMP - 3600000, // 1 hour ago
					task: "Previous completed task",
					tokensIn: 800,
					tokensOut: 600,
					cacheWrites: 20,
					cacheReads: 80,
					totalCost: 0.08,
					conversationStats: {
						messagesTotal: 8,
						messagesEnvironment: 2,
						messagesUser: 1,
						messagesAssistant: 5,
					},
				},
			],
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-5-sonnet-20241022",
				apiKey: "mock-key",
			},
			currentApiConfigName: "Claude 3.5 Sonnet",
			listApiConfigMeta: [
				{
					id: "config-1",
					name: "Claude 3.5 Sonnet",
					profileType: "chat",
					apiProvider: "anthropic",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
				{
					id: "config-2",
					name: "GPT-4",
					profileType: "chat",
					apiProvider: "openai",
					apiModelId: "gpt-4-turbo-preview",
				},
			],
			pinnedApiConfigs: {},
			togglePinnedApiConfig: fn(),
			mcpServers: [],
			allowedCommands: [],
			mode: "code",
			customModes: [],
			gitCommits: [],
			openedTabs: [{ path: "src/components/ChatView.tsx", isDirty: false }],
			filePaths: ["src/components/ChatView.tsx", "package.json", "README.md"],
		},
	},
}

export const EmptyWithNotificationsAndHistory: Story = {
	args: {
		isHidden: false,
		showAnnouncement: false,
		hideAnnouncement: fn(),
	},
	decorators: [
		(Story) => {
			// Mock notifications for KilocodeNotifications component
			React.useEffect(() => {
				const mockNotifications = [
					{
						id: "notification-1",
						title: "New Feature Available",
						message: "Try our new AI-powered code analysis feature to improve your development workflow.",
						action: {
							actionText: "Learn More",
							actionURL: "https://kilocode.com/features/code-analysis",
						},
					},
					{
						id: "notification-2",
						title: "System Maintenance",
						message:
							"Scheduled maintenance will occur on Sunday, 2:00 AM UTC. Services may be temporarily unavailable.",
					},
				]

				// Simulate the message event that KilocodeNotifications listens for
				const mockEvent = new MessageEvent("message", {
					data: {
						type: "kilocodeNotificationsResponse",
						notifications: mockNotifications,
					},
				})

				// Dispatch the mock event after a short delay to ensure component is mounted
				const timer = setTimeout(() => {
					window.dispatchEvent(mockEvent)
				}, 100)

				return () => clearTimeout(timer)
			}, [])

			return (
				<div className="min-h-[600px]">
					<div
						className="resize-x overflow-auto border border-gray-300 rounded"
						style={{
							maxWidth: "385px",
							minWidth: "300px",
							width: "385px",
						}}>
						<Story />
					</div>
				</div>
			)
		},
	],
	parameters: {
		extensionState: {
			clineMessages: [], // Empty messages for empty chat view
			organizationAllowList: {
				allowAll: true,
				providers: {},
			},
			dismissedNotificationIds: [], // Add this to fix the undefined error
			currentTaskItem: null, // No current task
			taskHistory: [
				{
					id: "task-1",
					ts: BASE_TIMESTAMP - 7200000, // 2 hours ago
					task: "Create a responsive navigation component with TypeScript",
					tokensIn: 1850,
					tokensOut: 1200,
					cacheWrites: 65,
					cacheReads: 180,
					totalCost: 0.22,
					conversationStats: {
						messagesTotal: 18,
						messagesEnvironment: 4,
						messagesUser: 3,
						messagesAssistant: 11,
					},
				},
				{
					id: "task-2",
					ts: BASE_TIMESTAMP - 3600000, // 1 hour ago
					task: "Debug authentication flow and fix login issues",
					tokensIn: 950,
					tokensOut: 720,
					cacheWrites: 30,
					cacheReads: 95,
					totalCost: 0.12,
					conversationStats: {
						messagesTotal: 10,
						messagesEnvironment: 2,
						messagesUser: 2,
						messagesAssistant: 6,
					},
				},
			],
			apiConfiguration: {
				apiProvider: "kilocode", // Set to kilocode to show notifications
				apiModelId: "claude-3-5-sonnet-20241022",
				apiKey: "mock-key",
			},
			currentApiConfigName: "Claude 3.5 Sonnet",
			listApiConfigMeta: [
				{
					id: "config-1",
					name: "Claude 3.5 Sonnet",
					profileType: "chat",
					apiProvider: "anthropic",
					apiModelId: "claude-3-5-sonnet-20241022",
				},
				{
					id: "config-2",
					name: "GPT-4",
					profileType: "chat",
					apiProvider: "openai",
					apiModelId: "gpt-4-turbo-preview",
				},
			],
			pinnedApiConfigs: {},
			togglePinnedApiConfig: fn(),
			mcpServers: [],
			allowedCommands: [],
			mode: "code",
			customModes: [],
			gitCommits: [],
			openedTabs: [{ path: "src/components/Navigation.tsx", isDirty: false }],
			filePaths: ["src/components/Navigation.tsx", "src/auth/login.ts", "package.json", "README.md"],
			telemetrySetting: "enabled", // Set to enabled to show notifications instead of telemetry banner
		},
	},
}
