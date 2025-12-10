import { useState, useEffect, useRef, useCallback } from "react"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { ProfileDataResponsePayload, WebviewMessage, UserOrganizationWithApiKey } from "@roo/WebviewMessage"
import type { ProviderSettings } from "@roo-code/types"

type OrganizationSelectorProps = {
	className?: string
	showLabel?: boolean

	// Controlled mode props (optional) - when provided, component works with specific profile
	apiConfiguration?: ProviderSettings
	profileName?: string
	onChange?: (organizationId: string | undefined) => void
}

export const OrganizationSelector = ({
	className,
	showLabel = false,
	apiConfiguration: controlledApiConfiguration,
	profileName: controlledProfileName,
	onChange,
}: OrganizationSelectorProps) => {
	const [organizations, setOrganizations] = useState<UserOrganizationWithApiKey[]>([])
	const { apiConfiguration: globalApiConfiguration, currentApiConfigName: globalProfileName } = useExtensionState()
	const { t } = useAppTranslation()
	const [isOpen, setIsOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Determine if we're in controlled mode
	const isControlledMode = controlledApiConfiguration !== undefined
	const apiConfiguration = isControlledMode ? controlledApiConfiguration : globalApiConfiguration
	const currentProfileName = isControlledMode ? controlledProfileName : globalProfileName

	const selectedOrg = organizations.find((o) => o.id === apiConfiguration?.kilocodeOrganizationId)

	const handleMessage = useCallback(
		(event: MessageEvent<WebviewMessage>) => {
			const message = event.data
			if (message.type === "profileDataResponse") {
				const payload = message.payload as ProfileDataResponsePayload

				// Only process response if it matches the requested profile
				// In global mode (no currentProfileName), accept any response
				// In controlled mode, only accept responses for the specific profile
				const responseProfileName = payload.data?.profileName
				const shouldProcessResponse = !currentProfileName || responseProfileName === currentProfileName

				if (!shouldProcessResponse) {
					// This response is for a different profile, ignore it
					return
				}

				if (payload.success) {
					setOrganizations(payload.data?.organizations ?? [])
				} else {
					console.error("Error fetching profile organizations data:", payload.error)
					setOrganizations([])
				}
			} else if (message.type === "updateProfileData") {
				vscode.postMessage({
					type: "fetchProfileDataRequest",
					profileName: currentProfileName,
				})
			}
		},
		[currentProfileName],
	)

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setIsOpen(false)
		}

		const onMouseDown = (e: MouseEvent) => {
			if (!containerRef.current) return
			if (!containerRef.current.contains(e.target as Node)) {
				setIsOpen(false)
			}
		}

		window.addEventListener("keydown", onKeyDown)
		window.addEventListener("mousedown", onMouseDown)
		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("keydown", onKeyDown)
			window.removeEventListener("mousedown", onMouseDown)
			window.removeEventListener("message", handleMessage)
		}
	}, [handleMessage])

	useEffect(() => {
		if (!apiConfiguration?.kilocodeToken) return

		vscode.postMessage({
			type: "fetchProfileDataRequest",
			profileName: currentProfileName,
		})
	}, [apiConfiguration?.kilocodeToken, currentProfileName])

	const setSelectedOrganization = (organization: UserOrganizationWithApiKey | null) => {
		const newOrganizationId = organization?.id

		if (isControlledMode) {
			// Controlled mode: call the onChange callback
			if (onChange) {
				onChange(newOrganizationId)
			}
		} else {
			// Global mode: update the global configuration
			if (organization === null) {
				// Switch back to personal account - clear organization token
				vscode.postMessage({
					type: "upsertApiConfiguration",
					text: currentProfileName,
					apiConfiguration: {
						...apiConfiguration,
						kilocodeOrganizationId: undefined,
					},
				})
				vscode.postMessage({
					type: "fetchBalanceDataRequest",
					values: {
						apiKey: apiConfiguration?.kilocodeToken,
					},
				})
			} else {
				vscode.postMessage({
					type: "upsertApiConfiguration",
					text: currentProfileName,
					apiConfiguration: {
						...apiConfiguration,
						kilocodeOrganizationId: organization.id,
					},
				})
				vscode.postMessage({
					type: "fetchBalanceDataRequest",
				})
			}
		}
	}

	if (!organizations.length) return null

	return (
		<div className={className}>
			{showLabel && (
				<div>
					<label className="block font-medium mb-2">{t("kilocode:profile.organization")}</label>
				</div>
			)}
			<div className="relative" ref={containerRef}>
				<button
					type="button"
					onClick={() => setIsOpen((o) => !o)}
					aria-haspopup="listbox"
					aria-expanded={isOpen}
					title={
						selectedOrg
							? `${selectedOrg.name} – ${selectedOrg.role.toUpperCase()}`
							: t("kilocode:profile.personal")
					}
					className="w-full cursor-pointer border border-[var(--vscode-dropdown-border)] bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] rounded px-3 py-1.5 flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)] opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] transition-all duration-150">
					<span className="truncate">{selectedOrg ? selectedOrg.name : t("kilocode:profile.personal")}</span>
					<span className="flex items-center gap-2 shrink-0">
						{selectedOrg && (
							<span className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
								{selectedOrg.role.toUpperCase()}
							</span>
						)}
						<svg
							className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
							viewBox="0 0 12 12"
							fill="none"
							stroke="rgb(156 163 175)"
							aria-hidden="true">
							<path
								d="M3 4.5L6 7.5L9 4.5"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
				</button>

				{isOpen && (
					<div className="absolute z-20 mt-1 right-0 w-max min-w-full max-h-60 overflow-auto rounded border border-[var(--vscode-dropdown-border)] bg-[var(--vscode-dropdown-background)] shadow">
						<div role="listbox" aria-label={t("kilocode:profile.organization")}>
							<button
								type="button"
								role="option"
								aria-selected={!selectedOrg || selectedOrg.id === "personal"}
								onClick={() => {
									setSelectedOrganization(null)
									setIsOpen(false)
								}}
								className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-foreground)]">
								<span className="truncate">{t("kilocode:profile.personal")}</span>
							</button>

							{organizations.map((org) => (
								<button
									key={org.id}
									type="button"
									role="option"
									aria-selected={selectedOrg?.id === org.id}
									onClick={() => {
										setSelectedOrganization(org)
										setIsOpen(false)
									}}
									className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-foreground)]">
									<span className="truncate">{org.name}</span>
									<span className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
										{org.role.toUpperCase()}
									</span>
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
