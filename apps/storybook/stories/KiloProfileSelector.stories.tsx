// kilocode_change - new file
import React, { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { KiloProfileSelector } from "../../../webview-ui/src/components/kilocode/chat/KiloProfileSelector"
import { withI18n } from "../src/decorators/withI18n"
import { withTheme } from "../src/decorators/withTheme"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"
import { withLimitedWidth } from "../src/decorators/withLimitedWidth"

interface KiloProfileSelectorStoryProps {
	initiallyOpen?: boolean
}

const KiloProfileSelectorStory = ({ initiallyOpen }: KiloProfileSelectorStoryProps) => {
	const [pinnedConfigs, setPinnedConfigs] = useState<Record<string, boolean>>({
		"anthropic-1": true,
		"openai-2": false,
	})

	const mockApiConfigs = [
		{ id: "anthropic-1", name: "Anthropic Claude" },
		{ id: "gemini-3", name: "Google Gemini" },
		{ id: "local-4", name: "Local Ollama" },
	]

	const togglePinnedApiConfig = (configId: string) => {
		setPinnedConfigs((prev) => ({
			...prev,
			[configId]: !prev[configId],
		}))
		console.log("Toggled pin for config:", configId)
	}

	return (
		<div style={{ maxWidth: `600px`, margin: "0 auto", height: 200 }}>
			<KiloProfileSelector
				currentConfigId="anthropic-1"
				currentApiConfigName="Anthropic Claude"
				displayName="Anthropic Claude"
				listApiConfigMeta={mockApiConfigs}
				pinnedApiConfigs={pinnedConfigs}
				togglePinnedApiConfig={togglePinnedApiConfig}
				selectApiConfigDisabled={false}
				initiallyOpen={initiallyOpen}
			/>
		</div>
	)
}

const meta: Meta<typeof KiloProfileSelectorStory> = {
	title: "Chat/KiloProfileSelector",
	component: KiloProfileSelectorStory,
	decorators: [withI18n, withTheme, withTooltipProvider, withLimitedWidth(400)],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {},
}

export const Open: Story = {
	args: {
		initiallyOpen: true,
	},
}
