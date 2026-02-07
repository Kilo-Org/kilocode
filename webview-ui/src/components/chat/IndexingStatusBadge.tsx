import React, { useState, useEffect, useMemo } from "react"
import { Database } from "lucide-react"

import type { IndexingStatus, IndexingStatusUpdateMessage } from "@roo-code/types"

import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { PopoverTrigger, StandardTooltip, Button } from "@src/components/ui"

import { CodeIndexPopover } from "./CodeIndexPopover" // kilocode_change
import { useManagedIndexerState, useIsIndexing } from "./hooks/useManagedIndexerState" // kilocode_change
import { ManagedCodeIndexPopover } from "./kilocode/ManagedCodeIndexPopover" // kilocode_change

interface IndexingStatusBadgeProps {
	className?: string
}

export const IndexingStatusBadge: React.FC<IndexingStatusBadgeProps> = ({ className }) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()

	// Get managed indexer state
	const managedIndexerState = useManagedIndexerState() // kilocode_change
	const isManagedIndexing = useIsIndexing() // kilocode_change

	const [localIndexingStatus, setLocalIndexingStatus] = useState<IndexingStatus>({
		systemStatus: "Standby",
		processedItems: 0,
		totalItems: 0,
		currentItemUnit: "items",
	})

	useEffect(() => {
		// Only request local indexing status if managed indexing is not enabled
		if (!managedIndexerState.isEnabled) {
			vscode.postMessage({ type: "requestIndexingStatus" })
		}

		// Set up message listener for status updates.
		const handleMessage = (event: MessageEvent<IndexingStatusUpdateMessage>) => {
			if (event.data.type === "indexingStatusUpdate") {
				const status = event.data.values
				if (!status.workspacePath || status.workspacePath === cwd) {
					setLocalIndexingStatus(status)
				}
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [cwd, managedIndexerState.isEnabled])

	// Determine which indexing status to use
	const indexingStatus = useMemo(() => {
		if (managedIndexerState.isEnabled) {
			// Use managed indexer state
			const hasErrors = managedIndexerState.workspaceFolders.some((folder) => folder.error !== undefined)
			const hasManifests = managedIndexerState.workspaceFolders.some((folder) => folder.hasManifest)

			return {
				systemStatus: hasErrors
					? "Error"
					: isManagedIndexing
						? "Indexing"
						: hasManifests
							? "Indexed"
							: "Standby",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items" as const,
			}
		}
		return localIndexingStatus
	}, [managedIndexerState, isManagedIndexing, localIndexingStatus])

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const tooltipText = useMemo(() => {
		if (managedIndexerState.isEnabled) {
			// Custom tooltips for managed indexing
			const folderCount = managedIndexerState.workspaceFolders.length
			const indexingCount = managedIndexerState.workspaceFolders.filter((f) => f.isIndexing).length
			const errorCount = managedIndexerState.workspaceFolders.filter((f) => f.error).length

			if (errorCount > 0) {
				return `Managed indexing error (${errorCount} folder${errorCount > 1 ? "s" : ""})`
			}
			if (indexingCount > 0) {
				return `Indexing ${indexingCount} of ${folderCount} workspace folder${folderCount > 1 ? "s" : ""}`
			}
			if (folderCount > 0) {
				return `Managed indexing ready (${folderCount} folder${folderCount > 1 ? "s" : ""})`
			}
			return "Managed indexing enabled"
		}

		// Local indexing tooltips
		switch (indexingStatus.systemStatus) {
			case "Standby":
				return t("chat:indexingStatus.ready")
			case "Indexing":
				return t("chat:indexingStatus.indexing", { percentage: progressPercentage })
			case "Indexed":
				return t("chat:indexingStatus.indexed")
			case "Error":
				return t("chat:indexingStatus.error")
			default:
				return t("chat:indexingStatus.status")
		}
	}, [managedIndexerState, indexingStatus.systemStatus, progressPercentage, t])

	const statusColorClass = useMemo(() => {
		const statusColors = {
			Standby: "bg-vscode-descriptionForeground/60",
			Indexing: "bg-yellow-500 animate-pulse",
			Indexed: "bg-green-500",
			Error: "bg-red-500",
		}

		return statusColors[indexingStatus.systemStatus as keyof typeof statusColors] || statusColors.Standby
	}, [indexingStatus.systemStatus])

	// Use ManagedCodeIndexPopover when organization is available, otherwise use regular CodeIndexPopover
	const PopoverComponent = managedIndexerState.isEnabled ? ManagedCodeIndexPopover : CodeIndexPopover // kilocode_change

	return (
		<PopoverComponent indexingStatus={indexingStatus}>
			<StandardTooltip content={tooltipText}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={tooltipText}
						className={cn(
							"relative h-5 w-5 p-0",
							"text-vscode-foreground opacity-60", // kilocode_change: opacity to match paperclip
							"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)]",
							"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
							className,
						)}>
						<Database className="w-4 h-4" />
						<span
							className={cn(
								"absolute top-0 right-0 w-1.5 h-1.5 rounded-full transition-colors duration-200",
								statusColorClass,
							)}
						/>
					</Button>
				</PopoverTrigger>
			</StandardTooltip>
		</PopoverComponent>
	)
}
