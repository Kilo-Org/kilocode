import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { useApprovalEffect } from "../../../../state/hooks/useApprovalEffect.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import {
	ToolEditedExistingFileMessage,
	ToolInsertContentMessage,
	ToolSearchAndReplaceMessage,
	ToolNewFileCreatedMessage,
	ToolReadFileMessage,
	ToolGenerateImageMessage,
	ToolListFilesTopLevelMessage,
	ToolListFilesRecursiveMessage,
	ToolListCodeDefinitionNamesMessage,
	ToolSearchFilesMessage,
	ToolCodebaseSearchMessage,
	ToolUpdateTodoListMessage,
	ToolSwitchModeMessage,
	ToolNewTaskMessage,
	ToolFinishTaskMessage,
	ToolFetchInstructionsMessage,
	ToolRunSlashCommandMessage,
} from "./index.js"

/**
 * Routes tool data to the appropriate component based on tool type
 *
 * RACE CONDITION FIX:
 * - Removed duplicate approval logic (now handled by useApprovalEffect)
 * - This component only handles routing and rendering
 */
export const ToolRouter: React.FC<ToolMessageProps> = ({ message, toolData }) => {
	const theme = useTheme()
	// Use centralized approval orchestration
	// This handles all approval logic including auto-approval
	useApprovalEffect(message)

	switch (toolData.tool) {
		case "editedExistingFile":
		case "appliedDiff":
			return <ToolEditedExistingFileMessage message={message} toolData={toolData} />

		case "insertContent":
			return <ToolInsertContentMessage message={message} toolData={toolData} />

		case "searchAndReplace":
			return <ToolSearchAndReplaceMessage message={message} toolData={toolData} />

		case "newFileCreated":
			return <ToolNewFileCreatedMessage message={message} toolData={toolData} />

		case "readFile":
			return <ToolReadFileMessage message={message} toolData={toolData} />

		case "generateImage":
			return <ToolGenerateImageMessage message={message} toolData={toolData} />

		case "listFilesTopLevel":
			return <ToolListFilesTopLevelMessage message={message} toolData={toolData} />

		case "listFilesRecursive":
			return <ToolListFilesRecursiveMessage message={message} toolData={toolData} />

		case "listCodeDefinitionNames":
			return <ToolListCodeDefinitionNamesMessage message={message} toolData={toolData} />

		case "searchFiles":
			return <ToolSearchFilesMessage message={message} toolData={toolData} />

		case "codebaseSearch":
			return <ToolCodebaseSearchMessage message={message} toolData={toolData} />

		case "updateTodoList":
			return <ToolUpdateTodoListMessage message={message} toolData={toolData} />

		case "switchMode":
			return <ToolSwitchModeMessage message={message} toolData={toolData} />

		case "newTask":
			return <ToolNewTaskMessage message={message} toolData={toolData} />

		case "finishTask":
			return <ToolFinishTaskMessage message={message} toolData={toolData} />

		case "fetchInstructions":
			return <ToolFetchInstructionsMessage message={message} toolData={toolData} />

		case "runSlashCommand":
			return <ToolRunSlashCommandMessage message={message} toolData={toolData} />

		default:
			return (
				<Box marginY={1}>
					<Text color={theme.ui.text.dimmed}>⚙ Unknown tool: {toolData.tool}</Text>
				</Box>
			)
	}
}
