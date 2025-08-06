// kilocode_change - new file
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { VirtualLimitInputsPresentation } from "../../../webview-ui/src/components/settings/providers/VirtualQuotaFallbackProviderPresentation"
import { withExtensionState } from "../src/decorators/withExtensionState"

const meta = {
	title: "Settings/Providers/VirtualQuotaFallbackProvider",
	component: VirtualLimitInputsPresentation,
	decorators: [withExtensionState],
	tags: ["autodocs"],
} satisfies Meta<typeof VirtualLimitInputsPresentation>

export default meta
type Story = StoryObj<typeof meta>

export const WithQuotas: Story = {
	args: {
		profile: {
			profileId: "anthropic-1",
			profileName: "Anthropic Claude",
			profileLimits: {
				tokensPerMinute: 1000,
				tokensPerHour: 50000,
				tokensPerDay: 200000,
				requestsPerMinute: 5,
				requestsPerHour: 100,
				requestsPerDay: 1000,
			},
		},
		usage: {
			minute: { tokens: 45, requests: 1 },
			hour: { tokens: 2300, requests: 23 },
			day: { tokens: 12000, requests: 120 },
		},
		index: 0,
		onProfileChange: fn(),
	},
}

export const HighUsage: Story = {
	args: {
		profile: {
			profileId: "openai-1",
			profileName: "OpenAI GPT-4",
			profileLimits: {
				tokensPerMinute: 2000,
				tokensPerHour: 80000,
				tokensPerDay: 500000,
				requestsPerMinute: 10,
				requestsPerHour: 200,
				requestsPerDay: 2000,
			},
		},
		usage: {
			minute: { tokens: 1800, requests: 9 },
			hour: { tokens: 75000, requests: 180 },
			day: { tokens: 450000, requests: 1800 },
		},
		index: 0,
		onProfileChange: fn(),
	},
}

export const NoUsageData: Story = {
	args: {
		profile: {
			profileId: "test-provider",
			profileName: "Test Provider",
			profileLimits: {
				tokensPerMinute: 500,
				tokensPerHour: 10000,
				tokensPerDay: 50000,
				requestsPerMinute: 3,
				requestsPerHour: 50,
				requestsPerDay: 500,
			},
		},
		usage: null,
		index: 0,
		onProfileChange: fn(),
	},
}
