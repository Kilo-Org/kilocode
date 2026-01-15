import React, {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import {
	CheckCheck,
	SquareMousePointer,
	Webhook,
	GitBranch,
	Bell,
	Database,
	SquareTerminal,
	FlaskConical,
	AlertTriangle,
	Globe,
	Info,
	Bot, // kilocode_change
	MessageSquare,
	Monitor,
	LucideIcon,
	// SquareSlash, // kilocode_change
	// Glasses, // kilocode_change
	Plug,
	Server,
	Users2,
} from "lucide-react"

// kilocode_change
import { ensureBodyPointerEventsRestored } from "@/utils/fixPointerEvents"
import {
	type ProviderSettings,
	type ExperimentId,
	type TelemetrySetting,
	type ProfileType, // kilocode_change - autocomplete profile type system
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	ImageGenerationProvider,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ExtensionStateContextType, useExtensionState } from "@src/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
	AlertDialogAction,
	AlertDialogHeader,
	AlertDialogFooter,
	Button,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	StandardTooltip,
} from "@src/components/ui"

import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"
import { AutoApproveSettings } from "./AutoApproveSettings"
import { BrowserSettings } from "./BrowserSettings"
import { CheckpointSettings } from "./CheckpointSettings"
import { DisplaySettings } from "./DisplaySettings" // kilocode_change
import { NotificationSettings } from "./NotificationSettings"
import { ContextManagementSettings } from "./ContextManagementSettings"
import { TerminalSettings } from "./TerminalSettings"
import { ExperimentalSettings } from "./ExperimentalSettings"
import { LanguageSettings } from "./LanguageSettings"
import { About } from "./About"
import { Section } from "./Section"
import PromptsSettings from "./PromptsSettings"
import McpView from "../kilocodeMcp/McpView" // kilocode_change
import deepEqual from "fast-deep-equal" // kilocode_change
import { GhostServiceSettingsView } from "../kilocode/settings/GhostServiceSettings" // kilocode_change
import { SlashCommandsSettings } from "./SlashCommandsSettings"
import { UISettings } from "./UISettings"
import ModesView from "../modes/ModesView"
// import McpView from "../mcp/McpView" // kilocode_change: own view

export const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden"
export const settingsTabList =
	"w-48 data-[compact=true]:w-12 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-vscode-sideBar-background"
export const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center border-l-2 border-transparent text-vscode-foreground opacity-70 hover:bg-vscode-list-hoverBackground data-[compact=true]:w-12 data-[compact=true]:p-4 cursor-pointer" // kilocode_change add cursor-pointer
export const settingsTabTriggerActive =
	"opacity-100 border-vscode-focusBorder bg-vscode-list-activeSelectionBackground hover:bg-vscode-list-activeSelectionBackground cursor-default" // kilocode_change add hover:bg-* and cursor-default

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}
const sectionNames = [
	"providers",
	"autoApprove",
	"slashCommands",
	"browser",
	"checkpoints",
	"ghost", // kilocode_change
	"display", // kilocode_change
	"notifications",
	"contextManagement",
	"terminal",
	"modes",
	"mcp",
	"prompts",
	"ui",
	"experimental",
	"language",
	"mcp",
	"about",
] as const

type SectionName = (typeof sectionNames)[number] // kilocode_change

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
	editingProfile?: string // kilocode_change - profile to edit
}

