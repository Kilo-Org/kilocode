import React, { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { useEvent } from "react-use"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionMessage } from "@roo/ExtensionMessage"
import TranslationProvider from "./i18n/TranslationContext"
import { MarketplaceViewStateManager } from "./components/marketplace/MarketplaceViewStateManager"

import { vscode } from "./utils/vscode"
import { telemetryClient } from "./utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"
import { initializeSourceMaps, exposeSourceMapsForDebugging } from "./utils/sourceMapInitializer"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import ChatView, { ChatViewRef } from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView, { SettingsViewRef } from "./components/settings/SettingsView"
import WelcomeView from "./components/kilocode/welcome/WelcomeView" // kilocode_change
import ProfileView from "./components/kilocode/profile/ProfileView" // kilocode_change
import McpView from "./components/mcp/McpView" // kilocode_change
import AuthView from "./components/kilocode/auth/AuthView" // kilocode_change
import { MarketplaceView } from "./components/marketplace/MarketplaceView"
import BottomControls from "./components/kilocode/BottomControls" // kilocode_change
import { MemoryService } from "./services/MemoryService" // kilocode_change
import { HumanRelayDialog } from "./components/human-relay/HumanRelayDialog"
import { CheckpointRestoreDialog } from "./components/chat/CheckpointRestoreDialog"
import { DeleteMessageDialog, EditMessageDialog } from "./components/chat/MessageModificationConfirmationDialog"
import ErrorBoundary from "./components/ErrorBoundary"
// import { AccountView } from "./components/account/AccountView" // kilocode_change: we have our own profile view
// import { CloudView } from "./components/cloud/CloudView" // kilocode_change: not rendering this
import { useAddNonInteractiveClickListener } from "./components/ui/hooks/useNonInteractiveClick"
import { TooltipProvider } from "./components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "./components/ui/standard-tooltip"
import { useKiloIdentity } from "./utils/kilocode/useKiloIdentity"
import { MemoryWarningBanner } from "./kilocode/MemoryWarningBanner"

type Tab = "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "account" | "cloud" | "profile" | "auth" // kilocode_change: add "profile" and "auth"

interface HumanRelayDialogState {
	isOpen: boolean
	requestId: string
	promptText: string
}

interface DeleteMessageDialogState {
	isOpen: boolean
	messageTs: number
	hasCheckpoint: boolean
}

interface EditMessageDialogState {
	isOpen: boolean
	messageTs: number
	text: string
	hasCheckpoint: boolean
	images?: string[]
}

// Memoize dialog components to prevent unnecessary re-renders
const MemoizedDeleteMessageDialog = React.memo(DeleteMessageDialog)
const MemoizedEditMessageDialog = React.memo(EditMessageDialog)
const MemoizedCheckpointRestoreDialog = React.memo(CheckpointRestoreDialog)
const MemoizedHumanRelayDialog = React.memo(HumanRelayDialog)

const tabsByMessageAction: Partial<Record<NonNullable<ExtensionMessage["action"]>, Tab>> = {
	chatButtonClicked: "chat",
	settingsButtonClicked: "settings",
	historyButtonClicked: "history",
	profileButtonClicked: "profile",
	marketplaceButtonClicked: "marketplace",
	promptsButtonClicked: "settings", // kilocode_change: Navigate to settings with modes section
	// cloudButtonClicked: "cloud", // kilocode_change: no cloud
}

// kilocode_change start: Map certain actions to a default section when navigating to settings
const defaultSectionByAction: Partial<Record<NonNullable<ExtensionMessage["action"]>, string>> = {
	promptsButtonClicked: "modes",
}
// kilocode_change end

