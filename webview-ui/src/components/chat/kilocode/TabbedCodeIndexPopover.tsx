// kilocode_change - new file
import React, { useState, useRef } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { IndexingStatus } from "@roo/ExtensionMessage"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"
import { Popover, PopoverContent, Tabs, TabsContent, TabsList, TabsTrigger } from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { CodeIndexPopover } from "../CodeIndexPopover"
import { ManagedCodeIndexPopoverContent } from "./ManagedCodeIndexPopover"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	indexingStatus: IndexingStatus
}

export const TabbedCodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({ children, indexingStatus }) => {
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
				<TabbedCodeIndexPopoverTabs
					indexingStatus={indexingStatus}
					setOpen={setOpen}
					onRegisterCloseHandler={(handler) => {
						// We use this pattern so the CodeIndexPopover can decide if it wants
						// the popover to close based on if it has unsaved changes
						closeHandlerRef.current = handler
					}}
				/>
			</PopoverContent>
		</Popover>
	)
}

export const TabbedCodeIndexPopoverTabs = ({
	indexingStatus,
	setOpen,
	onRegisterCloseHandler,
}: {
	indexingStatus: IndexingStatus
	setOpen: (open: boolean) => void
	onRegisterCloseHandler: (handler: () => void) => void
}) => {
	const { t } = useAppTranslation()
	const [activeTab, setActiveTab] = useState("managed")

	return (
		<Tabs value={activeTab} onValueChange={setActiveTab}>
			<div className="p-3 cursor-default">
				<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
					<h4 className="m-0 pb-2 flex-1">{t("settings:codeIndex.title")}</h4>
				</div>
				<p className="my-0 pr-4 text-sm w-full mb-3">
					<Trans i18nKey="settings:codeIndex.description">
						<VSCodeLink
							href={buildDocLink("features/codebase-indexing", "settings")}
							style={{ display: "inline" }}
						/>
					</Trans>
				</p>

				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="managed">Managed</TabsTrigger>
					<TabsTrigger value="local">Local</TabsTrigger>
				</TabsList>
			</div>

			<div className="border-t border-vscode-dropdown-border" />

			<div className="p-4">
				<TabsContent value="managed" className="mt-0">
					<ManagedCodeIndexPopoverContent />
				</TabsContent>

				<TabsContent value="local" className="mt-0">
					<CodeIndexPopover
						contentOnly
						indexingStatus={indexingStatus}
						open={activeTab === "local"}
						onOpenChange={setOpen}
						onRegisterCloseHandler={onRegisterCloseHandler}>
						<></>
					</CodeIndexPopover>
				</TabsContent>
			</div>
		</Tabs>
	)
}
