import React, { useCallback, useRef, useEffect } from "react"
import { SlashCommand, SlashCommandSource, SlashCommandType, getMatchingSlashCommands } from "@/utils/slash-commands"
import { useExtensionState } from "@/context/ExtensionStateContext" // kilocode_change

interface SlashCommandMenuProps {
	onSelect: (command: SlashCommand) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
	query: string
	customModes?: any[]
}

const typeBadgeColors: Record<string, { bg: string; text: string }> = {
	command: { bg: "rgba(58, 150, 221, 0.15)", text: "rgba(58, 150, 221, 0.9)" },
	mode: { bg: "rgba(160, 100, 230, 0.15)", text: "rgba(160, 100, 230, 0.9)" },
	workflow: { bg: "rgba(80, 180, 100, 0.15)", text: "rgba(80, 180, 100, 0.9)" },
	skill: { bg: "rgba(220, 160, 50, 0.15)", text: "rgba(220, 160, 50, 0.9)" },
}

const defaultBadgeColors = { bg: "rgba(128, 128, 128, 0.15)", text: "var(--vscode-descriptionForeground)" }

function getTypeBadgeColors(type?: SlashCommandType): { bg: string; text: string } {
	return (type && typeBadgeColors[type]) || defaultBadgeColors
}

function getSourceLabel(source?: SlashCommandSource): string | null {
	switch (source) {
		case "project":
			return "project"
		case "global":
			return "global"
		case "organization":
			return "org"
		case "built-in":
		default:
			return null
	}
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
	onSelect,
	selectedIndex,
	setSelectedIndex,
	onMouseDown,
	query,
	customModes,
}) => {
	const { localWorkflows, globalWorkflows, skills } = useExtensionState() // kilocode_change
	const menuRef = useRef<HTMLDivElement>(null)

	const handleClick = useCallback(
		(command: SlashCommand) => {
			onSelect(command)
		},
		[onSelect],
	)

	// Auto-scroll logic remains the same...
	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex] as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	// Filter commands based on query
	const filteredCommands = getMatchingSlashCommands(query, customModes, localWorkflows, globalWorkflows, skills) // kilocode_change

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden z-[1000]"
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				className="bg-[var(--vscode-dropdown-background)] border border-[var(--vscode-editorGroup-border)] rounded-[3px] shadow-[0_4px_10px_rgba(0,0,0,0.25)] flex flex-col max-h-[200px] overflow-y-auto" // Corrected rounded and shadow
			>
				{filteredCommands.length > 0 ? (
					filteredCommands.map((command, index) => (
						<div
							key={command.name}
							className={`py-2 px-3 cursor-pointer flex flex-col border-b border-[var(--vscode-editorGroup-border)] ${
								// Corrected padding
								index === selectedIndex
									? "bg-[var(--vscode-quickInputList-focusBackground)] text-[var(--vscode-quickInputList-focusForeground)]"
									: "" // Removed bg-transparent
							} hover:bg-[var(--vscode-list-hoverBackground)]`}
							onClick={() => handleClick(command)}
							onMouseEnter={() => setSelectedIndex(index)}>
							<div className="flex items-center justify-between gap-2">
								<div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis">
									/{command.name}
								</div>
								<div className="flex items-center gap-1 shrink-0">
									{command.type && (
										<span
											className="text-[0.7em] px-1.5 py-0.5 rounded-sm leading-none"
											style={{
												backgroundColor: getTypeBadgeColors(command.type).bg,
												color: getTypeBadgeColors(command.type).text,
											}}>
											{command.type}
										</span>
									)}
									{getSourceLabel(command.source) && (
										<span className="text-[0.65em] text-[var(--vscode-descriptionForeground)] opacity-70 leading-none">
											{getSourceLabel(command.source)}
										</span>
									)}
								</div>
							</div>
							<div className="text-[0.85em] text-[var(--vscode-descriptionForeground)] whitespace-normal overflow-hidden text-ellipsis">
								{command.description}
							</div>
						</div>
					))
				) : (
					<div className="py-2 px-3 cursor-default flex flex-col">
						{" "}
						{/* Corrected padding, removed border, changed cursor */}
						<div className="text-[0.85em] text-[var(--vscode-descriptionForeground)]">
							No matching commands found
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default SlashCommandMenu
