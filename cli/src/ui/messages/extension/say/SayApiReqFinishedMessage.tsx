import React from "react"
import type { MessageComponentProps } from "../types.js"

/**
 * Display API request finished (minimal display)
 * This message type is typically not rendered as it's handled internally
 */
export const SayApiReqFinishedMessage: React.FC<MessageComponentProps> = () => {
	// This message type is usually not displayed, but we provide a minimal implementation
	return null
}
