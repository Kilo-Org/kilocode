import * as React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@src/utils/vscode"
import { OCAModelService } from "@src/services/OCAModelService"
import { OCA_MSG } from "@src/services/ocaMessages"
import { postOcaStatus, ocaLogin, ocaLogout, requestRouterModels } from "@src/services/ocaOutgoing"

import type { ProviderSettings, OrganizationAllowList, ModelInfo } from "@roo-code/types"

import { ModelPicker } from "../ModelPicker"
import OcaAcknowledgeModal from "../../kilocode/common/OcaAcknowledgeModal"

const OCA_STATE_KEY = "ocaActivated" as const

type OCAProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export function OCA({
	apiConfiguration,
	setApiConfigurationField,
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

	const [ocaModels, setOcaModels] = React.useState<Record<string, ModelInfo>>({})
	const [modelsLoading, setModelsLoading] = React.useState(false)
	const ocaErrorJustReceived = React.useRef(false)
	const firstOcaModelId = React.useMemo(() => Object.keys(ocaModels)[0] || "", [ocaModels])
	const defaultModelId = React.useMemo(() => {
		const saved = OCAModelService.getOcaSelectedModelId()
		return saved || apiConfiguration.apiModelId || firstOcaModelId
	}, [apiConfiguration.apiModelId, firstOcaModelId])

	const requestOcaModels = React.useCallback(() => {
		ocaErrorJustReceived.current = false
		setError(null)
		setModelsLoading(true)
		requestRouterModels()
	}, [])

	const activatedRef = React.useRef(activated)
	React.useEffect(() => {
		activatedRef.current = activated
	}, [activated])

	const requestOcaModelsRef = React.useRef(requestOcaModels)
	React.useEffect(() => {
		requestOcaModelsRef.current = requestOcaModels
	}, [requestOcaModels])

	// Listen for routerModels responses and extract OCA models locally (similar to OpenAICompatible pattern)
	React.useEffect(() => {
		const onRouterModels = (ev: MessageEvent) => {
			const m = ev.data as any
			if (m?.type === "routerModels") {
				const oca = (m.routerModels?.oca ?? {}) as Record<string, ModelInfo>
				setOcaModels(oca)
				setModelsLoading(false)
			} else if (m?.type === "singleRouterModelFetchResponse" && m?.values?.provider === "oca") {
				// Stop spinner even if the fetch failed for OCA
				setModelsLoading(false)
				ocaErrorJustReceived.current = true
				setError(m.error ?? "Failed to fetch models")
			}
		}
		window.addEventListener("message", onRouterModels)
		return () => window.removeEventListener("message", onRouterModels)
	}, [])

	React.useEffect(() => {
		const h = (ev: MessageEvent) => {
			const m = ev.data as any
			switch (m?.type) {
				case OCA_MSG.SHOW_AUTH_URL:
					setAuthUrl(m.url || null)
					setStatus("waiting")
					break
				case OCA_MSG.LOGIN_SUCCESS:
					setError(null)
					setActivated(true)
					setStatus("done")
					requestOcaModelsRef.current?.()
					break
				case OCA_MSG.LOGIN_ERROR:
					setStatus("error")
					setError(m.error ?? "Login failed")
					break
				case OCA_MSG.LOGOUT_SUCCESS:
					setStatus("idle")
					setAuthUrl(null)
					setError(null)
					setActivated(false)
					try {
						OCAModelService.clearOcaSelection()
					} catch {
						// best-effort
					}
					break
				case OCA_MSG.STATUS:
					if (m.authenticated) {
						setActivated(true)
						setStatus("done")
						requestOcaModelsRef.current?.()
					} else {
						setActivated(false)
						setStatus("idle")
					}
					break
			}
		}
		window.addEventListener("message", h)
		return () => window.removeEventListener("message", h)
	}, [])

	React.useEffect(() => {
		postOcaStatus()
	}, [])

	React.useEffect(() => {
		setAuthUrl(null)
		setError(null)
		if (activated) {
			setStatus("done")
			requestOcaModels()
		} else {
			setStatus("idle")
		}
	}, [activated, requestOcaModels])

	React.useEffect(() => {
		if (!activated || status !== "done") return

		try {
			OCAModelService.setOcaModels(ocaModels as any)
		} catch {
			// best-effort
		}

		const saved = OCAModelService.getOcaSelectedModelId()
		const first = Object.keys(ocaModels || {})[0]
		const target = saved || first
		if (!target) return

		if (apiConfiguration.apiModelId !== target && (ocaModels as any)?.[target]) {
			setApiConfigurationField("apiModelId", target as any, false)
		}

		try {
			OCAModelService.setOcaSelectedModelId(target)
		} catch {
			// best-effort
		}
	}, [activated, status, ocaModels, apiConfiguration.apiModelId, setApiConfigurationField])

	React.useEffect(() => {
		const prev = (vscode.getState() as any) || {}
		vscode.setState({ ...prev, [OCA_STATE_KEY]: activated })
	}, [activated])

	const bannerHtml = pendingModelId ? (ocaModels as any)?.[pendingModelId]?.banner : undefined

	const wrappedSetApiConfigurationField = React.useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K], isUserAction?: boolean) => {
			if (field === "apiModelId" && isUserAction !== false && typeof value === "string") {
				const banner = (ocaModels as any)?.[value as string]?.banner
				if (banner) {
					setPendingModelId(value as string)
					setAckOpen(true)
					return
				}
			}
			setApiConfigurationField(field, value, isUserAction)
			if (field === "apiModelId" && typeof value === "string") {
				try {
					OCAModelService.setOcaSelectedModelId(value as string)
				} catch {
					// best-effort
				}
			}
		},
		[setApiConfigurationField, ocaModels],
	)

	const handleAcknowledge = React.useCallback(() => {
		if (pendingModelId) {
			setApiConfigurationField("apiModelId", pendingModelId as any, true)
			try {
				OCAModelService.setOcaSelectedModelId(pendingModelId)
			} catch {
				// best-effort
			}
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
			<style>{`.oca-model-picker .text-vscode-descriptionForeground{display:none}.oca-model-picker label{display:none}.oca-model-picker [data-testid="model-picker-button"]{width:auto!important;min-width:280px;height:36px}.oca-model-picker .vscode-button{height:36px}`}</style>
			<OcaAcknowledgeModal
				open={ackOpen}
				bannerHtml={bannerHtml ?? undefined}
				onAcknowledge={handleAcknowledge}
				onCancel={handleCancelAck}
			/>

			{status === "idle" && !activated && (
				<>
					<p className="mb-2">Sign in to access Oracle internal models.</p>
					<VSCodeButton appearance="primary" onClick={ocaLogin}>
						Login with Oracle SSO
					</VSCodeButton>
				</>
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
			{status === "done" && activated && modelsLoading && (
				<div className="text-sm text-vscode-descriptionForeground flex items-center gap-2 mt-2">
					<span className="codicon codicon-loading codicon-modifier-spin" />
					<span>Fetching models…</span>
				</div>
			)}
			{status === "done" && activated && Object.keys(ocaModels).length > 0 && (
				<div className="mt-3 oca-model-picker">
					<div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
						<div>
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
						<VSCodeButton onClick={requestOcaModels} className="h-9 whitespace-nowrap">
							Refresh models
						</VSCodeButton>
					</div>
				</div>
			)}

			{status === "error" && <p>❌ {error}</p>}

			{status === "done" && activated && (
				<div style={{ marginTop: 8 }}>
					<VSCodeButton onClick={ocaLogout}>Sign out</VSCodeButton>
				</div>
			)}
		</div>
	)
}

export default OCA
