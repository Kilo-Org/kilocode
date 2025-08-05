// kilocode_change - new file
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { VirtualQuotaFallbackProvider } from "../../../webview-ui/src/components/settings/providers/VirtualQuotaFallbackProvider"
import type { ProviderSettings, ProviderSettingsEntry } from "../../../packages/types/src/provider-settings"
import { withExtensionState } from "../src/decorators/withExtensionState"

const meta = {
	title: "Settings/Providers/VirtualQuotaFallbackProvider",
	component: VirtualQuotaFallbackProvider,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"Virtual Quota Fallback Provider settings component that allows configuring multiple providers with quota limits and automatic fallback.",
			},
		},
		extensionState: {
			listApiConfigMeta: [
				{
					id: "anthropic-1",
					name: "Anthropic Claude",
					apiProvider: "anthropic" as const,
				},
				{
					id: "openai-1",
					name: "OpenAI GPT-4",
					apiProvider: "openai" as const,
				},
				{
					id: "gemini-1",
					name: "Google Gemini",
					apiProvider: "gemini" as const,
				},
				{
					id: "virtual-1",
					name: "Virtual Quota Fallback Provider",
					apiProvider: "virtual-quota-fallback" as const,
				},
				{
					id: "current-profile",
					name: "Current Profile",
					apiProvider: "openrouter" as const,
				},
			] as ProviderSettingsEntry[],
			currentApiConfigName: "Current Profile",
		},
	},
	tags: ["autodocs"],
	argTypes: {
		apiConfiguration: {
			description: "Provider configuration object containing virtual provider settings",
			control: { type: "object" },
		},
		setApiConfigurationField: {
			description: "Function to update provider configuration fields",
			action: "setApiConfigurationField",
		},
	},
	args: {
		setApiConfigurationField: fn(),
	},
	decorators: [withExtensionState],
} satisfies Meta<typeof VirtualQuotaFallbackProvider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		apiConfiguration: {
			apiProvider: "virtual-quota-fallback",
			profiles: [],
		} as ProviderSettings,
	},
}

export const WithQuotas: Story = {
	args: {
		apiConfiguration: {
			apiProvider: "virtual-quota-fallback",
			profiles: [
				{
					profileId: "anthropic-1",
					profileName: "Anthropic Claude",
					profileLimits: {
						tokensPerMinute: 100,
						tokensPerHour: 5000,
						tokensPerDay: 50000,
						requestsPerMinute: 2,
						requestsPerHour: 50,
						requestsPerDay: 500,
					},
				},
				{
					profileId: "openai-1",
					profileName: "OpenAI GPT-4",
					profileLimits: {
						tokensPerMinute: 150,
						tokensPerHour: 7500,
						tokensPerDay: 75000,
						requestsPerMinute: 3,
						requestsPerHour: 75,
						requestsPerDay: 750,
					},
				},
			],
		} as ProviderSettings,
	},
	play: async () => {
		// Mock usage data responses for progress bars
		const mockUsageData = {
			"anthropic-1": {
				minute: { tokens: 45, requests: 1 },
				hour: { tokens: 2300, requests: 23 },
				day: { tokens: 12000, requests: 120 },
			},
			"openai-1": {
				minute: { tokens: 120, requests: 2 },
				hour: { tokens: 6000, requests: 60 },
				day: { tokens: 45000, requests: 450 },
			},
		}

		// Mock the message system
		const originalAddEventListener = window.addEventListener
		const originalPostMessage = window.postMessage

		window.addEventListener = (type: string, listener: any) => {
			if (type === "message") {
				// Simulate usage data responses
				setTimeout(() => {
					Object.entries(mockUsageData).forEach(([profileId, values]) => {
						listener({
							data: {
								type: "usageDataResponse",
								text: profileId,
								values,
							},
						})
					})
				}, 100)
			}
			return originalAddEventListener.call(window, type, listener)
		}

		// Mock vscode.postMessage
		if (typeof window !== "undefined" && (window as any).vscode) {
			const originalVscodePostMessage = (window as any).vscode.postMessage
			;(window as any).vscode.postMessage = (message: any) => {
				if (message.type === "getUsageData") {
					// Simulate async response
					setTimeout(() => {
						window.dispatchEvent(
							new MessageEvent("message", {
								data: {
									type: "usageDataResponse",
									text: message.text,
									values: mockUsageData[message.text as keyof typeof mockUsageData],
								},
							}),
						)
					}, 50)
				}
				return originalVscodePostMessage?.call((window as any).vscode, message)
			}
		}
	},
}

export const NoAvailableProviders: Story = {
	args: {
		apiConfiguration: {
			apiProvider: "virtual-quota-fallback",
			profiles: [],
		} as ProviderSettings,
	},
	parameters: {
		extensionState: {
			listApiConfigMeta: [
				{
					id: "virtual-1",
					name: "Virtual Quota Fallback Provider",
					apiProvider: "virtual-quota-fallback" as const,
				},
				{
					id: "current-profile",
					name: "Current Profile",
					apiProvider: "openrouter" as const,
				},
			] as ProviderSettingsEntry[],
			currentApiConfigName: "Current Profile",
		},
	},
}