// kilocode_change start - editingProfile
const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>((props, ref) => {
	const { onDone, targetSection, editingProfile } = props
	// kilocode_change end - editingProfile
	const { t } = useAppTranslation()

	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, settingsImportedAt } = extensionState

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [isChangeDetected, setChangeDetected] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [activeTab, setActiveTab] = useState<SectionName>(
		targetSection && sectionNames.includes(targetSection as SectionName)
			? (targetSection as SectionName)
			: "providers",
	)

	const [editingApiConfigName, setEditingApiConfigName] = useState<string>(currentApiConfigName || "default") // kilocode_change: Track which profile is being edited separately from the active profile

	const scrollPositions = useRef<Record<SectionName, number>>(
		Object.fromEntries(sectionNames.map((s) => [s, 0])) as Record<SectionName, number>,
	)
	const contentRef = useRef<HTMLDivElement | null>(null)

	const prevApiConfigName = useRef(currentApiConfigName)
	const confirmDialogHandler = useRef<() => void>()

	const [cachedState, setCachedState] = useState(() => extensionState)

	// kilocode_change begin
	useEffect(() => {
		ensureBodyPointerEventsRestored()
	}, [isDiscardDialogShow])
	// kilocode_change end

	const {
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		allowedCommands,
		deniedCommands,
		allowedMaxRequests,
		allowedMaxCost,
		language,
		alwaysAllowBrowser,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysAllowWriteProtected,
		autoCondenseContext,
		autoCondenseContextPercent,
		browserToolEnabled,
		browserViewportSize,
		enableCheckpoints,
		checkpointTimeout,
		diffEnabled,
		experiments,
		morphApiKey, // kilocode_change
		fastApplyModel, // kilocode_change: Fast Apply model selection
		fastApplyApiProvider, // kilocode_change: Fast Apply model api base url
		fuzzyMatchThreshold,
		maxOpenTabsContext,
		maxWorkspaceFiles,
		mcpEnabled,
		remoteBrowserHost,
		screenshotQuality,
		soundEnabled,
		ttsEnabled,
		ttsSpeed,
		soundVolume,
		telemetrySetting,
		terminalOutputLineLimit,
		terminalOutputCharacterLimit,
		terminalShellIntegrationTimeout,
		terminalShellIntegrationDisabled, // Added from upstream
		terminalCommandDelay,
		terminalPowershellCounter,
		terminalZshClearEolMark,
		terminalZshOhMy,
		terminalZshP10k,
		terminalZdotdir,
		writeDelayMs,
		showRooIgnoredFiles,
		enableSubfolderRules,
		remoteBrowserEnabled,
		maxReadFileLine,
		showAutoApproveMenu, // kilocode_change
		yoloMode, // kilocode_change
		showTaskTimeline, // kilocode_change
		sendMessageOnEnter, // kilocode_change
		showTimestamps, // kilocode_change
		hideCostBelowThreshold, // kilocode_change
		maxImageFileSize,
		maxTotalImageSize,
		terminalCompressProgressBar,
		maxConcurrentFileReads,
		allowVeryLargeReads, // kilocode_change
		terminalCommandApiConfigId, // kilocode_change
		condensingApiConfigId,
		customCondensingPrompt,
		yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
		customSupportPrompts,
		profileThresholds,
		systemNotificationsEnabled, // kilocode_change
		alwaysAllowFollowupQuestions,
		followupAutoApproveTimeoutMs,
		ghostServiceSettings, // kilocode_change
		// kilocode_change start - Auto-purge settings
		autoPurgeEnabled,
		autoPurgeDefaultRetentionDays,
		autoPurgeFavoritedTaskRetentionDays,
		autoPurgeCompletedTaskRetentionDays,
		autoPurgeIncompleteTaskRetentionDays,
		autoPurgeLastRunTimestamp,
		kiloCodeWrapperProperties,
		// kilocode_change end - Auto-purge settings
		includeDiagnosticMessages,
		maxDiagnosticMessages,
		includeTaskHistoryInEnhance,
		imageGenerationProvider,
		openRouterImageApiKey,
		kiloCodeImageApiKey,
		openRouterImageGenerationSelectedModel,
		reasoningBlockCollapsed,
		enterBehavior,
		includeCurrentTime,
		includeCurrentCost,
		maxGitStatusFiles,
	} = cachedState

	const apiConfiguration = useMemo(() => cachedState.apiConfiguration ?? {}, [cachedState.apiConfiguration])

	useEffect(() => {
		// Update only when currentApiConfigName is changed.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration.
		if (prevApiConfigName.current === currentApiConfigName) {
			return
		}

		setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
		prevApiConfigName.current = currentApiConfigName
		setChangeDetected(false)
		// kilocode_change start - Don't reset editingApiConfigName if we have an editingProfile prop (from auth return)
		if (!editingProfile) {
			setEditingApiConfigName(currentApiConfigName || "default")
		}
		// kilocode_change end
	}, [currentApiConfigName, extensionState, editingProfile]) // kilocode_change

	// kilocode_change start: Set editing profile when prop changes (from auth return)
	useEffect(() => {
		if (editingProfile) {
			console.log("[SettingsView] Setting editing profile from prop:", editingProfile)
			setEditingApiConfigName(editingProfile)
			isLoadingProfileForEditing.current = true
			vscode.postMessage({
				type: "getProfileConfigurationForEditing",
				text: editingProfile,
			})
		}
	}, [editingProfile])
	// kilocode_change end

	// kilocode_change start
	const isLoadingProfileForEditing = useRef(false)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "profileConfigurationForEditing" && message.text === editingApiConfigName) {
				// Update cached state with the editing profile's configuration
				setCachedState((prevState) => ({
					...prevState,
					apiConfiguration: message.apiConfiguration,
				}))
				setChangeDetected(false)
				isLoadingProfileForEditing.current = false
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [editingApiConfigName])

	// Temporary way of making sure that the Settings view updates its local state properly when receiving
	// api keys from providers that support url callbacks. This whole Settings View needs proper with this local state thing later
	const { kilocodeToken, openRouterApiKey, glamaApiKey, requestyApiKey } = extensionState.apiConfiguration ?? {}
	useEffect(() => {
		setCachedState((prevCachedState) => ({
			...prevCachedState,
			apiConfiguration: {
				...prevCachedState.apiConfiguration,
				// Only set specific tokens/keys instead of spreading the entire
				// `prevCachedState.apiConfiguration` since it may contain unsaved changes
				kilocodeToken,
				openRouterApiKey,
				glamaApiKey,
				requestyApiKey,
			},
		}))
	}, [kilocodeToken, openRouterApiKey, glamaApiKey, requestyApiKey])

	useEffect(() => {
		// Only update if we're not already detecting changes
		// This prevents overwriting user changes that haven't been saved yet
		// Also skip if we're loading a profile for editing
		if (!isChangeDetected && !isLoadingProfileForEditing.current) {
			// When editing a different profile than the active one,
			// don't overwrite apiConfiguration from extensionState since it contains
			// the active profile's config, not the editing profile's config
			if (editingApiConfigName !== currentApiConfigName) {
				// Sync everything except apiConfiguration
				const { apiConfiguration: _, ...restOfExtensionState } = extensionState
				setCachedState((prevState) => ({
					...prevState,
					...restOfExtensionState,
				}))
			} else {
				// When editing the active profile, sync everything including apiConfiguration
				setCachedState(extensionState)
			}
		}
	}, [extensionState, isChangeDetected, editingApiConfigName, currentApiConfigName])
	// kilocode_change end

	// Bust the cache when settings are imported.
	useEffect(() => {
		if (settingsImportedAt) {
			setCachedState((prevCachedState) => ({ ...prevCachedState, ...extensionState }))
			setChangeDetected(false)
		}
	}, [settingsImportedAt, extensionState])

	const setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType> = useCallback((field, value) => {
		setCachedState((prevState) => {
			// kilocode_change start
			if (deepEqual(prevState[field], value)) {
				return prevState
			}
			// kilocode_change end

			setChangeDetected(true)
			return { ...prevState, [field]: value }
		})
	}, [])

	// kilocode_change start
	const setGhostServiceSettingsField = useCallback(
		<K extends keyof NonNullable<ExtensionStateContextType["ghostServiceSettings"]>>(
			field: K,
			value: NonNullable<ExtensionStateContextType["ghostServiceSettings"]>[K],
		) => {
			setCachedState((prevState) => {
				const currentSettings = prevState.ghostServiceSettings || {}
				if (currentSettings[field] === value) {
					return prevState
				}

				setChangeDetected(true)
				return {
					...prevState,
					ghostServiceSettings: {
						...currentSettings,
						[field]: value,
					},
				}
			})
		},
		[],
	)
	// kilocode_change end

	const setApiConfigurationField = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction: boolean = true) => {
			setCachedState((prevState) => {
				if (prevState.apiConfiguration?.[field] === value) {
					return prevState
				}

				const previousValue = prevState.apiConfiguration?.[field]

				// Only skip change detection for automatic initialization (not user actions)
				// This prevents the dirty state when the component initializes and auto-syncs values
				// Treat undefined, null, and empty string as uninitialized states
				const isInitialSync =
					!isUserAction &&
					(previousValue === undefined || previousValue === "" || previousValue === null) &&
					value !== undefined &&
					value !== "" &&
					value !== null

				if (!isInitialSync) {
					setChangeDetected(true)
				}
				return { ...prevState, apiConfiguration: { ...prevState.apiConfiguration, [field]: value } }
			})
		},
		[],
	)

	const setExperimentEnabled: SetExperimentEnabled = useCallback((id: ExperimentId, enabled: boolean) => {
		setCachedState((prevState) => {
			if (prevState.experiments?.[id] === enabled) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, experiments: { ...prevState.experiments, [id]: enabled } }
		})
	}, [])

	const setTelemetrySetting = useCallback((setting: TelemetrySetting) => {
		setCachedState((prevState) => {
			if (prevState.telemetrySetting === setting) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, telemetrySetting: setting }
		})
	}, [])

	const setImageGenerationProvider = useCallback((provider: ImageGenerationProvider) => {
		setCachedState((prevState) => {
			if (prevState.imageGenerationProvider !== provider) {
				setChangeDetected(true)
			}

			return { ...prevState, imageGenerationProvider: provider }
		})
	}, [])

	const setOpenRouterImageApiKey = useCallback((apiKey: string) => {
		setCachedState((prevState) => {
			if (prevState.openRouterImageApiKey !== apiKey) {
				setChangeDetected(true)
			}

			return { ...prevState, openRouterImageApiKey: apiKey }
		})
	}, [])

	const setKiloCodeImageApiKey = useCallback((apiKey: string) => {
		setCachedState((prevState) => {
			setChangeDetected(true)
			return { ...prevState, kiloCodeImageApiKey: apiKey }
		})
	}, [])

	const setImageGenerationSelectedModel = useCallback((model: string) => {
		setCachedState((prevState) => {
			if (prevState.openRouterImageGenerationSelectedModel !== model) {
				setChangeDetected(true)
			}

			return { ...prevState, openRouterImageGenerationSelectedModel: model }
		})
	}, [])

	const setCustomSupportPromptsField = useCallback((prompts: Record<string, string | undefined>) => {
		setCachedState((prevState) => {
			const previousStr = JSON.stringify(prevState.customSupportPrompts)
			const newStr = JSON.stringify(prompts)

			if (previousStr === newStr) {
				return prevState
			}

			setChangeDetected(true)
			return { ...prevState, customSupportPrompts: prompts }
		})
	}, [])

	const isSettingValid = !errorMessage

	const handleSubmit = () => {
		if (isSettingValid) {
			vscode.postMessage({
				type: "updateSettings",
				updatedSettings: {
					language,
					alwaysAllowReadOnly: alwaysAllowReadOnly ?? undefined,
					alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? undefined,
					alwaysAllowWrite: alwaysAllowWrite ?? undefined,
					alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? undefined,
					alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? undefined,
					alwaysAllowExecute: alwaysAllowExecute ?? undefined,
					alwaysAllowBrowser: alwaysAllowBrowser ?? undefined,
					alwaysAllowMcp,
					alwaysAllowModeSwitch,
					allowedCommands: allowedCommands ?? [],
					deniedCommands: deniedCommands ?? [],
					// Note that we use `null` instead of `undefined` since `JSON.stringify`
					// will omit `undefined` when serializing the object and passing it to the
					// extension host. We may need to do the same for other nullable fields.
					allowedMaxRequests: allowedMaxRequests ?? null,
					allowedMaxCost: allowedMaxCost ?? null,
					autoCondenseContext,
					autoCondenseContextPercent,
					browserToolEnabled: browserToolEnabled ?? true,
					soundEnabled: soundEnabled ?? true,
					soundVolume: soundVolume ?? 0.5,
					ttsEnabled,
					ttsSpeed,
					diffEnabled: diffEnabled ?? true,
					enableCheckpoints: enableCheckpoints ?? false,
					checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
					browserViewportSize: browserViewportSize ?? "900x600",
					remoteBrowserHost: remoteBrowserEnabled ? remoteBrowserHost : undefined,
					remoteBrowserEnabled: remoteBrowserEnabled ?? false,
					fuzzyMatchThreshold: fuzzyMatchThreshold ?? 1.0,
					writeDelayMs,
					screenshotQuality: screenshotQuality ?? 75,
					terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
					terminalOutputCharacterLimit: terminalOutputCharacterLimit ?? 50_000,
					terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? 30_000,
					terminalShellIntegrationDisabled,
					terminalCommandDelay,
					terminalPowershellCounter,
					terminalZshClearEolMark,
					terminalZshOhMy,
					terminalZshP10k,
					terminalZdotdir,
					terminalCompressProgressBar,
					mcpEnabled,
					maxOpenTabsContext: Math.min(Math.max(0, maxOpenTabsContext ?? 20), 500),
					maxWorkspaceFiles: Math.min(Math.max(0, maxWorkspaceFiles ?? 200), 500),
					showRooIgnoredFiles: showRooIgnoredFiles ?? true,
					enableSubfolderRules: enableSubfolderRules ?? false,
					maxReadFileLine: maxReadFileLine ?? -1,
					maxImageFileSize: maxImageFileSize ?? 5,
					maxTotalImageSize: maxTotalImageSize ?? 20,
					maxConcurrentFileReads: cachedState.maxConcurrentFileReads ?? 5,
					includeDiagnosticMessages:
						includeDiagnosticMessages !== undefined ? includeDiagnosticMessages : true,
					maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
					alwaysAllowSubtasks,
					alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
					followupAutoApproveTimeoutMs,
					condensingApiConfigId: condensingApiConfigId || "",
					includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
					reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
					enterBehavior: enterBehavior ?? "send",
					includeCurrentTime: includeCurrentTime ?? true,
					includeCurrentCost: includeCurrentCost ?? true,
					maxGitStatusFiles: maxGitStatusFiles ?? 0,
					profileThresholds,
					imageGenerationProvider,
					openRouterImageApiKey,
					openRouterImageGenerationSelectedModel,
					experiments,
					customSupportPrompts,
				},
			})
			vscode.postMessage({ type: "ttsEnabled", bool: ttsEnabled })
			vscode.postMessage({ type: "ttsSpeed", value: ttsSpeed })
			vscode.postMessage({ type: "terminalCommandApiConfigId", text: terminalCommandApiConfigId || "" }) // kilocode_change
			vscode.postMessage({ type: "showAutoApproveMenu", bool: showAutoApproveMenu }) // kilocode_change
			vscode.postMessage({ type: "yoloMode", bool: yoloMode }) // kilocode_change
			vscode.postMessage({ type: "allowVeryLargeReads", bool: allowVeryLargeReads }) // kilocode_change
			vscode.postMessage({ type: "currentApiConfigName", text: currentApiConfigName })
			vscode.postMessage({ type: "showTaskTimeline", bool: showTaskTimeline }) // kilocode_change
			vscode.postMessage({ type: "sendMessageOnEnter", bool: sendMessageOnEnter }) // kilocode_change
			vscode.postMessage({ type: "showTimestamps", bool: showTimestamps }) // kilocode_change
			vscode.postMessage({ type: "hideCostBelowThreshold", value: hideCostBelowThreshold }) // kilocode_change
			vscode.postMessage({ type: "updateCondensingPrompt", text: customCondensingPrompt || "" })
			vscode.postMessage({ type: "yoloGatekeeperApiConfigId", text: yoloGatekeeperApiConfigId || "" }) // kilocode_change: AI gatekeeper for YOLO mode
			vscode.postMessage({ type: "setReasoningBlockCollapsed", bool: reasoningBlockCollapsed ?? true })
			vscode.postMessage({ type: "upsertApiConfiguration", text: editingApiConfigName, apiConfiguration }) // kilocode_change: Save to editing profile instead of current active profile
			vscode.postMessage({ type: "telemetrySetting", text: telemetrySetting })
			vscode.postMessage({ type: "systemNotificationsEnabled", bool: systemNotificationsEnabled }) // kilocode_change
			vscode.postMessage({ type: "ghostServiceSettings", values: ghostServiceSettings }) // kilocode_change
			vscode.postMessage({ type: "morphApiKey", text: morphApiKey }) // kilocode_change
			vscode.postMessage({ type: "fastApplyModel", text: fastApplyModel }) // kilocode_change: Fast Apply model selection
			vscode.postMessage({ type: "fastApplyApiProvider", text: fastApplyApiProvider }) // kilocode_change: Fast Apply model api base url
			vscode.postMessage({ type: "kiloCodeImageApiKey", text: kiloCodeImageApiKey })
			// kilocode_change start - Auto-purge settings
			vscode.postMessage({ type: "autoPurgeEnabled", bool: autoPurgeEnabled })
			vscode.postMessage({ type: "autoPurgeDefaultRetentionDays", value: autoPurgeDefaultRetentionDays })
			vscode.postMessage({
				type: "autoPurgeFavoritedTaskRetentionDays",
				value: autoPurgeFavoritedTaskRetentionDays ?? undefined,
			})
			vscode.postMessage({
				type: "autoPurgeCompletedTaskRetentionDays",
				value: autoPurgeCompletedTaskRetentionDays,
			})
			vscode.postMessage({
				type: "autoPurgeIncompleteTaskRetentionDays",
				value: autoPurgeIncompleteTaskRetentionDays,
			})
			// kilocode_change end - Auto-purge settings

			// kilocode_change: After saving, sync cachedState to extensionState without clobbering
			// the editing profile's apiConfiguration when editing a non-active profile.
			if (editingApiConfigName !== currentApiConfigName) {
				// Only sync non-apiConfiguration fields from extensionState
				const { apiConfiguration: _, ...restOfExtensionState } = extensionState
				setCachedState((prevState) => ({
					...prevState,
					...restOfExtensionState,
				}))
			} else {
				// When editing the active profile, sync everything including apiConfiguration
				setCachedState((prevState) => ({ ...prevState, ...extensionState }))
			}
			// kilocode_change end
			setChangeDetected(false)
		}
	}

	const checkUnsaveChanges = useCallback(
		(then: () => void) => {
			if (isChangeDetected) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[isChangeDetected],
	)

	useImperativeHandle(ref, () => ({ checkUnsaveChanges }), [checkUnsaveChanges])

	// kilocode_change start
	const onConfirmDialogResult = useCallback(
		(confirm: boolean) => {
			if (confirm) {
				// Discard changes: Reset state and flag
				setCachedState(extensionState) // Revert to original state
				setChangeDetected(false) // Reset change flag
				confirmDialogHandler.current?.() // Execute the pending action (e.g., tab switch)
			}
			// If confirm is false (Cancel), do nothing, dialog closes automatically
		},
		[setCachedState, setChangeDetected, extensionState], // Depend on extensionState to get the latest original state
	)

	// From time to time there's a bug that triggers unsaved changes upon rendering the SettingsView
	// This is a (nasty) workaround to detect when this happens, and to force overwrite the unsaved changes
	const renderStart = useRef<null | number>()
	useEffect(() => {
		renderStart.current = performance.now()
	}, [])
	useEffect(() => {
		if (renderStart.current && process.env.NODE_ENV !== "test") {
			const renderEnd = performance.now()
			const renderTime = renderEnd - renderStart.current

			if (renderTime < 100 && isChangeDetected) {
				console.info("Overwriting unsaved changes in less than 100ms")
				onConfirmDialogResult(true)
			}
		}
	}, [isChangeDetected, onConfirmDialogResult])
	// kilocode_change end

	// Handle tab changes with unsaved changes check
	const handleTabChange = useCallback(
		(newTab: SectionName) => {
			if (contentRef.current) {
				scrollPositions.current[activeTab] = contentRef.current.scrollTop
			}
			setActiveTab(newTab)
		},
		[activeTab],
	)

	useLayoutEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = scrollPositions.current[activeTab] ?? 0
		}
	}, [activeTab])

	// Store direct DOM element refs for each tab
	const tabRefs = useRef<Record<SectionName, HTMLButtonElement | null>>(
		Object.fromEntries(sectionNames.map((name) => [name, null])) as Record<SectionName, HTMLButtonElement | null>,
	)

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	const sections: { id: SectionName; icon: LucideIcon }[] = useMemo(
		() => [
			{ id: "providers", icon: Plug },
			{ id: "modes", icon: Users2 },
			{ id: "autoApprove", icon: CheckCheck },
			// { id: "slashCommands", icon: SquareSlash }, // kilocode_change: needs work to be re-introduced
			{ id: "browser", icon: SquareMousePointer },
			{ id: "checkpoints", icon: GitBranch },
			{ id: "display", icon: Monitor }, // kilocode_change
			{ id: "ghost" as const, icon: Bot }, // kilocode_change
			{ id: "notifications", icon: Bell },
			{ id: "contextManagement", icon: Database },
			{ id: "terminal", icon: SquareTerminal },
			{ id: "prompts", icon: MessageSquare },
			// { id: "ui", icon: Glasses }, // kilocode_change: we have our own display section
			{ id: "experimental", icon: FlaskConical },
			{ id: "language", icon: Globe },
			{ id: "mcp", icon: Server },
			{ id: "about", icon: Info },
		],
		[], // kilocode_change
	)
	// Update target section logic to set active tab
	useEffect(() => {
		if (targetSection && sectionNames.includes(targetSection as SectionName)) {
			setActiveTab(targetSection as SectionName)
		}
	}, [targetSection]) // kilocode_change

	// kilocode_change start - Listen for messages to restore editing profile after auth
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (
				message.type === "action" &&
				message.action === "settingsButtonClicked" &&
				message.values?.editingProfile
			) {
				const profileToEdit = message.values.editingProfile as string
				console.log("[SettingsView] Restoring editing profile:", profileToEdit)
				setEditingApiConfigName(profileToEdit)
				// Request the profile's configuration for editing
				isLoadingProfileForEditing.current = true
				vscode.postMessage({
					type: "getProfileConfigurationForEditing",
					text: profileToEdit,
				})
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])
	// kilocode_change end

	// Function to scroll the active tab into view for vertical layout
	const scrollToActiveTab = useCallback(() => {
		const activeTabElement = tabRefs.current[activeTab]

		if (activeTabElement) {
			activeTabElement.scrollIntoView({
				behavior: "auto",
				block: "nearest",
			})
		}
	}, [activeTab])

	// Effect to scroll when the active tab changes
	useEffect(() => {
		scrollToActiveTab()
	}, [activeTab, scrollToActiveTab])

	// Effect to scroll when the webview becomes visible
	useLayoutEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "action" && message.action === "didBecomeVisible") {
				scrollToActiveTab()
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [scrollToActiveTab])

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-vscode-foreground m-0">{t("settings:header.title")}</h3>
				</div>
				<div className="flex gap-2">
					<StandardTooltip
						content={
							!isSettingValid
								? errorMessage
								: isChangeDetected
									? t("settings:header.saveButtonTooltip")
									: t("settings:header.nothingChangedTooltip")
						}>
						<Button
							variant={isSettingValid ? "primary" : "secondary"}
							className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
							onClick={handleSubmit}
							disabled={!isChangeDetected || !isSettingValid}
							data-testid="save-button">
							{t("settings:common.save")}
						</Button>
					</StandardTooltip>
					<StandardTooltip content={t("settings:header.doneButtonTooltip")}>
						<Button variant="secondary" onClick={() => checkUnsaveChanges(onDone)}>
							{t("settings:common.done")}
						</Button>
					</StandardTooltip>
				</div>
			</TabHeader>

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={(value) => handleTabChange(value as SectionName)}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}
					data-testid="settings-tab-list">
					{sections.map(({ id, icon: Icon }) => {
						const isSelected = id === activeTab
						const onSelect = () => handleTabChange(id)

						// Base TabTrigger component definition
						// We pass isSelected manually for styling, but onSelect is handled conditionally
						const triggerComponent = (
							<TabTrigger
								ref={(element) => (tabRefs.current[id] = element)}
								value={id}
								isSelected={isSelected} // Pass manually for styling state
								className={cn(
									isSelected // Use manual isSelected for styling
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"cursor-pointer focus:ring-0", // Remove the focus ring styling
								)}
								data-testid={`tab-${id}`}
								data-compact={isCompactMode}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<Icon className="w-4 h-4" />
									<span className="tab-label">
										{id === "mcp"
											? t(`kilocode:settings.sections.mcp`)
											: id === "ghost"
												? t(`kilocode:ghost.title`)
												: t(`settings:sections.${id}`)}
									</span>
								</div>
							</TabTrigger>
						)

						if (isCompactMode) {
							// Wrap in Tooltip and manually add onClick to the trigger
							return (
								<TooltipProvider key={id} delayDuration={300}>
									<Tooltip>
										<TooltipTrigger asChild onClick={onSelect}>
											{/* Clone to avoid ref issues if triggerComponent itself had a key */}
											{React.cloneElement(triggerComponent)}
										</TooltipTrigger>
										<TooltipContent side="right" className="text-base">
											<p className="m-0">
												{id === "mcp"
													? t(`kilocode:settings.sections.mcp`)
													: id === "ghost"
														? t(`kilocode:ghost.title`)
														: t(`settings:sections.${id}`)}
											</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)
						} else {
							// Render trigger directly; TabList will inject onSelect via cloning
							// Ensure the element passed to TabList has the key
							return React.cloneElement(triggerComponent, { key: id })
						}
					})}
				</TabList>

				{/* Content area */}
				<TabContent ref={contentRef} className="p-0 flex-1 overflow-auto">
					{/* Providers Section */}
					{activeTab === "providers" && (
						<div>
							<SectionHeader>
								<div className="flex items-center gap-2">
									<Webhook className="w-4" />
									<div>{t("settings:sections.providers")}</div>
								</div>
							</SectionHeader>

							<Section>
								{/* kilocode_change start changes to allow for editting a non-active profile */}
								<ApiConfigManager
									currentApiConfigName={editingApiConfigName}
									activeApiConfigName={currentApiConfigName}
									listApiConfigMeta={listApiConfigMeta}
									onSelectConfig={(configName: string) => {
										checkUnsaveChanges(() => {
											setEditingApiConfigName(configName)
											// Set flag to prevent extensionState sync while loading
											isLoadingProfileForEditing.current = true
											// Request the profile's configuration for editing
											vscode.postMessage({
												type: "getProfileConfigurationForEditing",
												text: configName,
											})
										})
									}}
									onActivateConfig={(configName: string) => {
										vscode.postMessage({ type: "loadApiConfiguration", text: configName })
									}}
									onDeleteConfig={(configName: string) => {
										const isEditingProfile = configName === editingApiConfigName

										vscode.postMessage({ type: "deleteApiConfiguration", text: configName })

										// If deleting the editing profile, switch to another for editing
										if (isEditingProfile && listApiConfigMeta && listApiConfigMeta.length > 1) {
											const nextProfile = listApiConfigMeta.find((p) => p.name !== configName)
											if (nextProfile) {
												setEditingApiConfigName(nextProfile.name)
											}
										}
									}}
									onRenameConfig={(oldName: string, newName: string) => {
										vscode.postMessage({
											type: "renameApiConfiguration",
											values: { oldName, newName },
											apiConfiguration,
										})
										if (oldName === editingApiConfigName) {
											setEditingApiConfigName(newName)
										}
										// Update prevApiConfigName if renaming the active profile
										if (oldName === currentApiConfigName) {
											prevApiConfigName.current = newName
										}
									}}
									// kilocode_change start - autocomplete profile type system
									onUpsertConfig={(configName: string, profileType?: ProfileType) => {
										vscode.postMessage({
											type: "upsertApiConfiguration",
											text: configName,
											apiConfiguration: {
												...apiConfiguration,
												profileType: profileType || "chat",
											},
										})
										setEditingApiConfigName(configName)
									}}
								/>
								{/* kilocode_change end changes to allow for editting a non-active profile */}

								{/* kilocode_change start - pass editing profile name */}
								<ApiOptions
									uriScheme={uriScheme}
									apiConfiguration={apiConfiguration}
									setApiConfigurationField={setApiConfigurationField}
									errorMessage={errorMessage}
									setErrorMessage={setErrorMessage}
									currentApiConfigName={editingApiConfigName}
								/>
								{/* kilocode_change end - pass editing profile name */}
							</Section>
						</div>
					)}

					{/* Auto-Approve Section */}
					{activeTab === "autoApprove" && (
						<AutoApproveSettings
							showAutoApproveMenu={showAutoApproveMenu} // kilocode_change
							yoloMode={yoloMode} // kilocode_change
							yoloGatekeeperApiConfigId={yoloGatekeeperApiConfigId} // kilocode_change: AI gatekeeper for YOLO mode
							alwaysAllowReadOnly={alwaysAllowReadOnly}
							alwaysAllowReadOnlyOutsideWorkspace={alwaysAllowReadOnlyOutsideWorkspace}
							alwaysAllowWrite={alwaysAllowWrite}
							alwaysAllowWriteOutsideWorkspace={alwaysAllowWriteOutsideWorkspace}
							alwaysAllowWriteProtected={alwaysAllowWriteProtected}
							alwaysAllowBrowser={alwaysAllowBrowser}
							alwaysAllowMcp={alwaysAllowMcp}
							alwaysAllowModeSwitch={alwaysAllowModeSwitch}
							alwaysAllowSubtasks={alwaysAllowSubtasks}
							alwaysAllowExecute={alwaysAllowExecute}
							alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
							followupAutoApproveTimeoutMs={followupAutoApproveTimeoutMs}
							allowedCommands={allowedCommands}
							allowedMaxRequests={allowedMaxRequests ?? undefined}
							allowedMaxCost={allowedMaxCost ?? undefined}
							deniedCommands={deniedCommands}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Slash Commands Section */}
					{activeTab === "slashCommands" && <SlashCommandsSettings />}

					{/* Browser Section */}
					{activeTab === "browser" && (
						<BrowserSettings
							browserToolEnabled={browserToolEnabled}
							browserViewportSize={browserViewportSize}
							screenshotQuality={screenshotQuality}
							remoteBrowserHost={remoteBrowserHost}
							remoteBrowserEnabled={remoteBrowserEnabled}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Checkpoints Section */}
					{activeTab === "checkpoints" && (
						<CheckpointSettings
							enableCheckpoints={enableCheckpoints}
							checkpointTimeout={checkpointTimeout}
							setCachedStateField={setCachedStateField}
							// kilocode_change start
							autoPurgeEnabled={autoPurgeEnabled}
							autoPurgeDefaultRetentionDays={autoPurgeDefaultRetentionDays}
							autoPurgeFavoritedTaskRetentionDays={autoPurgeFavoritedTaskRetentionDays}
							autoPurgeCompletedTaskRetentionDays={autoPurgeCompletedTaskRetentionDays}
							autoPurgeIncompleteTaskRetentionDays={autoPurgeIncompleteTaskRetentionDays}
							autoPurgeLastRunTimestamp={autoPurgeLastRunTimestamp}
							onManualPurge={() => {
								vscode.postMessage({ type: "manualPurge" })
							}}
							// kilocode_change end
						/>
					)}

					{/* kilocode_change start display section */}
					{activeTab === "display" && (
						<DisplaySettings
							reasoningBlockCollapsed={reasoningBlockCollapsed ?? true}
							showTaskTimeline={showTaskTimeline}
							sendMessageOnEnter={sendMessageOnEnter}
							showTimestamps={cachedState.showTimestamps} // kilocode_change
							hideCostBelowThreshold={hideCostBelowThreshold}
							setCachedStateField={setCachedStateField}
						/>
					)}
					{activeTab === "ghost" && (
						<GhostServiceSettingsView
							ghostServiceSettings={ghostServiceSettings}
							onGhostServiceSettingsChange={setGhostServiceSettingsField}
						/>
					)}
					{/* kilocode_change end display section */}

					{/* Notifications Section */}
					{activeTab === "notifications" && (
						<NotificationSettings
							ttsEnabled={ttsEnabled}
							ttsSpeed={ttsSpeed}
							soundEnabled={soundEnabled}
							soundVolume={soundVolume}
							systemNotificationsEnabled={systemNotificationsEnabled}
							areSettingsCommitted={!isChangeDetected}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Context Management Section */}
					{activeTab === "contextManagement" && (
						<ContextManagementSettings
							autoCondenseContext={autoCondenseContext}
							autoCondenseContextPercent={autoCondenseContextPercent}
							listApiConfigMeta={listApiConfigMeta ?? []}
							maxOpenTabsContext={maxOpenTabsContext}
							maxWorkspaceFiles={maxWorkspaceFiles ?? 200}
							showRooIgnoredFiles={showRooIgnoredFiles}
							enableSubfolderRules={enableSubfolderRules}
							maxReadFileLine={maxReadFileLine}
							maxImageFileSize={maxImageFileSize}
							maxTotalImageSize={maxTotalImageSize}
							maxConcurrentFileReads={maxConcurrentFileReads}
							allowVeryLargeReads={allowVeryLargeReads /* kilocode_change */}
							profileThresholds={profileThresholds}
							includeDiagnosticMessages={includeDiagnosticMessages}
							maxDiagnosticMessages={maxDiagnosticMessages}
							writeDelayMs={writeDelayMs}
							includeCurrentTime={includeCurrentTime}
							includeCurrentCost={includeCurrentCost}
							maxGitStatusFiles={maxGitStatusFiles}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Terminal Section */}
					{activeTab === "terminal" && (
						<TerminalSettings
							terminalOutputLineLimit={terminalOutputLineLimit}
							terminalOutputCharacterLimit={terminalOutputCharacterLimit}
							terminalShellIntegrationTimeout={terminalShellIntegrationTimeout}
							terminalShellIntegrationDisabled={terminalShellIntegrationDisabled}
							terminalCommandDelay={terminalCommandDelay}
							terminalPowershellCounter={terminalPowershellCounter}
							terminalZshClearEolMark={terminalZshClearEolMark}
							terminalZshOhMy={terminalZshOhMy}
							terminalZshP10k={terminalZshP10k}
							terminalZdotdir={terminalZdotdir}
							terminalCompressProgressBar={terminalCompressProgressBar}
							terminalCommandApiConfigId={terminalCommandApiConfigId} // kilocode_change
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Modes Section */}
					{activeTab === "modes" && <ModesView />}

					{/* MCP Section */}
					{activeTab === "mcp" && <McpView />}

					{/* Prompts Section */}
					{activeTab === "prompts" && (
						<PromptsSettings
							customSupportPrompts={customSupportPrompts || {}}
							setCustomSupportPrompts={setCustomSupportPromptsField}
							includeTaskHistoryInEnhance={includeTaskHistoryInEnhance}
							setIncludeTaskHistoryInEnhance={(value) =>
								setCachedStateField("includeTaskHistoryInEnhance", value)
							}
						/>
					)}

					{/* UI Section */}
					{activeTab === "ui" && (
						<UISettings
							reasoningBlockCollapsed={reasoningBlockCollapsed ?? true}
							enterBehavior={enterBehavior ?? "send"}
							setCachedStateField={setCachedStateField}
						/>
					)}

					{/* Experimental Section */}
					{activeTab === "experimental" && (
						<ExperimentalSettings
							setExperimentEnabled={setExperimentEnabled}
							experiments={experiments}
							// kilocode_change start
							setCachedStateField={setCachedStateField}
							morphApiKey={morphApiKey}
							fastApplyModel={fastApplyModel}
							fastApplyApiProvider={fastApplyApiProvider}
							// kilocode_change end
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							imageGenerationProvider={imageGenerationProvider}
							openRouterImageApiKey={openRouterImageApiKey as string | undefined}
							kiloCodeImageApiKey={kiloCodeImageApiKey}
							openRouterImageGenerationSelectedModel={
								openRouterImageGenerationSelectedModel as string | undefined
							}
							setImageGenerationProvider={setImageGenerationProvider}
							setOpenRouterImageApiKey={setOpenRouterImageApiKey}
							setKiloCodeImageApiKey={setKiloCodeImageApiKey}
							setImageGenerationSelectedModel={setImageGenerationSelectedModel}
							currentProfileKilocodeToken={apiConfiguration.kilocodeToken}
						/>
					)}

					{/* Language Section */}
					{activeTab === "language" && (
						<LanguageSettings language={language || "en"} setCachedStateField={setCachedStateField} />
					)}

					{/* About Section */}
					{activeTab === "about" && (
						<About
							telemetrySetting={telemetrySetting}
							setTelemetrySetting={setTelemetrySetting}
							isVsCode={kiloCodeWrapperProperties?.kiloCodeWrapped !== true /*kilocode_change*/}
						/>
					)}
				</TabContent>
			</div>

			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<AlertTriangle className="w-5 h-5 text-yellow-500" />
							{t("settings:unsavedChangesDialog.title")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:unsavedChangesDialog.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>
							{t("settings:unsavedChangesDialog.cancelButton")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>
							{t("settings:unsavedChangesDialog.discardButton")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Tab>
	)
})

export default memo(SettingsView)
