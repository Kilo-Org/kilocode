/**
 * FollowupSuggestionsMenu component - displays followup question suggestions
 * Similar to AutocompleteMenu but for followup question responses
 */

import React from "react"
import { Box, Text } from "ink"
import type { FollowupSuggestion } from "../../state/atoms/ui.js"
import { useTheme } from "../../state/hooks/useTheme.js"

interface FollowupSuggestionsMenuProps {
	suggestions: FollowupSuggestion[]
	selectedIndex: number
	visible: boolean
}

export const FollowupSuggestionsMenu: React.FC<FollowupSuggestionsMenuProps> = ({
	suggestions,
	selectedIndex,
	visible,
}) => {
	const theme = useTheme()

	if (!visible || suggestions.length === 0) {
		return null
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.actions.pending} paddingX={1}>
			<Text bold color={theme.actions.pending}>
				Suggestions:
			</Text>
			{suggestions.map((suggestion, index) => (
				<SuggestionRow key={index} suggestion={suggestion} index={index} isSelected={index === selectedIndex} />
			))}
			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					↑↓ Navigate • Tab Fill • Enter Submit
				</Text>
			</Box>
		</Box>
	)
}

interface SuggestionRowProps {
	suggestion: FollowupSuggestion
	index: number
	isSelected: boolean
}

const SuggestionRow: React.FC<SuggestionRowProps> = ({ suggestion, index, isSelected }) => {
	const theme = useTheme()

	return (
		<Box>
			{isSelected && (
				<Text color={theme.actions.pending} bold>
					{">"}{" "}
				</Text>
			)}
			{!isSelected && <Text>{"  "}</Text>}

			<Text color={isSelected ? theme.actions.pending : theme.ui.text.primary} bold={isSelected}>
				{index + 1}. {suggestion.answer}
			</Text>

			{suggestion.mode && (
				<>
					<Text color={theme.ui.text.dimmed}> - </Text>
					<Text color={isSelected ? theme.ui.text.primary : theme.ui.text.dimmed}>
						switch to {suggestion.mode}
					</Text>
				</>
			)}
		</Box>
	)
}
