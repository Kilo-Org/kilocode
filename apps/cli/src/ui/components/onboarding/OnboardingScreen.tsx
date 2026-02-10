import { Box, Text } from "ink"
import { Select } from "@inkjs/ui"

import { OnboardingProviderChoice, ASCII_ROO } from "@/types/index.js"

export interface OnboardingScreenProps {
	onSelect: (choice: OnboardingProviderChoice) => void
}

export function OnboardingScreen({ onSelect }: OnboardingScreenProps) {
	return (
		<Box flexDirection="column" gap={1}>
			<Text bold color="cyan">
				{ASCII_ROO}
			</Text>
			<Text dimColor>Welcome! How would you like to connect to an LLM provider?</Text>
			<Select
				options={[
					{ label: "Connect to Roo Code Cloud", value: OnboardingProviderChoice.Roo },
					{ label: "Bring your own API key", value: OnboardingProviderChoice.Byok },
				]}
				onChange={(value: string) => {
					onSelect(value as OnboardingProviderChoice)
				}}
			/>
		</Box>
	)
}
