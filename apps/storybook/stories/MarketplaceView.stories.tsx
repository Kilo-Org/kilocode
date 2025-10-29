// kilocode_change - new file
import type { Meta, StoryObj } from "@storybook/react-vite"
import { MarketplaceView } from "../../../webview-ui/src/components/marketplace/MarketplaceView"
import { createMockMarketplaceStateManager } from "../src/mockData"
import { createExtensionStateMock } from "../src/utils/createExtensionStateMock"
import { withSidebarContainer } from "../src/decorators/withSidebarContainer"

const meta = {
	title: "Views/MarketplaceView",
	component: MarketplaceView,
	argTypes: {
		targetTab: {
			control: { type: "select" },
			options: ["mcp", "mode"],
			description: "Which tab should be active initially",
		},
		hideHeader: {
			control: "boolean",
			description: "Whether to hide the header",
		},
		onDone: {
			action: "onDone",
			description: "Callback when done button is clicked",
		},
	},
	args: {
		hideHeader: false,
		onDone: () => {},
	},
	decorators: [withSidebarContainer()],
	parameters: {
		extensionState: createExtensionStateMock({
			organizationAllowList: {
				allowAll: true,
				providers: {},
			},
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-5-sonnet-20241022",
				apiKey: "mock-key",
			},
			marketplaceInstalledMetadata: {
				global: {},
				project: {},
			},
			mcpServers: [],
			mode: "code",
			customModes: [],
		}),
	},
} satisfies Meta<typeof MarketplaceView>

export default meta
type Story = StoryObj<typeof meta>

export const MCPTab: Story = {
	args: {
		stateManager: createMockMarketplaceStateManager("mcp") as any,
		targetTab: "mcp",
	},
}

export const ModeTab: Story = {
	args: {
		stateManager: createMockMarketplaceStateManager("mode") as any,
		targetTab: "mode",
	},
}
