import * as React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@src/utils/vscode"

import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"
import type { RouterModels } from "@roo/api"

import { ModelPicker } from "../ModelPicker"

type OCAProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	routerModels?: RouterModels
	refetchRouterModels?: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export function OCA({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	refetchRouterModels,
	organizationAllowList,
	modelValidationError,
}: OCAProps) {
	const [authUrl, setAuthUrl] = React.useState<string | null>(null)
	const [status, setStatus] = React.useState<"idle" | "waiting" | "done" | "error">("idle")
	const [error, setError] = React.useState<string | null>(null)

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

	React.useEffect(() => {
		const h = (ev: MessageEvent) => {
			const m = ev.data
			if (m?.type === "oca/show-auth-url") {
				setAuthUrl(m.url)
				setStatus("waiting")
			}
			if (m?.type === "oca/login-success") {
				setStatus("done")
				setError(null)
				// After successful login, flush and refresh models so the dropdown appears
				// vscode.postMessage({ type: "flushRouterModels", text: "oca" })
				// setTimeout(() => {
				requestOcaModels()
				// }, 300)
			}
			if (m?.type === "oca/login-error") {
				setStatus("error")
				setError(m.error ?? "Login failed")
			}
			if (m?.type === "oca/logout-success") {
				setStatus("idle")
				setAuthUrl(null)
				setError(null)
			}
			if (m?.type === "oca/status") {
				if (m.authenticated) {
					setStatus("done")
					setError(null)
					// Do not auto-fetch models; user can refresh explicitly.
				} else {
					setStatus("idle")
				}
			}
		}
		window.addEventListener("message", h)
		return () => window.removeEventListener("message", h)
	}, [requestOcaModels])

	// On mount, passively check OCA auth status so returning users see correct state.
	// This does not initiate authentication or fetch models.
	React.useEffect(() => {
		vscode.postMessage({ type: "oca/status" })
	}, [])

	return (
		<div className="provider-card">
			<h3>Oracle Code Assist (IDCS)</h3>

			{status === "idle" && (
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
			{status === "done" && (
				<div className="flex items-center gap-2">
					<VSCodeButton onClick={requestOcaModels}>Refresh models</VSCodeButton>
				</div>
			)}

			{status === "done" && Object.keys(ocaModels).length > 0 && (
				<div className="mt-3">
					<ModelPicker
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
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

			<div style={{ marginTop: 8 }}>
				<VSCodeButton onClick={() => vscode.postMessage({ type: "oca/logout" })}>Sign out</VSCodeButton>
			</div>
		</div>
	)
}

export default OCA
