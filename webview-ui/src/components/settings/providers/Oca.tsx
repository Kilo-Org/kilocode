import * as React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@src/utils/vscode"

import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"
import type { RouterModels } from "@roo/api"

import { ModelPicker } from "../ModelPicker"
import OcaAcknowledgeModal from "../../kilocode/common/OcaAcknowledgeModal"

// OCA webview messaging constants and types
const MSG = {
	SHOW_AUTH_URL: "oca/show-auth-url",
	LOGIN_SUCCESS: "oca/login-success",
	LOGIN_ERROR: "oca/login-error",
	LOGOUT_SUCCESS: "oca/logout-success",
	STATUS: "oca/status",
} as const
type OcaWebviewMessage =
	| { type: typeof MSG.SHOW_AUTH_URL; url: string }
	| { type: typeof MSG.LOGIN_SUCCESS }
	| { type: typeof MSG.LOGIN_ERROR; error?: string }
	| { type: typeof MSG.LOGOUT_SUCCESS }
	| { type: typeof MSG.STATUS; authenticated?: boolean }

const OCA_STATE_KEY = "ocaActivated" as const

type OCAProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	routerModels?: RouterModels
	routerModelsLoading?: boolean
	refetchRouterModels?: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export function OCA({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	routerModelsLoading,
	refetchRouterModels,
	organizationAllowList,
	modelValidationError,
}: OCAProps) {
	const [authUrl, setAuthUrl] = React.useState<string | null>(null)
	const [status, setStatus] = React.useState<"idle" | "waiting" | "done" | "error">("idle")
	const [error, setError] = React.useState<string | null>(null)
	const [ackOpen, setAckOpen] = React.useState(false)
	const [pendingModelId, setPendingModelId] = React.useState<string | null>(null)
	const [activated, setActivated] = React.useState<boolean>(() =>
		Boolean(((vscode.getState() as any) || {})[OCA_STATE_KEY]),
	)

	const ocaModels = React.useMemo(() => routerModels?.oca ?? {}, [routerModels?.oca])
	const defaultModelId = React.useMemo(() => {
		// Prefer the currently selected model if present, otherwise first available model
		return apiConfiguration.apiModelId || Object.keys(ocaModels)[0] || ""
	}, [apiConfiguration.apiModelId, ocaModels])

	const requestOcaModels = React.useCallback(() => {
		// Ask extension to fetch router models; backend will include OCA when apiProvider === "oca"
		vscode.postMessage({ type: "requestRouterModels" })
		// Also trigger the hook refetch if provided
		if (typeof refetchRouterModels === "function") {
			refetchRouterModels()
		}
	}, [refetchRouterModels])

	// Keep stable references to avoid re-binding the event listener unnecessarily
	const activatedRef = React.useRef(activated)
	React.useEffect(() => {
		activatedRef.current = activated
	}, [activated])

	const requestOcaModelsRef = React.useRef(requestOcaModels)
	React.useEffect(() => {
		requestOcaModelsRef.current = requestOcaModels
	}, [requestOcaModels])

	React.useEffect(() => {
		const h = (ev: MessageEvent) => {
			const m = ev.data as OcaWebviewMessage
			switch (m?.type) {
				case MSG.SHOW_AUTH_URL:
					setAuthUrl((m as any).url || null)
					setStatus("waiting")
					break
				case MSG.LOGIN_SUCCESS:
					setError(null)
					setActivated(true)
					setStatus("done")
					requestOcaModelsRef.current?.()
					break
				case MSG.LOGIN_ERROR:
					setStatus("error")
					setError((m as any).error ?? "Login failed")
					break
				case MSG.LOGOUT_SUCCESS:
					setStatus("idle")
					setAuthUrl(null)
					setError(null)
					setActivated(false)
					break
				case MSG.STATUS:
					if (activatedRef.current && (m as any).authenticated) {
						setStatus("done")
					} else if (!activatedRef.current) {
						setStatus("idle")
					}
					break
			}
		}
		window.addEventListener("message", h)
		return () => window.removeEventListener("message", h)
	}, [])

	// On mount, passively check OCA auth status so returning users see correct state.
	// This does not initiate interactive auth or fetch models.
	React.useEffect(() => {
		vscode.postMessage({ type: "oca/status" })
	}, [])

	// Initialize UI based on persisted activation; do not auto-advance unless previously activated
	React.useEffect(() => {
		setAuthUrl(null)
		setError(null)
		if (activated) {
			setStatus("done")
			// User previously clicked Sign in in this settings view; it's okay to fetch models now
			requestOcaModels()
		} else {
			setStatus("idle")
		}
	}, [activated, requestOcaModels])

	// Persist activation flag across settings panel mounts
	React.useEffect(() => {
		const prev = (vscode.getState() as any) || {}
		vscode.setState({ ...prev, [OCA_STATE_KEY]: activated })
	}, [activated])

	const bannerHtml = pendingModelId ? (ocaModels as any)?.[pendingModelId]?.banner : undefined

	const wrappedSetApiConfigurationField = React.useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction?: boolean) => {
			// Only gate user-triggered changes to the OCA model
			if (field === "apiModelId" && isUserAction !== false && typeof value === "string") {
				const banner = (ocaModels as any)?.[value as string]?.banner
				if (banner) {
					setPendingModelId(value as string)
					setAckOpen(true)
					return
				}
			}
			setApiConfigurationField(field, value, isUserAction)
		},
		[setApiConfigurationField, ocaModels],
	)

	const handleAcknowledge = React.useCallback(() => {
		if (pendingModelId) {
			// Confirm model selection after acknowledgement
			setApiConfigurationField("apiModelId", pendingModelId as any, true)
		}
		setAckOpen(false)
		setPendingModelId(null)
	}, [pendingModelId, setApiConfigurationField])

	const handleCancelAck = React.useCallback(() => {
		setAckOpen(false)
		setPendingModelId(null)
	}, [])

	return (
		<div className="provider-card">
			<h3>Oracle Code Assist (IDCS)</h3>
			<OcaAcknowledgeModal
				open={ackOpen}
				bannerHtml={bannerHtml ?? undefined}
				onAcknowledge={handleAcknowledge}
				onCancel={handleCancelAck}
			/>

			{status === "idle" && !activated && (
				<VSCodeButton appearance="primary" onClick={() => vscode.postMessage({ type: "oca/login" })}>
					Sign in
				</VSCodeButton>
			)}

			{status === "waiting" && authUrl && (
				<>
					<p>Click to sign in (opens in your browser):</p>
					<a href={authUrl} target="_blank" rel="noreferrer">
						{authUrl}
					</a>
					<p>After completing sign-in, return here. This page will update automatically.</p>
				</>
			)}
			{status === "done" && activated && (
				<div className="flex items-center gap-2">
					<VSCodeButton onClick={requestOcaModels}>Refresh models</VSCodeButton>
				</div>
			)}
			{status === "done" && activated && routerModelsLoading && (
				<div className="text-sm text-vscode-descriptionForeground flex items-center gap-2 mt-2">
					<span className="codicon codicon-loading codicon-modifier-spin" />
					<span>Fetching models…</span>
				</div>
			)}

			{status === "done" && activated && Object.keys(ocaModels).length > 0 && (
				<div className="mt-3">
					<ModelPicker
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={wrappedSetApiConfigurationField}
						defaultModelId={defaultModelId}
						models={ocaModels}
						modelIdKey="apiModelId"
						serviceName="Oracle Code Assist"
						serviceUrl=""
						organizationAllowList={organizationAllowList}
						errorMessage={modelValidationError}
					/>
				</div>
			)}

			{status === "error" && <p>❌ {error}</p>}

			{status === "done" && activated && (
				<div style={{ marginTop: 8 }}>
					<VSCodeButton onClick={() => vscode.postMessage({ type: "oca/logout" })}>Sign out</VSCodeButton>
				</div>
			)}
		</div>
	)
}

export default OCA
