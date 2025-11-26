import type { Meta, StoryObj } from "@storybook/react-vite"
import { TabbedCodeIndexPopover, TabbedCodeIndexPopoverTabs } from "@/components/chat/kilocode/TabbedCodeIndexPopover"

const meta = {
	title: "Chat/TabbedCodeIndexPopover",
	component: TabbedCodeIndexPopoverTabs,
	parameters: { layout: "centered" },
	args: {
		indexingStatus: {
			systemStatus: "indexing",
			message: "Indexing files...",
			processedItems: 250,
			totalItems: 1000,
			currentItemUnit: "files",
			workspacePath: "/Users/example/project",
			gitBranch: "main",
			manifest: {
				totalFiles: 850,
				totalChunks: 3400,
				lastUpdated: new Date().toISOString(),
			},
		},
	},
} satisfies Meta<typeof TabbedCodeIndexPopoverTabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
