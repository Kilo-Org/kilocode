import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import DynamicTextArea from "react-textarea-autosize"

import { mentionRegex, mentionRegexGlobal, unescapeSpaces } from "@roo/context-mentions"
import { WebviewMessage } from "@roo/WebviewMessage"
import { Mode, getAllModes } from "@roo/modes"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import type { ProfileType } from "@roo-code/types" // kilocode_change - autocomplete profile type system

import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	ContextMenuOptionType,
	getContextMenuOptions,
	insertMention,
	removeMention,
	shouldShowContextMenu,
	SearchResult,
} from "@src/utils/context-mentions"
import { convertToMentionPath } from "@/utils/path-mentions"
import { escapeHtml } from "@/utils/highlight" // kilocode_change - FIM autocomplete
import { useChatGhostText } from "./hooks/useChatGhostText" // kilocode_change: FIM autocomplete
import { DropdownOptionType, Button, StandardTooltip } from "@/components/ui"

import Thumbnails from "../common/Thumbnails"
import { ModeSelector } from "./ModeSelector"
import KiloModeSelector from "../kilocode/KiloModeSelector"
import { KiloProfileSelector } from "../kilocode/chat/KiloProfileSelector"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"
import ContextMenu from "./ContextMenu"
import { ImageWarningBanner } from "./ImageWarningBanner"
import { VolumeX, Pin, Check, WandSparkles, SendHorizontal, Paperclip, MessageSquareX } from "lucide-react"
import { IndexingStatusBadge } from "./IndexingStatusBadge"
import { MicrophoneButton } from "./MicrophoneButton" // kilocode_change: STT microphone button
import { VolumeVisualizer } from "./VolumeVisualizer" // kilocode_change: STT volume level visual
import { VoiceRecordingCursor } from "./VoiceRecordingCursor" // kilocode_change: STT recording cursor
import { cn } from "@/lib/utils"
import { usePromptHistory } from "./hooks/usePromptHistory"
import { useSTT } from "@/hooks/useSTT" // kilocode_change: STT hook

// kilocode_change start: pull slash commands from Cline
import SlashCommandMenu from "@/components/chat/SlashCommandMenu"
import {
	SlashCommand,
	shouldShowSlashCommandsMenu,
	getMatchingSlashCommands,
	insertSlashCommand,
	validateSlashCommand,
} from "@/utils/slash-commands"
// kilocode_change end

interface ChatTextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	selectApiConfigDisabled: boolean
	placeholderText: string
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectImages: () => void
	shouldDisableImages: boolean
	onHeightChange?: (height: number) => void
	mode: Mode
	setMode: (value: Mode) => void
	modeShortcutText: string
	// Edit mode props
	isEditMode?: boolean
	onCancel?: () => void
	sendMessageOnEnter?: boolean // kilocode_change
	showBrowserDockToggle?: boolean
}

// kilocode_change start
function handleSessionCommand(trimmedInput: string, setInputValue: (value: string) => void) {
	if (trimmedInput.startsWith("/session show")) {
		vscode.postMessage({
			type: "sessionShow",
		})

		setInputValue("")

		return true
	} else if (trimmedInput.startsWith("/session share")) {
		vscode.postMessage({
			type: "sessionShare",
		})

		setInputValue("")

		return true
	} else if (trimmedInput.startsWith("/session fork ")) {
		const shareId = trimmedInput.substring("/session fork ".length).trim()

		vscode.postMessage({
			type: "sessionFork",
			shareId: shareId,
		})

		if (shareId) {
			setInputValue("")
		}

		return true
	} else if (trimmedInput.startsWith("/session select ")) {
		const sessionId = trimmedInput.substring("/session select ".length).trim()

		vscode.postMessage({
			type: "sessionSelect",
			sessionId: sessionId,
		})

		setInputValue("")

		return true
	}

	return false
}
// kilocode_change end

