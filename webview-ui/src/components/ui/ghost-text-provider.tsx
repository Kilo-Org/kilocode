import React, { createContext, useContext, useCallback, useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { generateRequestId } from "@roo/id"
import { cn } from "@/lib/utils"

interface GhostTextPosition {
	line: number
	column: number
	text: string
	confidence: number
}

interface GhostTextContextType {
	ghostText: GhostTextPosition | null
	showGhostText: boolean
	acceptGhostText: () => void
	dismissGhostText: () => void
	requestCompletion: (text: string, position: { line: number; column: number }) => void
}

const GhostTextContext = createContext<GhostTextContextType | null>(null)

export const useGhostText = () => {
	const context = useContext(GhostTextContext)
	if (!context) {
		throw new Error("useGhostText must be used within a GhostTextProvider")
	}
	return context
}

interface GhostTextProviderProps {
	children: React.ReactNode
	enabled?: boolean
	debounceMs?: number
	minTriggerLength?: number
}

export const GhostTextProvider: React.FC<GhostTextProviderProps> = ({
	children,
	enabled = true,
	debounceMs = 150,
	minTriggerLength = 3,
}) => {
	const [ghostText, setGhostText] = useState<GhostTextPosition | null>(null)
	const [showGhostText, setShowGhostText] = useState(true)
	const debounceRef = useRef<NodeJS.Timeout | null>(null)
	const requestIdRef = useRef<string>("")
	const lastRequestRef = useRef<{ text: string; position: { line: number; column: number } } | null>(null)

	// Handle completion results from extension
	useEffect(() => {
		const messageHandler = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (message.type === "chatCompletionResult" && message.completionRequestId === requestIdRef.current) {
				if (message.text) {
					setGhostText({
						line: 0, // Would need to be determined from editor context
						column: 0, // Would need to be determined from editor context
						text: message.text,
						confidence: 0.8, // Default confidence
					})
					setShowGhostText(true)
				} else {
					setGhostText(null)
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [])

	const requestCompletion = useCallback(
		(text: string, position: { line: number; column: number }) => {
			if (!enabled || text.length < minTriggerLength) {
				setGhostText(null)
				return
			}

			// Clear existing debounce
			if (debounceRef.current) {
				clearTimeout(debounceRef.current)
			}

			// Store the request for comparison
			lastRequestRef.current = { text, position }

			// Debounce the request
			debounceRef.current = setTimeout(() => {
				const requestId = generateRequestId()
				requestIdRef.current = requestId

				vscode.postMessage({
					type: "requestChatCompletion",
					text,
					requestId,
				})
			}, debounceMs)
		},
		[enabled, minTriggerLength, debounceMs],
	)

	const acceptGhostText = useCallback(() => {
		if (ghostText) {
			vscode.postMessage({
				type: "chatCompletionAccepted",
				suggestionLength: ghostText.text.length,
			})

			setGhostText(null)
			setShowGhostText(false)
		}
	}, [ghostText])

	const dismissGhostText = useCallback(() => {
		setGhostText(null)
		setShowGhostText(false)
	}, [])

	const contextValue: GhostTextContextType = {
		ghostText,
		showGhostText,
		acceptGhostText,
		dismissGhostText,
		requestCompletion,
	}

	return (
		<GhostTextContext.Provider value={contextValue}>
			{children}
			<GhostTextRenderer />
		</GhostTextContext.Provider>
	)
}

// Ghost text renderer component
const GhostTextRenderer: React.FC = () => {
	const { ghostText, showGhostText } = useGhostText()

	return (
		<AnimatePresence>
			{showGhostText && ghostText && (
				<motion.div
					initial={{ opacity: 0, y: 2 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: 2 }}
					transition={{ duration: 0.15 }}
					className="pointer-events-none fixed z-50"
					style={{
						// This would need to be calculated based on editor position
						// For now, we'll use a simple positioning approach
						top: `${ghostText.line * 20 + 40}px`, // Approximate line height
						left: `${ghostText.column * 8 + 60}px`, // Approximate character width
					}}>
					<div className="relative">
						<div
							className={cn(
								"text-vscode-descriptionForeground opacity-60 font-mono text-sm whitespace-pre",
								"border-b border-dashed border-vscode-descriptionForeground/30",
							)}>
							{ghostText.text}
						</div>
						{/* Confidence indicator */}
						<div
							className={cn(
								"absolute -top-1 -right-1 w-2 h-2 rounded-full",
								ghostText.confidence > 0.8
									? "bg-green-500"
									: ghostText.confidence > 0.5
										? "bg-yellow-500"
										: "bg-red-500",
							)}
							title={`Confidence: ${Math.round(ghostText.confidence * 100)}%`}
						/>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	)
}

// Hook for editor integration
export const useGhostTextEditor = () => {
	const { ghostText, acceptGhostText, dismissGhostText, requestCompletion } = useGhostText()

	const handleKeyDown = useCallback(
		(event: KeyboardEvent, _currentText: string, _position: { line: number; column: number }) => {
			// Tab to accept
			if (event.key === "Tab" && ghostText && !event.shiftKey) {
				event.preventDefault()
				acceptGhostText()
				return true
			}

			// Escape to dismiss
			if (event.key === "Escape" && ghostText) {
				event.preventDefault()
				dismissGhostText()
				return true
			}

			// Arrow right to accept word by word (simplified)
			if (event.key === "ArrowRight" && ghostText && !event.ctrlKey && !event.metaKey) {
				event.preventDefault()
				// For now, accept full text. Could be enhanced to accept word by word
				acceptGhostText()
				return true
			}

			return false
		},
		[ghostText, acceptGhostText, dismissGhostText],
	)

	const handleTextChange = useCallback(
		(text: string, position: { line: number; column: number }) => {
			requestCompletion(text, position)
		},
		[requestCompletion],
	)

	return {
		ghostText,
		handleKeyDown,
		handleTextChange,
		acceptGhostText,
		dismissGhostText,
	}
}

// Inline action lenses component
interface InlineActionLensesProps {
	position: { line: number; column: number }
	actions: Array<{
		id: string
		label: string
		icon: string
		action: () => void
	}>
}

export const InlineActionLenses: React.FC<InlineActionLensesProps> = ({ position, actions }) => {
	const [visible, setVisible] = useState(false)

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.9 }}
					transition={{ duration: 0.15 }}
					className="fixed z-50 bg-vscode-toolbar-background border border-vscode-border rounded-md shadow-lg p-1"
					style={{
						top: `${position.line * 20 + 20}px`,
						left: `${position.column * 8 + 50}px`,
					}}
					onMouseLeave={() => setVisible(false)}>
					{actions.map((action) => (
						<button
							key={action.id}
							className="flex items-center gap-2 px-3 py-1 text-xs text-vscode-foreground hover:bg-vscode-button-background rounded-sm transition-colors"
							onClick={() => {
								action.action()
								setVisible(false)
							}}>
							<span className="text-vscode-icon-foreground">{action.icon}</span>
							<span>{action.label}</span>
						</button>
					))}
				</motion.div>
			)}
		</AnimatePresence>
	)
}
