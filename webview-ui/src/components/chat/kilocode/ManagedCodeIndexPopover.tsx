// kilocode_change - new file
import React, { useState, useRef, useEffect } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { IndexingStatus } from "@roo/ExtensionMessage"

import { Popover, PopoverContent } from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { vscode } from "@src/utils/vscode"
import { ManagedIndexerStatus } from "./ManagedIndexerStatus"
import { type WorkspaceFolderState } from "./managedIndexerSchema"
import { useExtensionState } from "../../../context/ExtensionStateContext"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	indexingStatus: IndexingStatus
}

export const ManagedCodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({ children }) => {
	const [open, setOpen] = useState(false)
	const closeHandlerRef = useRef<() => void>(() => setOpen(false))

	const handlePopoverOpenChange = (newOpen: boolean) => {
		if (newOpen) {
			setOpen(true)
		} else {
			// Don't close immediately - ask child to handle it if registered
			closeHandlerRef.current?.()
		}
	}

	// Use the shared ESC key handler hook - delegate to child if possible
	useEscapeKey(open, () => {
		closeHandlerRef.current?.()
	})

	const portalContainer = useRooPortal("roo-portal")

	return (
		<Popover open={open} onOpenChange={handlePopoverOpenChange}>
			{children}
			<PopoverContent
				className="w-[calc(100vw-32px)] max-w-[450px] max-h-[80vh] overflow-y-auto p-0"
				align="end"
				alignOffset={0}
				side="bottom"
				sideOffset={5}
				collisionPadding={16}
				avoidCollisions={true}
				container={portalContainer}>
				<Content />
			</PopoverContent>
		</Popover>
	)
}

const Content = () => {
	const state = useExtensionState()
	const orgId = state.apiConfiguration?.kilocodeOrganizationId
	const href = `https://kilo.ai/organizations/${orgId}/code-indexing`
	const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolderState[]>([])

	// Request initial state when popover opens
	// Listen for managed indexer state updates
	useEffect(() => {
		console.log("[ManagedCodeIndexPopoverContent] requesting managed indexer state")
		vscode.postMessage({ type: "requestManagedIndexerState" })

		const handleMessage = (event: MessageEvent<any>) => {
			console.log("[ManagedCodeIndexPopoverContent] received event", event)
			if (event.data.type === "managedIndexerState") {
				setWorkspaceFolders(event.data.managedIndexerState || [])
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	if (workspaceFolders.length === 0) {
		return (
			<>
				<div className="p-3 cursor-default">
					<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
						<h4 className="m-0 pb-2 flex-1">Managed Code Indexing</h4>
					</div>
					<p className="my-0 pr-4 text-sm w-full mb-3">
						<VSCodeLink href={href}>Configure on kilo.ai</VSCodeLink>
					</p>
				</div>

				<div className="border-t border-vscode-dropdown-border" />

				<div className="p-4">
					<p className="text-sm text-vscode-descriptionForeground">
						Managed code indexing is only available when workspace folders are git repositories.
					</p>
				</div>
			</>
		)
	}

	return (
		<>
			<div className="p-3 cursor-default">
				<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
					<h4 className="m-0 pb-2 flex-1">Managed Code Indexing</h4>
				</div>
				<p className="my-0 pr-4 text-sm w-full mb-3">
					<VSCodeLink href={href}>Configure on kilo.ai</VSCodeLink>
				</p>
			</div>

			<div className="border-t border-vscode-dropdown-border" />

			<div className="p-4">
				<ManagedIndexerStatus workspaceFolders={workspaceFolders} />
			</div>
		</>
	)
}