export const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			selectApiConfigDisabled,
			placeholderText,
			selectedImages,
			setSelectedImages,
			onSend,
			onSelectImages,
			shouldDisableImages,
			onHeightChange,
			mode,
			setMode,
			modeShortcutText,
			isEditMode = false,
			onCancel,
			sendMessageOnEnter = true,
		},
		ref,
	) => {
		const { t } = useAppTranslation()
		const {
			filePaths,
			openedTabs,
			currentApiConfigName,
			listApiConfigMeta: listApiConfigMeta_unfilteredByKiloCodeProfileType,
			customModes,
			customModePrompts,
			cwd,
			pinnedApiConfigs,
			togglePinnedApiConfig,
			localWorkflows, // kilocode_change
			globalWorkflows, // kilocode_change
			taskHistoryVersion, // kilocode_change
			clineMessages,
			ghostServiceSettings, // kilocode_change
			language, // User's VSCode display language
			experiments, // kilocode_change: For speechToText experiment flag
			speechToTextStatus, // kilocode_change: Speech-to-text availability status with failure reason
		} = useExtensionState()

		// kilocode_change start - autocomplete profile type system
		// Filter out autocomplete profiles - only show chat profiles in the chat interface
		const listApiConfigMeta = useMemo(() => {
			if (!listApiConfigMeta_unfilteredByKiloCodeProfileType) {
				return []
			}
			return listApiConfigMeta_unfilteredByKiloCodeProfileType.filter((config) => {
				const profileType = (config as { profileType?: ProfileType }).profileType
				return profileType !== "autocomplete"
			})
		}, [listApiConfigMeta_unfilteredByKiloCodeProfileType])
		// kilocode_change end
		// Find the ID and display text for the currently selected API configuration
		const { currentConfigId, displayName } = useMemo(() => {
			const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
			return {
				currentConfigId: currentConfig?.id || "",
				displayName: currentApiConfigName || "", // Use the name directly for display
			}
		}, [listApiConfigMeta, currentApiConfigName])

		const [gitCommits, setGitCommits] = useState<any[]>([])
		const [showDropdown, setShowDropdown] = useState(false)
		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])

		// kilocode_change begin: remove button from chat when it gets to small
		const [containerWidth, setContainerWidth] = useState<number>(300) // Default to a value larger than our threshold

		const containerRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (!containerRef.current) return

			// Check if ResizeObserver is available (it won't be in test environment)
			if (typeof ResizeObserver === "undefined") return

			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const width = entry.contentRect.width
					setContainerWidth(width)
				}
			})

			resizeObserver.observe(containerRef.current)

			return () => {
				resizeObserver.disconnect()
			}
		}, [])
		// kilocode_change end: Container width tracking for responsive UI

		const [searchLoading, setSearchLoading] = useState(false)
		const [searchRequestId, setSearchRequestId] = useState<string>("")

		// Close dropdown when clicking outside.
		useEffect(() => {
			const handleClickOutside = () => {
				if (showDropdown) {
					setShowDropdown(false)
				}
			}

			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}, [showDropdown])

		// Handle enhanced prompt response and search results.
		useEffect(() => {
			const messageHandler = (event: MessageEvent) => {
				const message = event.data

				if (message.type === "enhancedPrompt") {
					if (message.text && textAreaRef.current) {
						try {
							// Use execCommand to replace text while preserving undo history
							if (document.execCommand) {
								// Use native browser methods to preserve undo stack
								const textarea = textAreaRef.current

								// Focus the textarea to ensure it's the active element
								textarea.focus()

								// Select all text first
								textarea.select()
								document.execCommand("insertText", false, message.text)
							} else {
								setInputValue(message.text)
							}
						} catch {
							setInputValue(message.text)
						}
					}

					setIsEnhancingPrompt(false)
				} else if (message.type === "commitSearchResults") {
					const commits = message.commits.map((commit: any) => ({
						type: ContextMenuOptionType.Git,
						value: commit.hash,
						label: commit.subject,
						description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
						icon: "$(git-commit)",
					}))

					setGitCommits(commits)
				} else if (message.type === "fileSearchResults") {
					setSearchLoading(false)
					if (message.requestId === searchRequestId) {
						setFileSearchResults(message.results || [])
					}
				} else if (message.type === "insertTextToChatArea") {
					// kilocode_change
					if (message.text) {
						setInputValue(message.text)
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.focus()
							}
						}, 0)
					}
				}
			}

			window.addEventListener("message", messageHandler)
			return () => window.removeEventListener("message", messageHandler)
		}, [setInputValue, searchRequestId, inputValue, onSend])
		const [isDraggingOver, setIsDraggingOver] = useState(false)
		// kilocode_change start: Slash commands state
		const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
		const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
		const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
		const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)
		// kilocode_change end: Slash commands state
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [showContextMenu, setShowContextMenu] = useState(false)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [searchQuery, setSearchQuery] = useState("")
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)

		// kilocode_change: Use STT (Speech-to-Text) hook
		// Track input state when recording starts
		const recordingStartStateRef = useRef<{ beforeCursor: string; afterCursor: string; position: number } | null>(
			null,
		)
		const {
			isRecording,
			segments,
			volume: volumeLevel,
			start: startSTT,
			stop: stopSTT,
		} = useSTT({
			onComplete: (text) => {
				// Insert transcribed text at cursor position
				if (recordingStartStateRef.current) {
					const { beforeCursor, afterCursor } = recordingStartStateRef.current
					const separator = beforeCursor && !beforeCursor.endsWith(" ") ? " " : ""
					const newValue = beforeCursor + separator + text + afterCursor
					setInputValue(newValue)
					// Set cursor after inserted text
					const newCursorPos = beforeCursor.length + separator.length + text.length
					setCursorPosition(newCursorPos)
					setIntendedCursorPosition(newCursorPos)
				} else {
					setInputValue(text)
				}
				recordingStartStateRef.current = null
			},
			onError: (error) => {
				console.error("STT error:", error)
				recordingStartStateRef.current = null
			},
		})

		// Convert segments to text for display
		const liveTranscript = useMemo(() => {
			return segments.map((s) => s.text).join(" ")
		}, [segments])

		// Track preview ranges for highlighting
		const previewRanges = useMemo(() => {
			const ranges: { start: number; end: number }[] = []
			let offset = 0

			for (let i = 0; i < segments.length; i++) {
				const segment = segments[i]
				if (segment.isPreview) {
					ranges.push({ start: offset, end: offset + segment.text.length })
				}
				offset += segment.text.length
				// Add space offset except for the last segment
				if (i < segments.length - 1) {
					offset += 1 // Account for the space added by join(" ")
				}
			}

			// console.log("🎙️ [ChatTextArea] 🎨 previewRanges:", ranges, "from segments:", segments)
			return ranges
		}, [segments])

		// Store cursor position and split input when recording starts
		useEffect(() => {
			if (isRecording && !recordingStartStateRef.current) {
				const pos = textAreaRef.current?.selectionStart ?? inputValue.length
				recordingStartStateRef.current = {
					beforeCursor: inputValue.slice(0, pos),
					afterCursor: inputValue.slice(pos),
					position: pos,
				}
			}
		}, [isRecording, inputValue])

		const displayValue = useMemo(() => {
			if (isRecording && liveTranscript && recordingStartStateRef.current) {
				const { beforeCursor, afterCursor } = recordingStartStateRef.current
				const separator = beforeCursor && !beforeCursor.endsWith(" ") ? " " : ""
				return beforeCursor + separator + liveTranscript + afterCursor
			}
			return inputValue
		}, [isRecording, liveTranscript, inputValue])

		// Show cursor at insertion point during recording
		const recordingCursorPosition =
			isRecording && recordingStartStateRef.current
				? recordingStartStateRef.current.position +
					(recordingStartStateRef.current.beforeCursor &&
					!recordingStartStateRef.current.beforeCursor.endsWith(" ")
						? 1
						: 0)
				: 0
		const highlightLayerRef = useRef<HTMLDivElement>(null)
		const shouldAutoScrollToCaretRef = useRef(false) // kilocode_change
		const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const contextMenuContainerRef = useRef<HTMLDivElement>(null)
		const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false)
		// const [isFocused, setIsFocused] = useState(false) // kilocode_change - not needed
		// kilocode_change start: FIM autocomplete ghost text
		const {
			ghostText,
			handleKeyDown: handleGhostTextKeyDown,
			handleInputChange: handleGhostTextInputChange,
		} = useChatGhostText({
			textAreaRef,
			enableChatAutocomplete: ghostServiceSettings?.enableChatAutocomplete ?? true,
		})
		// kilocode_change end: FIM autocomplete ghost text
		const [imageWarning, setImageWarning] = useState<string | null>(null) // kilocode_change

		// Use custom hook for prompt history navigation
		const { handleHistoryNavigation, resetHistoryNavigation, resetOnInputChange } = usePromptHistory({
			clineMessages,
			taskHistoryVersion,
			cwd, // kilocode_change
			inputValue,
			setInputValue,
		})

		// Fetch git commits when Git is selected or when typing a hash.
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				const message: WebviewMessage = {
					type: "searchCommits",
					query: searchQuery || "",
				} as const
				vscode.postMessage(message)
			}
		}, [selectedType, searchQuery])

		const handleEnhancePrompt = useCallback(() => {
			const trimmedInput = inputValue.trim()

			if (trimmedInput) {
				setIsEnhancingPrompt(true)
				vscode.postMessage({ type: "enhancePrompt" as const, text: trimmedInput })
			} else {
				setInputValue(t("chat:enhancePromptDescription"))
			}
		}, [inputValue, setInputValue, t])

		// kilocode_change start: Image and speech handlers
		const showImageWarning = useCallback(
			(messageKey: string) => {
				setImageWarning(messageKey)
			},
			[setImageWarning],
		)

		const dismissImageWarning = useCallback(() => {
			setImageWarning(null)
		}, [setImageWarning])

		const handleMicrophoneClick = useCallback(() => {
			if (isRecording) {
				stopSTT()
			} else {
				startSTT(language || "en") // Pass user's language from extension state
			}
		}, [isRecording, startSTT, stopSTT, language])

		// kilocode_change start: Auto-clear images when model changes to non-image-supporting
		const prevShouldDisableImages = useRef<boolean>(shouldDisableImages)
		useEffect(() => {
			if (!prevShouldDisableImages.current && shouldDisableImages && selectedImages.length > 0) {
				setSelectedImages([])
				showImageWarning("kilocode:imageWarnings.imagesRemovedNoSupport")
			}
			prevShouldDisableImages.current = shouldDisableImages
		}, [shouldDisableImages, selectedImages.length, setSelectedImages, showImageWarning])
		// kilocode_change end: Auto-clear images when model changes to non-image-supporting

		const allModes = useMemo(() => getAllModes(customModes), [customModes])

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
				...openedTabs
					.filter((tab) => tab.path)
					.map((tab) => ({
						type: ContextMenuOptionType.OpenedFile,
						value: "/" + tab.path,
					})),
				...filePaths
					.map((file) => "/" + file)
					.filter((path) => !openedTabs.some((tab) => tab.path && "/" + tab.path === path)) // Filter out paths that are already in openedTabs
					.map((path) => ({
						type: path.endsWith("/") ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
						value: path,
					})),
			]
		}, [filePaths, gitCommits, openedTabs])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (
					contextMenuContainerRef.current &&
					!contextMenuContainerRef.current.contains(event.target as Node)
				) {
					setShowContextMenu(false)
				}
			}

			if (showContextMenu) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showContextMenu, setShowContextMenu])

		const handleMentionSelect = useCallback(
			(type: ContextMenuOptionType, value?: string) => {
				if (type === ContextMenuOptionType.Image) {
					// kilocode_change start: Image selection handling
					// Close the context menu and remove the @character in this case
					setShowContextMenu(false)
					setSelectedType(null)

					if (textAreaRef.current) {
						const beforeCursor = textAreaRef.current.value.slice(0, cursorPosition)
						const afterCursor = textAreaRef.current.value.slice(cursorPosition)
						const lastAtIndex = beforeCursor.lastIndexOf("@")

						if (lastAtIndex !== -1) {
							const newValue = beforeCursor.slice(0, lastAtIndex) + afterCursor
							setInputValue(newValue)
						}
					}

					// Call the image selection function
					onSelectImages()
					return
				} // kilocode_change end: Image selection handling

				if (type === ContextMenuOptionType.NoResults) {
					return
				}

				if (type === ContextMenuOptionType.Mode && value) {
					// Handle mode selection.
					setMode(value)
					setInputValue("")
					setShowContextMenu(false)
					vscode.postMessage({ type: "mode", text: value })
					return
				}

				if (
					type === ContextMenuOptionType.File ||
					type === ContextMenuOptionType.Folder ||
					type === ContextMenuOptionType.Git
				) {
					if (!value) {
						setSelectedType(type)
						setSearchQuery("")
						setSelectedMenuIndex(0)
						return
					}
				}

				setShowContextMenu(false)
				setSelectedType(null)

				if (textAreaRef.current) {
					let insertValue = value || ""

					if (type === ContextMenuOptionType.URL) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.Problems) {
						insertValue = "problems"
					} else if (type === ContextMenuOptionType.Terminal) {
						insertValue = "terminal"
					} else if (type === ContextMenuOptionType.Git) {
						insertValue = value || ""
					}

					const { newValue, mentionIndex } = insertMention(
						textAreaRef.current.value,
						cursorPosition,
						insertValue,
					)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					// Scroll to cursor.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[setInputValue, cursorPosition],
		)

		const handleSlashCommandsSelect = useCallback(
			// kilocode_change start: Slash command selection
			(command: SlashCommand) => {
				setShowSlashCommandsMenu(false)

				// Handle mode switching commands
				const modeSwitchCommands = getAllModes(customModes).map((mode) => mode.slug)
				if (modeSwitchCommands.includes(command.name)) {
					// Switch to the selected mode
					setMode(command.name as Mode)
					setInputValue("")
					vscode.postMessage({ type: "mode", text: command.name })
					return
				}

				// Handle other slash commands (like newtask)
				if (textAreaRef.current) {
					const { newValue, commandIndex } = insertSlashCommand(textAreaRef.current.value, command.name)
					const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

					setInputValue(newValue)
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, setMode, customModes],
		) // kilocode_change end: Slash command selection

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				// kilocode_change start: pull slash commands from Cline
				if (showSlashCommandsMenu) {
					// kilocode_change start: Slash command menu navigation
					if (event.key === "Escape") {
						setShowSlashCommandsMenu(false)
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedSlashCommandsIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const commands = getMatchingSlashCommands(
								slashCommandsQuery,
								customModes,
								localWorkflows,
								globalWorkflows,
							) // kilocode_change

							if (commands.length === 0) {
								return prevIndex
							}

							const newIndex = (prevIndex + direction + commands.length) % commands.length
							return newIndex
						})
						return
					}

					if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
						event.preventDefault()
						const commands = getMatchingSlashCommands(
							slashCommandsQuery,
							customModes,
							localWorkflows,
							globalWorkflows,
						)
						if (commands.length > 0) {
							handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
						}
						return
					}
				} // kilocode_change end: Slash command menu navigation
				if (showContextMenu) {
					if (event.key === "Escape") {
						setShowContextMenu(false)
						setSelectedType(null)
						setSelectedMenuIndex(3) // File by default
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(
								searchQuery,
								selectedType,
								queryItems,
								fileSearchResults,
								allModes,
							)
							const optionsLength = options.length

							if (optionsLength === 0) return prevIndex

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL &&
									option.type !== ContextMenuOptionType.NoResults,
							)

							if (selectableOptions.length === 0) return -1 // No selectable options

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.findIndex(
								(option) => option === options[prevIndex],
							)

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) %
								selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.findIndex((option) => option === selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(
							searchQuery,
							selectedType,
							queryItems,
							fileSearchResults,
							allModes,
						)[selectedMenuIndex]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults
						) {
							handleMentionSelect(selectedOption.type, selectedOption.value)
						}
						return
					}
				}

				// kilocode_change start: FIM autocomplete - Tab to accept ghost text
				if (handleGhostTextKeyDown(event)) {
					return // Event was handled by ghost text hook, stop here
				}
				// kilocode_change end: FIM autocomplete

				const isComposing = event.nativeEvent?.isComposing ?? false

				const shouldSendMessage = // kilocode_change start: Send message handling
					!isComposing &&
					event.key === "Enter" &&
					((sendMessageOnEnter && !event.shiftKey) || (!sendMessageOnEnter && event.shiftKey))

				if (shouldSendMessage) {
					event.preventDefault()

					const trimmedInput = inputValue.trim()

					const preventFlow = handleSessionCommand(trimmedInput, setInputValue)

					if (preventFlow) {
						return
					}

					resetHistoryNavigation()
					onSend()
				}

				// Handle prompt history navigation using custom hook
				if (handleHistoryNavigation(event, showContextMenu, isComposing)) {
					return
				} // kilocode_change end: Send message handling

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"

					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Checks if char before cusor is whitespace after a mention.
					if (
						charBeforeIsWhitespace &&
						// "$" is added to ensure the match occurs at the end of the string.
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
					) {
						const newCursorPosition = cursorPosition - 1
						// If mention is followed by another word, then instead
						// of deleting the space separating them we just move
						// the cursor to the end of the mention.
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}

						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
					} else if (justDeletedSpaceAfterMention) {
						const { newText, newPosition } = removeMention(inputValue, cursorPosition)

						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition) // Store the new cursor position in state
						}

						setJustDeletedSpaceAfterMention(false)
						setShowContextMenu(false)
					} else {
						setJustDeletedSpaceAfterMention(false)
					}
				}
			},
			[
				showSlashCommandsMenu, // kilocode_change start
				localWorkflows,
				globalWorkflows,
				customModes,
				handleSlashCommandsSelect,
				selectedSlashCommandsIndex,
				slashCommandsQuery,
				handleGhostTextKeyDown, // kilocode_change: FIM autocomplete
				// kilocode_change end
				onSend,
				showContextMenu,
				searchQuery,
				selectedMenuIndex,
				handleMentionSelect,
				selectedType,
				inputValue,
				cursorPosition,
				setInputValue,
				justDeletedSpaceAfterMention,
				queryItems,
				allModes,
				fileSearchResults,
				handleHistoryNavigation,
				resetHistoryNavigation,
				sendMessageOnEnter,
			],
		)

		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state.
			}
		}, [inputValue, intendedCursorPosition])

		// Ref to store the search timeout.
		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				// kilocode_change start
				const target = e.target
				const newValue = target.value
				const cursorAtEnd =
					target.selectionStart === target.selectionEnd && target.selectionEnd === newValue.length
				shouldAutoScrollToCaretRef.current = cursorAtEnd
				// kilocode_change end

				setInputValue(newValue)

				// Reset history navigation when user types
				resetOnInputChange()

				handleGhostTextInputChange(e) // kilocode_change - FIM autocomplete

				const newCursorPosition = target.selectionStart // Use target for consistency
				setCursorPosition(newCursorPosition)

				let showMenu = shouldShowContextMenu(newValue, newCursorPosition) // kilocode_change start: Slash command menu logic
				const showSlashCommandsMenu = shouldShowSlashCommandsMenu(newValue, newCursorPosition)

				// we do not allow both menus to be shown at the same time
				// the slash commands menu has precedence bc its a narrower component
				if (showSlashCommandsMenu) {
					showMenu = false
				}

				setShowSlashCommandsMenu(showSlashCommandsMenu) // kilocode_change end: Slash command menu logic

				setShowContextMenu(showMenu)

				if (showSlashCommandsMenu) {
					// kilocode_change start: Slash command query handling
					const slashIndex = newValue.indexOf("/")
					const query = newValue.slice(slashIndex + 1, newCursorPosition)
					setSlashCommandsQuery(query)
					setSelectedSlashCommandsIndex(0)
				} else {
					setSlashCommandsQuery("")
					setSelectedSlashCommandsIndex(0)
				} // kilocode_change end: Slash command query handling

				if (showMenu) {
					const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)

					if (newValue.startsWith("/") && lastAtIndex === -1) {
						// kilocode_change: Prevent slash command conflict with mentions
						// Handle slash command.
						const query = newValue
						setSearchQuery(query)
						setSelectedMenuIndex(0)
					} else {
						// Existing @ mention handling.
						const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
						setSearchQuery(query)

						// Send file search request if query is not empty.
						if (query.length > 0) {
							setSelectedMenuIndex(0)

							// Don't clear results until we have new ones. This
							// prevents flickering.

							// Clear any existing timeout.
							if (searchTimeoutRef.current) {
								clearTimeout(searchTimeoutRef.current)
							}

							// Set a timeout to debounce the search requests.
							searchTimeoutRef.current = setTimeout(() => {
								// Generate a request ID for this search.
								const reqId = Math.random().toString(36).substring(2, 9)
								setSearchRequestId(reqId)
								setSearchLoading(true)

								// Send message to extension to search files.
								vscode.postMessage({
									type: "searchFiles",
									query: unescapeSpaces(query),
									requestId: reqId,
								})
							}, 200) // 200ms debounce.
						} else {
							setSelectedMenuIndex(-1)
						}
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([]) // Clear file search results.
				}
			},
			[
				setInputValue,
				setSearchRequestId,
				setFileSearchResults,
				setSearchLoading,
				resetOnInputChange,
				handleGhostTextInputChange, // kilocode_change: FIM autocomplete
			],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it.
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false)
			} // kilocode_change

			// setIsFocused(false) // kilocode_change - not needed
		}, [isMouseDownOnMenu])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user
				// can easily delete if they don't want it.
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue =
						inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"]

				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})

				if (imageItems.length > 0) {
					// kilocode_change start: Image paste validation
					e.preventDefault()

					if (shouldDisableImages) {
						showImageWarning(`kilocode:imageWarnings.modelNoImageSupport`)
						return
					}
					if (selectedImages.length >= MAX_IMAGES_PER_MESSAGE) {
						showImageWarning(`kilocode:imageWarnings.maxImagesReached`)
						return
					} // kilocode_change end: Image paste validation

					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()

							if (!blob) {
								resolve(null)
								return
							}

							const reader = new FileReader()

							reader.onloadend = () => {
								if (reader.error) {
									console.error(t("chat:errorReadingFile"), reader.error)
									resolve(null)
								} else {
									const result = reader.result
									resolve(typeof result === "string" ? result : null)
								}
							}

							reader.readAsDataURL(blob)
						})
					})

					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

					if (dataUrls.length > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
					} else {
						console.warn(t("chat:noValidImages"))
					}
				}
			},
			[
				shouldDisableImages,
				setSelectedImages,
				cursorPosition,
				setInputValue,
				inputValue,
				t,
				selectedImages.length,
				showImageWarning, // kilocode_change
			],
		)

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) return

			let processedText = textAreaRef.current.value // kilocode_change start: Slash command highlighting

			processedText = processedText
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			// check for highlighting /slash-commands
			if (/^\s*\//.test(processedText)) {
				const slashIndex = processedText.indexOf("/")

				// end of command is end of text or first whitespace
				const spaceIndex = processedText.indexOf(" ", slashIndex)
				const endIndex = spaceIndex > -1 ? spaceIndex : processedText.length

				// extract and validate the exact command text
				const commandText = processedText.substring(slashIndex + 1, endIndex)
				const isValidCommand = validateSlashCommand(commandText, customModes)

				if (isValidCommand) {
					const fullCommand = processedText.substring(slashIndex, endIndex) // includes slash

					const highlighted = `<mark class="slash-command-match-textarea-highlight">${fullCommand}</mark>`
					processedText =
						processedText.substring(0, slashIndex) + highlighted + processedText.substring(endIndex)
				}
			}

			// kilocode_change start - STT preview text highlighting
			if (isRecording && previewRanges.length > 0 && recordingStartStateRef.current) {
				const { beforeCursor } = recordingStartStateRef.current
				const separator = beforeCursor && !beforeCursor.endsWith(" ") ? " " : ""
				const baseOffset = beforeCursor.length + separator.length
				for (let i = previewRanges.length - 1; i >= 0; i--) {
					const range = previewRanges[i]
					const start = baseOffset + range.start
					const end = baseOffset + range.end

					const before = processedText.substring(0, start)
					const previewText = processedText.substring(start, end)
					const after = processedText.substring(end)

					processedText = before + `<span class="stt-preview-text">${previewText}</span>` + after
				}
			}
			// kilocode_change end - STT preview text highlighting
			// kilocode_change start - autocomplete ghost text display
			if (inputValue && ghostText) {
				processedText += `<span class="text-vscode-editor-foreground opacity-60 pointer-events-none">${escapeHtml(ghostText)}</span>`
			}
			// kilocode_change end - autocomplete ghost text display

			highlightLayerRef.current.innerHTML = processedText
			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [customModes, ghostText, inputValue, isRecording, previewRanges]) // kilocode_change - merged dependencies

		useLayoutEffect(() => {
			updateHighlights()

			// kilocode_change start
			if (!shouldAutoScrollToCaretRef.current) {
				return
			}

			shouldAutoScrollToCaretRef.current = false

			if (!textAreaRef.current) {
				return
			}

			const rafId = requestAnimationFrame(() => {
				if (!textAreaRef.current) {
					return
				}

				textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight
				updateHighlights()
			})

			return () => cancelAnimationFrame(rafId)
			// kilocode_change end
		}, [inputValue, liveTranscript, updateHighlights])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const handleDrop = useCallback(
			async (e: React.DragEvent<HTMLDivElement>) => {
				e.preventDefault()
				setIsDraggingOver(false)

				const textFieldList = e.dataTransfer.getData("text")
				const textUriList = e.dataTransfer.getData("application/vnd.code.uri-list")
				// When textFieldList is empty, it may attempt to use textUriList obtained from drag-and-drop tabs; if not empty, it will use textFieldList.
				const text = textFieldList || textUriList
				if (text) {
					// Split text on newlines to handle multiple files
					const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")

					if (lines.length > 0) {
						// Process each line as a separate file path
						let newValue = inputValue.slice(0, cursorPosition)
						let totalLength = 0

						// Using a standard for loop instead of forEach for potential performance gains.
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i]
							// Convert each path to a mention-friendly format
							const mentionText = convertToMentionPath(line, cwd)
							newValue += mentionText
							totalLength += mentionText.length

							// Add space after each mention except the last one
							if (i < lines.length - 1) {
								newValue += " "
								totalLength += 1
							}
						}

						// Add space after the last mention and append the rest of the input
						newValue += " " + inputValue.slice(cursorPosition)
						totalLength += 1

						setInputValue(newValue)
						const newCursorPosition = cursorPosition + totalLength
						setCursorPosition(newCursorPosition)
						setIntendedCursorPosition(newCursorPosition)
					}

					return
				}

				const files = Array.from(e.dataTransfer.files)

				if (files.length > 0) {
					const acceptedTypes = ["png", "jpeg", "webp"]

					const imageFiles = files.filter((file) => {
						const [type, subtype] = file.type.split("/")
						return type === "image" && acceptedTypes.includes(subtype)
					})

					// kilocode_change start: Image validation with warning messages for drag and drop
					if (imageFiles.length > 0) {
						if (shouldDisableImages) {
							showImageWarning("kilocode:imageWarnings.modelNoImageSupport")
							return
						}
						if (selectedImages.length >= MAX_IMAGES_PER_MESSAGE) {
							showImageWarning("kilocode:imageWarnings.maxImagesReached")
							return
						}
						// kilocode_change end: Image validation with warning messages for drag and drop

						const imagePromises = imageFiles.map((file) => {
							return new Promise<string | null>((resolve) => {
								const reader = new FileReader()

								reader.onloadend = () => {
									if (reader.error) {
										console.error(t("chat:errorReadingFile"), reader.error)
										resolve(null)
									} else {
										const result = reader.result
										resolve(typeof result === "string" ? result : null)
									}
								}

								reader.readAsDataURL(file)
							})
						})

						const imageDataArray = await Promise.all(imagePromises)
						const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

						if (dataUrls.length > 0) {
							setSelectedImages((prevImages) =>
								[...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
							)

							if (typeof vscode !== "undefined") {
								vscode.postMessage({ type: "draggedImages", dataUrls: dataUrls })
							}
						} else {
							console.warn(t("chat:noValidImages"))
						}
					}
				}
			},
			[
				cursorPosition,
				cwd,
				inputValue,
				setInputValue,
				setCursorPosition,
				setIntendedCursorPosition,
				shouldDisableImages,
				setSelectedImages,
				t,
				selectedImages.length, // kilocode_change - added selectedImages.length
				showImageWarning, // kilocode_change - added showImageWarning
			],
		)

		const [isTtsPlaying, setIsTtsPlaying] = useState(false)

		useEvent("message", (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "ttsStart") {
				setIsTtsPlaying(true)
			} else if (message.type === "ttsStop") {
				setIsTtsPlaying(false)
			}
		})

		const placeholderBottomText = `\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`

		// Common mode selector handler
		const handleModeChange = useCallback(
			(value: Mode) => {
				setMode(value)
				vscode.postMessage({ type: "mode", text: value })
			},
			[setMode],
		)

		// Helper function to render mode
		// kilocode_change: unused
		const _renderModeSelector = () => (
			<ModeSelector
				value={mode}
				title={t("chat:selectMode")}
				onChange={handleModeChange}
				triggerClassName="w-full"
				modeShortcutText={modeShortcutText}
				customModes={customModes}
				customModePrompts={customModePrompts}
			/>
		)

		// Helper function to get API config dropdown options
		// kilocode_change: unused
		const _getApiConfigOptions = useMemo(() => {
			const pinnedConfigs = (listApiConfigMeta || [])
				.filter((config) => pinnedApiConfigs && pinnedApiConfigs[config.id])
				.map((config) => ({
					value: config.id,
					label: config.name,
					name: config.name,
					type: DropdownOptionType.ITEM,
					pinned: true,
				}))
				.sort((a, b) => a.label.localeCompare(b.label))

			const unpinnedConfigs = (listApiConfigMeta || [])
				.filter((config) => !pinnedApiConfigs || !pinnedApiConfigs[config.id])
				.map((config) => ({
					value: config.id,
					label: config.name,
					name: config.name,
					type: DropdownOptionType.ITEM,
					pinned: false,
				}))
				.sort((a, b) => a.label.localeCompare(b.label))

			const hasPinnedAndUnpinned = pinnedConfigs.length > 0 && unpinnedConfigs.length > 0

			return [
				...pinnedConfigs,
				...(hasPinnedAndUnpinned
					? [
							{
								value: "sep-pinned",
								label: t("chat:separator"),
								type: DropdownOptionType.SEPARATOR,
							},
						]
					: []),
				...unpinnedConfigs,
				{
					value: "sep-2",
					label: t("chat:separator"),
					type: DropdownOptionType.SEPARATOR,
				},
				{
					value: "settingsButtonClicked",
					label: t("chat:edit"),
					type: DropdownOptionType.ACTION,
				},
			]
		}, [listApiConfigMeta, pinnedApiConfigs, t])

		// Helper function to handle API config change
		// kilocode_change: unused
		const _handleApiConfigChange = useCallback((value: string) => {
			if (value === "settingsButtonClicked") {
				vscode.postMessage({
					type: "loadApiConfiguration",
					text: value,
					values: { section: "providers" },
				})
			} else {
				vscode.postMessage({ type: "loadApiConfigurationById", text: value })
			}
		}, [])

		// Helper function to render API config item
		// kilocode_change: unused
		const _renderApiConfigItem = useCallback(
			({ type, value, label, pinned }: any) => {
				if (type !== DropdownOptionType.ITEM) {
					return label
				}

				const config = listApiConfigMeta?.find((c) => c.id === value)
				const isCurrentConfig = config?.name === currentApiConfigName

				return (
					<div className="flex justify-between gap-2 w-full h-5">
						<div
							className={cn("truncate min-w-0 overflow-hidden", {
								"font-medium": isCurrentConfig,
							})}>
							{label}
						</div>
						<div className="flex justify-end w-10 flex-shrink-0">
							<div
								className={cn("size-5 p-1", {
									"block group-hover:hidden": !pinned,
									hidden: !isCurrentConfig,
								})}>
								<Check className="size-3" />
							</div>
							<StandardTooltip content={pinned ? t("chat:unpin") : t("chat:pin")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={(e) => {
										e.stopPropagation()
										togglePinnedApiConfig(value)
										vscode.postMessage({
											type: "toggleApiConfigPin",
											text: value,
										})
									}}
									className={cn("size-5", {
										"hidden group-hover:flex": !pinned,
										"bg-accent": pinned,
									})}>
									<Pin className="size-3 p-0.5 opacity-50" />
								</Button>
							</StandardTooltip>
						</div>
					</div>
				)
			},
			[listApiConfigMeta, currentApiConfigName, t, togglePinnedApiConfig],
		)

		// Helper function to render the text area section
		const renderTextAreaSection = () => (
			<div
				className={cn(
					"relative",
					"flex-1",
					"flex",
					"flex-col-reverse",
					"min-h-0",
					"overflow-hidden",
					"rounded",
				)}>
				<div
					ref={highlightLayerRef}
					className={cn(
						"absolute",
						"inset-0",
						"pointer-events-none",
						"whitespace-pre-wrap",
						"break-words",
						"text-transparent",
						"overflow-hidden",
						"font-vscode-font-family",
						"text-vscode-editor-font-size",
						"leading-vscode-editor-line-height",
						isDraggingOver
							? "border-2 border-dashed border-vscode-focusBorder"
							: "border border-transparent",
						isEditMode ? "pt-1.5 pb-10 px-2" : "py-1.5 px-2",
						"px-[8px]",
						"pr-9",
						"z-10",
						"forced-color-adjust-none",
						"pb-16", // kilocode_change
					)}
					style={{
						color: "transparent",
					}}
				/>
				<DynamicTextArea
					ref={(el) => {
						if (typeof ref === "function") {
							ref(el)
						} else if (ref) {
							ref.current = el
						}
						textAreaRef.current = el
					}}
					value={displayValue}
					onChange={(e) => {
						// During recording, ignore changes to prevent cursor jumping
						if (!isRecording) {
							handleInputChange(e)
							updateHighlights()
						}
					}}
					// onFocus={() => setIsFocused(true)} // kilocode_change - not needed
					onKeyDown={(e) => {
						// Handle ESC to cancel in edit mode
						if (isEditMode && e.key === "Escape" && !e.nativeEvent?.isComposing) {
							e.preventDefault()
							onCancel?.()
							return
						}
						handleKeyDown(e)
					}}
					onKeyUp={handleKeyUp}
					onBlur={handleBlur}
					onPaste={handlePaste}
					onSelect={updateCursorPosition}
					onMouseUp={updateCursorPosition}
					onHeightChange={(height) => {
						if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
							setTextAreaBaseHeight(height)
						}

						onHeightChange?.(height)
					}}
					// kilocode_change: use regular placeholder, streaming text goes to actual input
					placeholder={`${placeholderText}\n${placeholderBottomText}`}
					minRows={3}
					maxRows={15}
					autoFocus={true}
					// kilocode_change start - isRecording active
					style={{
						border: isRecording
							? "1px solid var(--vscode-editorError-foreground)"
							: "1px solid transparent",
					}}
					// kilocode_change end - isRecording active
					className={cn(
						"w-full",
						"text-vscode-input-foreground",
						"font-vscode-font-family",
						"text-vscode-editor-font-size",
						"leading-vscode-editor-line-height",
						"cursor-text",
						isEditMode ? "pt-1.5 pb-10 px-2" : "py-1.5 px-2",
						// kilocode_change start - removing duplicated border
						isRecording && "focus:outline-0",
						// isFocused
						// 	? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
						// 	: isDraggingOver
						// 		? "border-2 border-dashed border-vscode-focusBorder"
						// 		: "border border-transparent",
						// kilocode_change end - removing duplicated border
						isDraggingOver
							? "bg-[color-mix(in_srgb,var(--vscode-input-background)_95%,var(--vscode-focusBorder))]"
							: "bg-vscode-input-background",
						"transition-background-color duration-150 ease-in-out",
						"will-change-background-color",
						"min-h-[90px]",
						"box-border",
						"rounded",
						"resize-none",
						"overflow-x-hidden",
						"overflow-y-auto",
						"pr-9",
						"flex-none flex-grow",
						"z-[2]",
						"scrollbar-none",
						"scrollbar-hide",
						"pb-16", // kilocode_change: Increased padding to prevent overlap with control bar
					)}
					onScroll={() => updateHighlights()}
				/>
				{/* kilocode_change {Transparent overlay at bottom of textArea to avoid text overlap } */}
				<div
					className="absolute bottom-[1px] left-2 right-2 h-16 bg-gradient-to-t from-[var(--vscode-input-background)] via-[var(--vscode-input-background)] to-transparent pointer-events-none z-[2]"
					aria-hidden="true"
				/>

				{/* kilocode_change: Visual cursor indicator during voice recording */}
				<VoiceRecordingCursor
					textAreaRef={textAreaRef}
					cursorPosition={recordingCursorPosition}
					isVisible={isRecording}
				/>

				{isTtsPlaying && (
					<StandardTooltip content={t("chat:stopTts")}>
						<Button
							variant="ghost"
							size="icon"
							className="absolute top-0 right-0 opacity-25 hover:opacity-100 z-10"
							onClick={() => vscode.postMessage({ type: "stopTts" })}>
							<VolumeX className="size-4" />
						</Button>
					</StandardTooltip>
				)}

				{/* kilocode_change: position tweaked */}
				<div className="absolute top-2 right-2 z-30">
					<StandardTooltip content={t("chat:enhancePrompt")}>
						<button
							aria-label={t("chat:enhancePrompt")}
							disabled={false}
							onClick={handleEnhancePrompt}
							className={cn(
								"relative inline-flex items-center justify-center",
								"bg-transparent border-none p-1.5",
								"rounded-md min-w-[28px] min-h-[28px]",
								"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
								"transition-all duration-150",
								"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
								"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
								"active:bg-[rgba(255,255,255,0.1)]",
								"cursor-pointer",
							)}>
							<WandSparkles className={cn("w-4 h-4", isEnhancingPrompt && "animate-spin")} />
						</button>
					</StandardTooltip>
				</div>

				{/* kilocode_change: position tweaked, rtl support */}
				<div className="absolute bottom-2 end-2 z-30 flex items-center gap-1">
					{/* kilocode_change start: Volume visualizer - leftmost in icon group when recording */}
					{isRecording && <VolumeVisualizer volume={volumeLevel} isActive={isRecording} />}
					{/* kilocode_change end: Volume visualizer */}

					{/* kilocode_change start */}
					{!isEditMode && <IndexingStatusBadge className={cn({ hidden: containerWidth < 235 })} />}

					<StandardTooltip content="Add Context (@)">
						<button
							aria-label="Add Context (@)"
							disabled={showContextMenu}
							onClick={() => {
								if (showContextMenu || !textAreaRef.current) return

								textAreaRef.current.focus()

								setInputValue(`${inputValue} @`)
								setShowContextMenu(true)
								// Empty search query explicitly to show all options
								// and set to "File" option by default
								setSearchQuery("")
								setSelectedMenuIndex(4)
							}}
							className={cn(
								"relative inline-flex items-center justify-center",
								"bg-transparent border-none p-1.5",
								"rounded-md min-w-[28px] min-h-[28px]",
								"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
								"transition-all duration-150",
								"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
								"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
								"active:bg-[rgba(255,255,255,0.1)]",
								!showContextMenu && "cursor-pointer",
								showContextMenu &&
									"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
							)}>
							<Paperclip className={cn("w-4", "h-4", { hidden: containerWidth < 235 })} />
						</button>
					</StandardTooltip>
					{isEditMode && (
						<StandardTooltip content={t("chat:cancel.title")}>
							<button
								aria-label={t("chat:cancel.title")}
								disabled={false}
								onClick={onCancel}
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
									"transition-all duration-150",
									"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									"cursor-pointer",
								)}>
								<MessageSquareX className="w-4 h-4" />
							</button>
						</StandardTooltip>
					)}

					{/* kilocode_change start: Show microphone button only if experiment enabled */}
					{experiments?.speechToText && (
						<MicrophoneButton
							isRecording={isRecording}
							onClick={handleMicrophoneClick}
							disabled={!speechToTextStatus?.available}
							tooltipContent={
								!speechToTextStatus?.available && speechToTextStatus
									? speechToTextStatus.reason === "openaiKeyMissing"
										? t("kilocode:speechToText.unavailableOpenAiKeyMissing")
										: speechToTextStatus.reason === "ffmpegNotInstalled"
											? t("kilocode:speechToText.unavailableFfmpegNotInstalled")
											: t("kilocode:speechToText.unavailableBoth")
									: undefined
							}
						/>
					)}
					{/* kilocode_change end */}

					{inputValue.trim() !== "" && (
						<StandardTooltip content={t("chat:sendMessage")}>
							<button
								aria-label={t("chat:sendMessage")}
								disabled={sendingDisabled}
								onClick={!sendingDisabled ? onSend : undefined}
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
									"transition-all duration-150",
									"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									!sendingDisabled && "cursor-pointer",
									sendingDisabled &&
										"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
								)}>
								{/* kilocode_change: rtl */}
								<SendHorizontal className="w-4 h-4 rtl:-scale-x-100" />
							</button>
						</StandardTooltip>
					)}
					{/* kilocode_change end */}
				</div>

				{!inputValue && (
					<div
						className="absolute left-2 z-30 pr-9 flex items-center h-8"
						style={{
							bottom: "0.25rem",
							color: "var(--vscode-tab-inactiveForeground)",
							userSelect: "none",
							pointerEvents: "none",
						}}>
						{/* kilocode_change {placeholderBottomText} */}
					</div>
				)}
			</div>
		)

		return (
			<div
				className={cn(
					"relative",
					"flex",
					"flex-col",
					"gap-1",
					"bg-editor-background",
					isEditMode ? "px-0" : "px-1.5",
					"pb-1",
					"outline-none",
					"border",
					"border-none",
					isEditMode ? "w-full" : "w-[calc(100%-16px)]",
					"ml-auto",
					"mr-auto",
					"box-border",
				)}>
				<div className="relative">
					<div
						className={cn("chat-text-area", "relative", "flex", "flex-col", "outline-none")}
						onDrop={handleDrop}
						onDragOver={(e) => {
							// Only allowed to drop images/files on shift key pressed.
							if (!e.shiftKey) {
								setIsDraggingOver(false)
								return
							}

							e.preventDefault()
							setIsDraggingOver(true)
							e.dataTransfer.dropEffect = "copy"
						}}
						onDragLeave={(e) => {
							e.preventDefault()
							const rect = e.currentTarget.getBoundingClientRect()

							if (
								e.clientX <= rect.left ||
								e.clientX >= rect.right ||
								e.clientY <= rect.top ||
								e.clientY >= rect.bottom
							) {
								setIsDraggingOver(false)
							}
						}}>
						{/* kilocode_change start: ImageWarningBanner integration */}
						<ImageWarningBanner
							messageKey={imageWarning ?? ""}
							onDismiss={dismissImageWarning}
							isVisible={!!imageWarning}
						/>
						{/* kilocode_change end: ImageWarningBanner integration */}
						{/* kilocode_change start: pull slash commands from Cline */}
						{showSlashCommandsMenu && (
							<div ref={slashCommandsMenuContainerRef}>
								<SlashCommandMenu
									onSelect={handleSlashCommandsSelect}
									selectedIndex={selectedSlashCommandsIndex}
									setSelectedIndex={setSelectedSlashCommandsIndex}
									onMouseDown={handleMenuMouseDown}
									query={slashCommandsQuery}
									customModes={customModes}
								/>
							</div>
						)}
						{/* kilocode_change end: pull slash commands from Cline */}
						{showContextMenu && (
							<div
								ref={contextMenuContainerRef}
								className={cn(
									"absolute",
									"bottom-full",
									"left-0",
									"right-0",
									"z-[1000]",
									"mb-2",
									"filter",
									"drop-shadow-md",
								)}>
								<ContextMenu
									onSelect={handleMentionSelect}
									searchQuery={searchQuery}
									inputValue={inputValue}
									onMouseDown={handleMenuMouseDown}
									selectedIndex={selectedMenuIndex}
									setSelectedIndex={setSelectedMenuIndex}
									selectedType={selectedType}
									queryItems={queryItems}
									modes={allModes}
									loading={searchLoading}
									dynamicSearchResults={fileSearchResults}
								/>
							</div>
						)}

						{renderTextAreaSection()}

						<div
							// kilocode_change start
							style={{
								marginTop: "-38px",
								zIndex: 10,
								paddingLeft: "8px",
								paddingRight: "8px",
								paddingBottom: isEditMode ? "10px" : "0",
							}}
							ref={containerRef}
							// kilocode_change end
							className={cn("flex", "justify-between", "items-center", "mt-auto")}>
							<div className={cn("flex", "items-center", "gap-1", "min-w-0")}>
								<div className="shrink-0">
									{/* kilocode_change start: KiloModeSelector instead of ModeSelector */}
									<KiloModeSelector
										value={mode}
										onChange={setMode}
										modeShortcutText={modeShortcutText}
										customModes={customModes}
									/>
									{/* kilocode_change end */}
								</div>

								<KiloProfileSelector
									currentConfigId={currentConfigId}
									currentApiConfigName={currentApiConfigName}
									displayName={displayName}
									listApiConfigMeta={listApiConfigMeta}
									pinnedApiConfigs={pinnedApiConfigs}
									togglePinnedApiConfig={togglePinnedApiConfig}
									selectApiConfigDisabled={selectApiConfigDisabled}
								/>
							</div>

							{/* kilocode_change: hidden on small containerWidth
								<div className={cn("flex", "items-center", "gap-0.5", "shrink-0")}>
									{isTtsPlaying && (
										<StandardTooltip content={t("chat:stopTts")}>
											<button
												aria-label={t("chat:stopTts")}
												onClick={() => vscode.postMessage({ type: "stopTts" })}
												className={cn(
													"relative inline-flex items-center justify-center",
													"bg-transparent border-none p-1.5",
													"rounded-md min-w-[28px] min-h-[28px]",
													"text-vscode-foreground opacity-85",
													"transition-all duration-150",
													"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
													"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
													"active:bg-[rgba(255,255,255,0.1)]",
													"cursor-pointer",
												)}>
												<VolumeX className="w-4 h-4" />
											</button>
										</StandardTooltip>
									)}
									<IndexingStatusBadge />
									<StandardTooltip content={t("chat:addImages")}>
										<button
											aria-label={t("chat:addImages")}
											disabled={shouldDisableImages}
											onClick={!shouldDisableImages ? onSelectImages : undefined}
											className={cn(
												"relative inline-flex items-center justify-center",
												"bg-transparent border-none p-1.5",
												"rounded-md min-w-[28px] min-h-[28px]",
												"text-vscode-foreground opacity-85",
												"transition-all duration-150",
												"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
												"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
												"active:bg-[rgba(255,255,255,0.1)]",
												!shouldDisableImages && "cursor-pointer",
												shouldDisableImages &&
													"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
												"mr-1",
											)}>
											<Image className="w-4 h-4" />
										</button>
									</StandardTooltip>
								</div>
								*/}
						</div>
					</div>
				</div>

				{selectedImages.length > 0 && (
					<Thumbnails
						images={selectedImages}
						setImages={setSelectedImages}
						style={{
							left: "16px",
							zIndex: 2,
							marginTop: "14px", // kilocode_change
							marginBottom: 0,
						}}
					/>
				)}
			</div>
		)
	},
)