const App = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		telemetrySetting,
		telemetryKey,
		machineId,
		// kilocode_change start: unused
		// cloudUserInfo,
		// cloudIsAuthenticated,
		// cloudApiUrl,
		// cloudOrganizations,
		// kilocode_change end
		renderContext,
		mdmCompliant,
		apiConfiguration, // kilocode_change
	} = useExtensionState()

	// Create a persistent state manager
	const marketplaceStateManager = useMemo(() => new MarketplaceViewStateManager(), [])

	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [tab, setTab] = useState<Tab>("chat")
	const [authReturnTo, setAuthReturnTo] = useState<"chat" | "settings">("chat")
	const [authProfileName, setAuthProfileName] = useState<string | undefined>(undefined)
	const [settingsEditingProfile, setSettingsEditingProfile] = useState<string | undefined>(undefined)

	const [humanRelayDialogState, setHumanRelayDialogState] = useState<HumanRelayDialogState>({
		isOpen: false,
		requestId: "",
		promptText: "",
	})

	const [deleteMessageDialogState, setDeleteMessageDialogState] = useState<DeleteMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		hasCheckpoint: false,
	})

	const [editMessageDialogState, setEditMessageDialogState] = useState<EditMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		text: "",
		hasCheckpoint: false,
		images: [],
	})

	const settingsRef = useRef<SettingsViewRef>(null)
	const chatViewRef = useRef<ChatViewRef & { focusInput: () => void }>(null) // kilocode_change

	const switchTab = useCallback(
		(newTab: Tab) => {
			// Only check MDM compliance if mdmCompliant is explicitly false (meaning there's an MDM policy and user is non-compliant)
			// If mdmCompliant is undefined or true, allow tab switching
			if (mdmCompliant === false && newTab !== "cloud") {
				// Notify the user that authentication is required by their organization
				vscode.postMessage({ type: "showMdmAuthRequiredNotification" })
				return
			}

			setCurrentSection(undefined)
			setCurrentMarketplaceTab(undefined)

			// kilocode_change: start - Bypass unsaved changes check when navigating to auth tab
			if (newTab === "auth") {
				setTab(newTab)
			} else if (settingsRef.current?.checkUnsaveChanges) {
				// kilocode_change: end
				settingsRef.current.checkUnsaveChanges(() => setTab(newTab))
			} else {
				setTab(newTab)
			}
		},
		[mdmCompliant],
	)

	const [currentSection, setCurrentSection] = useState<string | undefined>(undefined)
	const [_currentMarketplaceTab, setCurrentMarketplaceTab] = useState<string | undefined>(undefined)

	const onMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			if (message.type === "action" && message.action) {
				// kilocode_change begin
				if (message.action === "focusChatInput") {
					if (tab !== "chat") {
						switchTab("chat")
					}
					chatViewRef.current?.focusInput()
					return
				}
				// kilocode_change end

				// Handle switchTab action with tab parameter
				if (message.action === "switchTab" && message.tab) {
					const targetTab = message.tab as Tab
					// kilocode_change start - Handle auth tab with returnTo and profileName parameters
					if (targetTab === "auth") {
						if (message.values?.returnTo) {
							const returnTo = message.values.returnTo as "chat" | "settings"
							setAuthReturnTo(returnTo)
						}
						if (message.values?.profileName) {
							const profileName = message.values.profileName as string
							setAuthProfileName(profileName)
							setSettingsEditingProfile(profileName)
						}
					}
					// kilocode_change end
					switchTab(targetTab)
					// Extract targetSection from values if provided
					const targetSection = message.values?.section as string | undefined
					setCurrentSection(targetSection)
					setCurrentMarketplaceTab(undefined)
				} else {
					// Handle other actions using the mapping
					const newTab = tabsByMessageAction[message.action]
					// kilocode_change start
					const section =
						(message.values?.section as string | undefined) ?? defaultSectionByAction[message.action]
					// kilocode_change end
					const marketplaceTab = message.values?.marketplaceTab as string | undefined
					const editingProfile = message.values?.editingProfile as string | undefined // kilocode_change

					if (newTab) {
						switchTab(newTab)
						setCurrentSection(section)
						setCurrentMarketplaceTab(marketplaceTab)
						// kilocode_change start - If navigating to settings with editingProfile, forward it
						if (newTab === "settings" && editingProfile) {
							// Re-send the message to SettingsView with the editingProfile
							setTimeout(() => {
								window.postMessage(
									{
										type: "action",
										action: "settingsButtonClicked",
										values: { editingProfile },
									},
									"*",
								)
							}, 100)
						}
						// kilocode_change end
					}
				}
			}

			if (message.type === "showHumanRelayDialog" && message.requestId && message.promptText) {
				const { requestId, promptText } = message
				setHumanRelayDialogState({ isOpen: true, requestId, promptText })
			}

			if (message.type === "showDeleteMessageDialog" && message.messageTs) {
				setDeleteMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					hasCheckpoint: message.hasCheckpoint || false,
				})
			}

			if (message.type === "showEditMessageDialog" && message.messageTs && message.text) {
				setEditMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					text: message.text,
					hasCheckpoint: message.hasCheckpoint || false,
					images: message.images || [],
				})
			}

			if (message.type === "acceptInput") {
				chatViewRef.current?.acceptInput()
			}
		},
		// kilocode_change: add tab
		[tab, switchTab],
	)

	useEvent("message", onMessage)

	useEffect(() => {
		if (shouldShowAnnouncement && tab === "chat") {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement, tab])

	// kilocode_change start
	const telemetryDistinctId = useKiloIdentity(apiConfiguration?.kilocodeToken ?? "", machineId ?? "")
	useEffect(() => {
		if (didHydrateState) {
			telemetryClient.updateTelemetryState(telemetrySetting, telemetryKey, telemetryDistinctId)

			// kilocode_change start
			const memoryService = new MemoryService()
			memoryService.start()
			return () => memoryService.stop()
			// kilocode_change end
		}
	}, [telemetrySetting, telemetryKey, telemetryDistinctId, didHydrateState])
	// kilocode_change end

	// Tell the extension that we are ready to receive messages.
	useEffect(() => vscode.postMessage({ type: "webviewDidLaunch" }), [])

	// Initialize source map support for better error reporting
	useEffect(() => {
		// Initialize source maps for better error reporting in production
		initializeSourceMaps()

		// Expose source map debugging utilities in production
		if (process.env.NODE_ENV === "production") {
			exposeSourceMapsForDebugging()
		}

		// Log initialization for debugging
		console.debug("App initialized with source map support")
	}, [])

	// Focus the WebView when non-interactive content is clicked (only in editor/tab mode)
	useAddNonInteractiveClickListener(
		useCallback(() => {
			// Only send focus request if we're in editor (tab) mode, not sidebar
			if (renderContext === "editor") {
				vscode.postMessage({ type: "focusPanelRequest" })
			}
		}, [renderContext]),
	)
	// Track marketplace tab views
	useEffect(() => {
		if (tab === "marketplace") {
			telemetryClient.capture(TelemetryEventName.MARKETPLACE_TAB_VIEWED)
		}
	}, [tab])

	if (!didHydrateState) {
		return null
	}

	// Do not conditionally load ChatView, it's expensive and there's state we
	// don't want to lose (user input, disableInput, askResponse promise, etc.)
	// kilocode_change: no WelcomeViewProvider toggle
	return showWelcome ? (
		<WelcomeView />
	) : (
		<>
			{/* kilocode_change start */}
			<MemoryWarningBanner />
			{tab === "mcp" && <McpView onDone={() => switchTab("chat")} />}
			{/* kilocode_change end */}
			{tab === "history" && <HistoryView onDone={() => switchTab("chat")} />}
			{/* kilocode_change: auth redirect / editingProfile */}
			{tab === "settings" && (
				<SettingsView
					ref={settingsRef}
					onDone={() => switchTab("chat")}
					targetSection={currentSection}
					editingProfile={settingsEditingProfile}
				/>
			)}
			{/* kilocode_change: add profileview and authview */}
			{tab === "profile" && <ProfileView onDone={() => switchTab("chat")} />}
			{tab === "auth" && <AuthView returnTo={authReturnTo} profileName={authProfileName} />}
			{tab === "marketplace" && (
				<MarketplaceView
					stateManager={marketplaceStateManager}
					onDone={() => switchTab("chat")}
					// kilocode_change: targetTab="mode"
					targetTab="mode"
				/>
			)}
			{/* kilocode_change: no cloud view */}
			{/* {tab === "cloud" && (
				<CloudView
					userInfo={cloudUserInfo}
					isAuthenticated={cloudIsAuthenticated}
					cloudApiUrl={cloudApiUrl}
					organizations={cloudOrganizations}
				/>
			)} */}
			{/* kilocode_change: we have our own profile view */}
			{/* {tab === "account" && (
				<AccountView userInfo={cloudUserInfo} isAuthenticated={false} onDone={() => switchTab("chat")} />
			)} */}
			<ChatView
				ref={chatViewRef}
				isHidden={tab !== "chat"}
				showAnnouncement={showAnnouncement}
				hideAnnouncement={() => setShowAnnouncement(false)}
			/>
			<MemoizedHumanRelayDialog
				isOpen={humanRelayDialogState.isOpen}
				requestId={humanRelayDialogState.requestId}
				promptText={humanRelayDialogState.promptText}
				onClose={() => setHumanRelayDialogState((prev) => ({ ...prev, isOpen: false }))}
				onSubmit={(requestId, text) => vscode.postMessage({ type: "humanRelayResponse", requestId, text })}
				onCancel={(requestId) => vscode.postMessage({ type: "humanRelayCancel", requestId })}
			/>
			{deleteMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={deleteMessageDialogState.isOpen}
					type="delete"
					hasCheckpoint={deleteMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
							restoreCheckpoint,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedDeleteMessageDialog
					open={deleteMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
			{editMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={editMessageDialogState.isOpen}
					type="edit"
					hasCheckpoint={editMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							restoreCheckpoint,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedEditMessageDialog
					open={editMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							images: editMessageDialogState.images,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
			{/* kilocode_change */}
			{/* Chat, and history view contain their own bottom controls, settings doesn't need it */}
			{!["chat", "settings", "history"].includes(tab) && (
				<div className="fixed inset-0 top-auto">
					<BottomControls />
				</div>
			)}
		</>
	)
}

const queryClient = new QueryClient()

const AppWithProviders = () => (
	<ErrorBoundary>
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<QueryClientProvider client={queryClient}>
					<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
						<App />
					</TooltipProvider>
				</QueryClientProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>
	</ErrorBoundary>
)

export default AppWithProviders
