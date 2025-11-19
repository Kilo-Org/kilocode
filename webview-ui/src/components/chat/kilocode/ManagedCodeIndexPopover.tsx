// kilocode_change - new file
import React, { useState, useEffect, useCallback } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { IndexingStatus } from "@roo/ExtensionMessage"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { OrganizationIndexingTab } from "./OrganizationIndexingTab"

interface CodeIndexPopoverProps {
	indexingStatus: IndexingStatus
}

export const ManagedCodeIndexPopoverContent: React.FC<CodeIndexPopoverProps> = ({
	indexingStatus: externalIndexingStatus,
}) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()
	const [open, setOpen] = useState(false)

	const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>(externalIndexingStatus)

	// Update indexing status from parent
	useEffect(() => {
		setIndexingStatus(externalIndexingStatus)
	}, [externalIndexingStatus])

	// Request initial indexing status
	useEffect(() => {
		if (open) {
			vscode.postMessage({ type: "requestIndexingStatus" })
		}
		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === "workspaceUpdated") {
				// When workspace changes, request updated indexing status
				if (open) {
					vscode.postMessage({ type: "requestIndexingStatus" })
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [open])

	// Listen for indexing status updates
	useEffect(() => {
		const handleMessage = (event: MessageEvent<any>) => {
			if (event.data.type === "indexingStatusUpdate") {
				if (!event.data.values.workspacePath || event.data.values.workspacePath === cwd) {
					setIndexingStatus({
						systemStatus: event.data.values.systemStatus,
						message: event.data.values.message || "",
						processedItems: event.data.values.processedItems,
						totalItems: event.data.values.totalItems,
						currentItemUnit: event.data.values.currentItemUnit || "items",
					})
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [cwd])

	// Use the shared ESC key handler hook
	useEscapeKey(open, () => setOpen(false))

	const handleCancelIndexing = useCallback(() => {
		// Optimistically update UI while backend cancels
		setIndexingStatus((prev) => ({
			...prev,
			message: t("settings:codeIndex.cancelling"),
		}))
		vscode.postMessage({ type: "cancelIndexing" })
	}, [t])

	return (
		<>
			<div className="p-3 border-b border-vscode-dropdown-border cursor-default">
				<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
					<h4 className="m-0 pb-2 flex-1">{t("settings:codeIndex.title")}</h4>
				</div>
				<p className="my-0 pr-4 text-sm w-full">
					<Trans i18nKey="settings:codeIndex.description">
						<VSCodeLink
							href={buildDocLink("features/codebase-indexing", "settings")}
							style={{ display: "inline" }}
						/>
					</Trans>
				</p>
			</div>

			<div className="p-4">
				<OrganizationIndexingTab indexingStatus={indexingStatus} onCancelIndexing={handleCancelIndexing} />
			</div>
		</>
	)
}
