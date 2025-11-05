/**
 * AutocompleteMenu component - displays command and argument suggestions
 */

import React from "react"
import { Box, Text } from "ink"
import type { CommandSuggestion, ArgumentSuggestion, FileMentionSuggestion } from "../../services/autocomplete.js"
import { useTheme } from "../../state/hooks/useTheme.js"

interface AutocompleteMenuProps {
	type: "command" | "argument" | "file-mention" | "none"
	commandSuggestions?: CommandSuggestion[]
	argumentSuggestions?: ArgumentSuggestion[]
	fileMentionSuggestions?: FileMentionSuggestion[]
	selectedIndex: number
	visible: boolean
}

export const AutocompleteMenu: React.FC<AutocompleteMenuProps> = ({
	type,
	commandSuggestions,
	argumentSuggestions,
	fileMentionSuggestions,
	selectedIndex,
	visible,
}) => {
	if (!visible || type === "none") {
		return null
	}

	if (type === "command" && commandSuggestions && commandSuggestions.length > 0) {
		return <SuggestionsMenu type="command" suggestions={commandSuggestions} selectedIndex={selectedIndex} />
	}

	if (type === "argument" && argumentSuggestions && argumentSuggestions.length > 0) {
		return <SuggestionsMenu type="argument" suggestions={argumentSuggestions} selectedIndex={selectedIndex} />
	}

	if (type === "file-mention" && fileMentionSuggestions && fileMentionSuggestions.length > 0) {
		return (
			<SuggestionsMenu type="file-mention" suggestions={fileMentionSuggestions} selectedIndex={selectedIndex} />
		)
	}

	return null
}

interface SuggestionsMenuProps {
	type: "command" | "argument" | "file-mention"
	suggestions: CommandSuggestion[] | ArgumentSuggestion[] | FileMentionSuggestion[]
	selectedIndex: number
}

const SuggestionsMenu: React.FC<SuggestionsMenuProps> = ({ type, suggestions, selectedIndex }) => {
	const theme = useTheme()
	const VISIBLE_ITEMS = 5
	const totalItems = suggestions.length

	// Calculate scrolling window to keep selected item centered when possible
	let windowStart = 0
	if (totalItems > VISIBLE_ITEMS) {
		// Try to center the selected item (position 2 in the window)
		windowStart = Math.max(0, selectedIndex - 2)
		// Don't scroll past the end
		windowStart = Math.min(windowStart, totalItems - VISIBLE_ITEMS)
	}

	const windowEnd = Math.min(windowStart + VISIBLE_ITEMS, totalItems)
	const displaySuggestions = suggestions.slice(windowStart, windowEnd)

	const title = type === "command" ? "Commands:" : type === "argument" ? "Arguments:" : "Files:"
	const borderColor = type === "command" ? theme.ui.border.default : theme.ui.border.active

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
			<Text bold color={theme.semantic.info}>
				{title}
			</Text>
			{displaySuggestions.map((suggestion, displayIndex) => {
				const actualIndex = windowStart + displayIndex
				const key =
					type === "command"
						? (suggestion as CommandSuggestion).command.name
						: type === "file-mention"
							? (suggestion as FileMentionSuggestion).value
							: (suggestion as ArgumentSuggestion).value || actualIndex.toString()

				return (
					<SuggestionRow
						key={key}
						type={type}
						suggestion={suggestion}
						isSelected={actualIndex === selectedIndex}
					/>
				)
			})}
		</Box>
	)
}

interface SuggestionRowProps {
	type: "command" | "argument" | "file-mention"
	suggestion: CommandSuggestion | ArgumentSuggestion | FileMentionSuggestion
	isSelected: boolean
}

const SuggestionRow: React.FC<SuggestionRowProps> = ({ type, suggestion, isSelected }) => {
	const theme = useTheme()

	// Handle file mention suggestions
	if (type === "file-mention") {
		const fileSuggestion = suggestion as FileMentionSuggestion
		// Extract just the filename from the full path
		const parts = fileSuggestion.value.split("/")
		const filename = parts[parts.length - 1] || fileSuggestion.value

		return (
			<Box>
				{isSelected && (
					<Text color={theme.semantic.success} bold>
						{">"}{" "}
					</Text>
				)}
				{!isSelected && <Text>{"  "}</Text>}

				{/* Show file/folder icon */}
				<Text color={theme.ui.text.dimmed}>{fileSuggestion.type === "folder" ? "📁 " : "📄 "}</Text>

				<Text color={isSelected ? theme.semantic.success : theme.ui.text.primary} bold={isSelected}>
					{filename}
				</Text>

				{fileSuggestion.description && (
					<>
						<Text color={theme.ui.text.dimmed}> - </Text>
						<Text color={isSelected ? theme.ui.text.primary : theme.ui.text.dimmed}>
							{fileSuggestion.description}
						</Text>
					</>
				)}

				{fileSuggestion.error && (
					<>
						<Text color={theme.ui.text.dimmed}> - </Text>
						<Text color={theme.semantic.error}>{fileSuggestion.error}</Text>
					</>
				)}
			</Box>
		)
	}

	// Handle command and argument suggestions
	return (
		<Box>
			{isSelected && (
				<Text color={theme.semantic.success} bold>
					{">"}{" "}
				</Text>
			)}
			{!isSelected && <Text>{"  "}</Text>}

			{type === "argument" && (suggestion as ArgumentSuggestion).loading && (
				<Text color={theme.semantic.warning}>⏳ </Text>
			)}
			{type === "argument" && (suggestion as ArgumentSuggestion).error && (
				<Text color={theme.semantic.error}>❌ </Text>
			)}

			<Text color={isSelected ? theme.semantic.success : theme.ui.text.primary} bold={isSelected}>
				{type === "command"
					? `/${(suggestion as CommandSuggestion).command.name}`
					: (suggestion as ArgumentSuggestion).value}
			</Text>

			{((type === "command" && (suggestion as CommandSuggestion).command.description) ||
				(type === "argument" && (suggestion as ArgumentSuggestion).description)) && (
				<>
					<Text color={theme.ui.text.dimmed}> - </Text>
					<Text color={isSelected ? theme.ui.text.primary : theme.ui.text.dimmed}>
						{type === "command"
							? (suggestion as CommandSuggestion).command.description
							: (suggestion as ArgumentSuggestion).description}
					</Text>
				</>
			)}
		</Box>
	)
}
