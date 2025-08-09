import React, { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import KiloModeSelector from "../../../webview-ui/src/components/kilocode/KiloModeSelector"
import { Mode } from "@roo/modes"
import { DEFAULT_MODES } from "@roo-code/types"
import { withI18n } from "../src/decorators/withI18n"
import { withTheme } from "../src/decorators/withTheme"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"

interface WrapperProps {
	value?: Mode
	customModes?: any
	modeShortcutText?: string
	title?: string
	disabled?: boolean
	initiallyOpen?: boolean
}

const KiloModeSelectorWrapper = (props: WrapperProps) => {
	const [selectedMode, setSelectedMode] = useState<Mode>(props.value || "code")

	return (
		<div style={{ padding: "20px", minHeight: "400px", maxWidth: "300px" }}>
			<KiloModeSelector
				{...props}
				value={selectedMode}
				onChange={setSelectedMode}
				modeShortcutText={props.modeShortcutText || "⌘ + . for next mode"}
			/>
		</div>
	)
}

const meta: Meta<typeof KiloModeSelectorWrapper> = {
	title: "Chat/KiloModeSelector",
	component: KiloModeSelectorWrapper,
	decorators: [withI18n, withTheme, withTooltipProvider],
}

export default meta
type Story = StoryObj<typeof meta>

const defaultArgs = {
	customModes: DEFAULT_MODES,
	modeShortcutText: "⌘ + . for next mode, ⌘ + Shift + . for previous mode",
	title: "Select Mode",
}

export const Default: Story = {
	args: {
		...defaultArgs,
		value: "code" as Mode,
	},
}

export const Architect: Story = {
	args: {
		...defaultArgs,
		value: "architect" as Mode,
	},
}

export const Disabled: Story = {
	args: {
		...defaultArgs,
		value: "debug" as Mode,
		disabled: true,
	},
}

export const Open: Story = {
	args: {
		...defaultArgs,
		value: "ask" as Mode,
		initiallyOpen: true,
	},
}
