import { useState, useEffect, useMemo, useContext } from "react"
import { SKILLS_MARKETPLACE_ENABLED } from "@roo-code/types" // kilocode_change
import { Button } from "@/components/ui/button"
import { Tab, TabContent, TabHeader } from "../common/Tab"
import { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"
import { useStateManager } from "./useStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { MarketplaceListView } from "./MarketplaceListView"
import { SkillsMarketplace } from "./SkillsMarketplace" // kilocode_change
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

interface MarketplaceViewProps {
	onDone?: () => void
	stateManager: MarketplaceViewStateManager
	targetTab?: "mcp" | "mode" | "skills" // kilocode_change - Added skills tab
	hideHeader?: boolean // kilocode_change
}
export function MarketplaceView({ stateManager, onDone, targetTab, hideHeader = false }: MarketplaceViewProps) {
	const { t } = useAppTranslation()
	const [state, manager] = useStateManager(stateManager)
	const [hasReceivedInitialState, setHasReceivedInitialState] = useState(false)
	const extensionState = useContext(ExtensionStateContext)
	const [lastOrganizationSettingsVersion, setLastOrganizationSettingsVersion] = useState<number>(
		extensionState?.organizationSettingsVersion ?? -1,
	)

	useEffect(() => {
		const currentVersion = extensionState?.organizationSettingsVersion ?? -1
		if (currentVersion !== lastOrganizationSettingsVersion) {
			vscode.postMessage({
				type: "fetchMarketplaceData",
			})
		}
		setLastOrganizationSettingsVersion(currentVersion)
	}, [extensionState?.organizationSettingsVersion, lastOrganizationSettingsVersion])

	// Track when we receive the initial state
	useEffect(() => {
		// Check if we already have items (state might have been received before mount)
		if (state.allItems.length > 0 && !hasReceivedInitialState) {
			setHasReceivedInitialState(true)
		}
	}, [state.allItems, hasReceivedInitialState])

	useEffect(() => {
		if (targetTab && (targetTab === "mcp" || targetTab === "mode" || targetTab === "skills")) {
			manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: targetTab } })
		}
	}, [targetTab, manager])

	// Ensure marketplace state manager processes messages when component mounts
	useEffect(() => {
		// When the marketplace view first mounts, we need to trigger a state update
		// to ensure we get the current marketplace items. We do this by sending
		// a filter message with empty filters, which will cause the extension to
		// send back the full state including all marketplace items.
		if (!hasReceivedInitialState && state.allItems.length === 0) {
			// Fetch marketplace data on demand
			// Note: isFetching is already true by default for initial load
			vscode.postMessage({
				type: "fetchMarketplaceData",
			})
		}

		// Listen for state changes to know when initial data arrives
		const unsubscribe = manager.onStateChange((newState) => {
			// Mark as received initial state when we get any state update
			// This prevents infinite loops and ensures proper state handling
			if (!hasReceivedInitialState && (newState.allItems.length > 0 || newState.displayItems !== undefined)) {
				setHasReceivedInitialState(true)
			}
		})

		const handleVisibilityMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "webviewVisible" && message.visible === true) {
				// Data will be automatically fresh when panel becomes visible
				// No manual fetching needed since we removed caching
			}
		}

		window.addEventListener("message", handleVisibilityMessage)
		return () => {
			window.removeEventListener("message", handleVisibilityMessage)
			unsubscribe()
		}
	}, [manager, hasReceivedInitialState, state.allItems.length])

	// Memoize all available tags
	const allTags = useMemo(
		() => Array.from(new Set(state.allItems.flatMap((item) => item.tags || []))).sort(),
		[state.allItems],
	)

	// Memoize filtered tags
	const filteredTags = useMemo(() => allTags, [allTags])

	// kilocode_change start - Header messages for each tab
	const modesHeaderMessage = useMemo(
		() => ({
			translationKey: "kilocode:marketplace.modes.description",
			onLinkClick: () => {
				vscode.postMessage({ type: "switchTab", tab: "modes" })
			},
		}),
		[],
	)
	const mcpHeaderMessage = useMemo(
		() => ({
			translationKey: "kilocode:marketplace.mcp.description",
			onLinkClick: () => {
				vscode.postMessage({ type: "switchTab", tab: "mcp" })
			},
		}),
		[],
	)
	// kilocode_change end - Header messages for each tab

	// kilocode_change - Skills are now fetched as part of fetchMarketplaceData
	// No separate fetch needed - skills come with the unified marketplace data

	return (
		<TooltipProvider delayDuration={300}>
			{/* kilocode_change: header conditionally className relative or fixed */}
			<Tab className={cn(hideHeader ? "relative" : "fixed")}>
				{/*  kilocode_change: display header conditionally */}
				<TabHeader
					style={{ display: hideHeader ? "none" : "flex" }}
					className="flex flex-col sticky top-0 z-10 px-3 py-2 bg-vscode-sideBar-background">
					<div className="flex justify-between items-center px-2">
						<h3 className="font-bold m-0">{t("marketplace:title")}</h3>
						<div className="flex gap-2 items-center">
							<Button
								variant="primary"
								onClick={() => {
									onDone?.()
								}}>
								{t("marketplace:done")}
							</Button>
						</div>
					</div>

					<div className="w-full mt-2">
						<div className="flex relative py-1">
							<div className="absolute w-full h-[2px] -bottom-[2px] bg-vscode-input-border">
								{/* kilocode_change start - Tab indicator with fixed 33.33% width */}
								<div
									className={cn(
										"absolute h-[2px] bottom-0 bg-vscode-button-background transition-all duration-300 ease-in-out w-1/3",
									)}
									style={{
										left:
											state.activeTab === "mcp"
												? "0%"
												: state.activeTab === "mode"
													? "33.33%"
													: "66.66%",
									}}
								/>
								{/* kilocode_change end */}
							</div>
							<button
								className="flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() => manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mcp" } })}>
								MCP
							</button>
							<button
								className="flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
								onClick={() =>
									manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mode" } })
								}>
								Modes
							</button>
							{/* kilocode_change start - Skills tab button or filler div */}
							{SKILLS_MARKETPLACE_ENABLED ? (
								<button
									className="flex items-center justify-center gap-2 flex-1 text-sm font-medium rounded-sm transition-colors duration-300 relative z-10 text-vscode-foreground"
									onClick={() =>
										manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "skills" } })
									}>
									Skills
								</button>
							) : (
								<div className="flex-1" />
							)}
							{/* kilocode_change end */}
						</div>
					</div>
				</TabHeader>

				<TabContent className="p-3 pt-2">
					{state.activeTab === "mcp" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mcp"
							headerMessage={mcpHeaderMessage} // kilocode_change
						/>
					)}
					{state.activeTab === "mode" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mode"
							headerMessage={modesHeaderMessage} // kilocode_change
						/>
					)}
					{/* kilocode_change start - Skills marketplace tab content */}
					{SKILLS_MARKETPLACE_ENABLED && state.activeTab === "skills" && (
						<SkillsMarketplace skills={stateManager.getSkills()} isLoading={state.isFetching} />
					)}
					{/* kilocode_change end */}
				</TabContent>
			</Tab>
		</TooltipProvider>
	)
}
