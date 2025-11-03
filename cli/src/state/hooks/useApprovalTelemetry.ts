/**
 * Hook for tracking approval decisions in telemetry
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { pendingApprovalAtom } from "../atoms/approval.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import type { ExtensionChatMessage } from "../../types/messages.js"

/**
 * Hook to track approval flow telemetry
 */
export function useApprovalTelemetry() {
	const pendingApproval = useAtomValue(pendingApprovalAtom)
	const approvalStartTimeRef = useRef<number>(0)
	const lastApprovalTsRef = useRef<number>(0)

	// Track when approval is requested
	useEffect(() => {
		if (pendingApproval && pendingApproval.ts !== lastApprovalTsRef.current) {
			approvalStartTimeRef.current = Date.now()
			lastApprovalTsRef.current = pendingApproval.ts

			const { approvalType, toolName } = extractApprovalInfo(pendingApproval)
			getTelemetryService().trackApprovalRequested(approvalType, toolName)
		}
	}, [pendingApproval])

	return {
		/**
		 * Track auto-approval
		 */
		trackAutoApproval: (message: ExtensionChatMessage) => {
			const responseTime = Date.now() - approvalStartTimeRef.current
			const { approvalType, toolName } = extractApprovalInfo(message)
			getTelemetryService().trackApprovalAutoApproved(approvalType, toolName, responseTime)
		},

		/**
		 * Track auto-rejection
		 */
		trackAutoRejection: (message: ExtensionChatMessage) => {
			const { approvalType, toolName } = extractApprovalInfo(message)
			getTelemetryService().trackApprovalAutoRejected(approvalType, toolName)
		},

		/**
		 * Track manual approval
		 */
		trackManualApproval: (message: ExtensionChatMessage) => {
			const responseTime = Date.now() - approvalStartTimeRef.current
			const { approvalType, toolName } = extractApprovalInfo(message)
			getTelemetryService().trackApprovalManualApproved(approvalType, toolName, responseTime)
		},

		/**
		 * Track manual rejection
		 */
		trackManualRejection: (message: ExtensionChatMessage) => {
			const responseTime = Date.now() - approvalStartTimeRef.current
			const { approvalType, toolName } = extractApprovalInfo(message)
			getTelemetryService().trackApprovalManualRejected(approvalType, toolName, responseTime)
		},
	}
}

/**
 * Extract approval information from message
 */
function extractApprovalInfo(message: ExtensionChatMessage): { approvalType: string; toolName?: string } {
	const approvalType = message.ask || "unknown"
	let toolName: string | undefined

	if (approvalType === "tool" && message.text) {
		try {
			const toolData = JSON.parse(message.text)
			toolName = toolData.tool
		} catch {
			// Ignore parse errors
		}
	} else if (approvalType === "command" && message.text) {
		try {
			const commandData = JSON.parse(message.text)
			toolName = commandData.command
		} catch {
			// Use text directly as command name
			toolName = message.text
		}
	}

	const result: { approvalType: string; toolName?: string } = { approvalType }
	if (toolName) {
		result.toolName = toolName
	}
	return result
}
