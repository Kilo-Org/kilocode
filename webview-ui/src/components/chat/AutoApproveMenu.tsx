import { memo, useCallback, useMemo, useState } from "react"
import { Trans } from "react-i18next"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { AutoApproveToggle, AutoApproveSetting, autoApproveSettingsConfig } from "../settings/AutoApproveToggle"
import { MaxRequestsInput } from "../settings/MaxRequestsInput" // kilocode_change
import { MaxCostInput } from "../settings/MaxCostInput" // kilocode_change
import { StandardTooltip } from "@src/components/ui"
import { useAutoApprovalState } from "@src/hooks/useAutoApprovalState"
import { useAutoApprovalToggles } from "@src/hooks/useAutoApprovalToggles"

interface AutoApproveMenuProps {
	style?: React.CSSProperties
}

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const {
		autoApprovalEnabled,
		setAutoApprovalEnabled,
		allowedMaxRequests, // kilocode_change
		allowedMaxCost, // kilocode_change
		setAlwaysAllowReadOnly,
		setAlwaysAllowWrite,
		setAlwaysAllowDelete, // kilocode_change
		setAlwaysAllowExecute,
		setAlwaysAllowBrowser,
		setAlwaysAllowMcp,
		setAlwaysAllowModeSwitch,
		setAlwaysAllowSubtasks,
		setAlwaysAllowFollowupQuestions,
		setAllowedMaxRequests, // kilocode_change
		setAllowedMaxCost, // kilocode_change
	} = useExtensionState()

	const { t } = useAppTranslation()

	const toggles = useAutoApprovalToggles()
	const { hasEnabledOptions, effectiveAutoApprovalEnabled } = useAutoApprovalState(toggles, autoApprovalEnabled)

	const onAutoApproveToggle = useCallback(
		(key: AutoApproveSetting, value: boolean) => {
			vscode.postMessage({ type: "updateSettings", updatedSettings: { [key]: value } })

			// Update the specific toggle state
			switch (key) {
				case "alwaysAllowReadOnly":
					setAlwaysAllowReadOnly(value)
					break
				case "alwaysAllowWrite":
					setAlwaysAllowWrite(value)
					break
				// kilocode_change start
				case "alwaysAllowDelete":
					setAlwaysAllowDelete(value)
					break
				// kilocode_change end
				case "alwaysAllowExecute":
					setAlwaysAllowExecute(value)
					break
				case "alwaysAllowBrowser":
					setAlwaysAllowBrowser(value)
					break
				case "alwaysAllowMcp":
					setAlwaysAllowMcp(value)
					break
				case "alwaysAllowModeSwitch":
					setAlwaysAllowModeSwitch(value)
					break
				case "alwaysAllowSubtasks":
					setAlwaysAllowSubtasks(value)
					break
				case "alwaysAllowFollowupQuestions":
					setAlwaysAllowFollowupQuestions(value)
					break
			}

			// Check if we need to update the master auto-approval state
			// Create a new toggles state with the updated value
			const updatedToggles = {
				...toggles,
				[key]: value,
			}

			const willHaveEnabledOptions = Object.values(updatedToggles).some((v) => !!v)

			// If enabling the first option, enable master auto-approval
			if (value && !hasEnabledOptions && willHaveEnabledOptions) {
				setAutoApprovalEnabled(true)
				vscode.postMessage({ type: "updateSettings", updatedSettings: { autoApprovalEnabled: true } })
			}
			// If disabling the last option, disable master auto-approval
			else if (!value && hasEnabledOptions && !willHaveEnabledOptions) {
				setAutoApprovalEnabled(false)
				vscode.postMessage({ type: "updateSettings", updatedSettings: { autoApprovalEnabled: false } })
			}
		},
		[
			toggles,
			hasEnabledOptions,
			setAlwaysAllowReadOnly,
			setAlwaysAllowWrite,
			setAlwaysAllowDelete, // kilocode_change
			setAlwaysAllowExecute,
			setAlwaysAllowBrowser,
			setAlwaysAllowMcp,
			setAlwaysAllowModeSwitch,
			setAlwaysAllowSubtasks,
			setAlwaysAllowFollowupQuestions,
			setAutoApprovalEnabled,
		],
	)

	const toggleExpanded = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	const enabledActionsList = Object.entries(toggles)
		.filter(([_key, value]) => !!value)
		.map(([key]) => t(autoApproveSettingsConfig[key as AutoApproveSetting].labelKey))
		.join(", ")

	// Update displayed text logic
	const displayText = useMemo(() => {
		if (!effectiveAutoApprovalEnabled || !hasEnabledOptions) {
			return t("chat:autoApprove.none")
		}
		return enabledActionsList || t("chat:autoApprove.none")
	}, [effectiveAutoApprovalEnabled, hasEnabledOptions, enabledActionsList, t])

	const handleOpenSettings = useCallback(
		() =>
			window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "autoApprove" } }),
		[],
	)

	return (
		<div
			style={{
				padding: "0 15px",
				userSelect: "none",
				borderTop: isExpanded
					? `0.5px solid color-mix(in srgb, var(--vscode-titleBar-inactiveForeground) 20%, transparent)`
					: "none",
				overflowY: "auto",
				...style,
			}}>
			{isExpanded && (
				<div className="flex flex-col gap-2 py-4">
					<div
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontSize: "12px",
						}}>
						<Trans
							i18nKey="chat:autoApprove.description"
							components={{
								settingsLink: <VSCodeLink href="#" onClick={handleOpenSettings} />,
							}}
						/>
					</div>

					<AutoApproveToggle {...toggles} onToggle={onAutoApproveToggle} />

					{/* kilocode_change start */}
					<div className="flex gap-2 w-full justify-stretch mb-2">
						<MaxRequestsInput
							allowedMaxRequests={allowedMaxRequests ?? undefined}
							onValueChange={(value) => setAllowedMaxRequests(value)}
						/>
						<MaxCostInput
							allowedMaxCost={allowedMaxCost ?? undefined}
							onValueChange={(value) => setAllowedMaxCost(value)}
						/>
					</div>
					{/* kilocode_change end */}
				</div>
			)}

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					padding: "2px 0 0 0",
					cursor: "pointer",
				}}
				onClick={toggleExpanded}>
				<div onClick={(e) => e.stopPropagation()}>
					<StandardTooltip
						content={!hasEnabledOptions ? t("chat:autoApprove.selectOptionsFirst") : undefined}>
						<VSCodeCheckbox
							checked={effectiveAutoApprovalEnabled}
							disabled={!hasEnabledOptions}
							aria-label={
								hasEnabledOptions
									? t("chat:autoApprove.toggleAriaLabel")
									: t("chat:autoApprove.disabledAriaLabel")
							}
							onChange={() => {
								if (hasEnabledOptions) {
									const newValue = !(autoApprovalEnabled ?? false)
									setAutoApprovalEnabled(newValue)
									vscode.postMessage({
										type: "updateSettings",
										updatedSettings: { autoApprovalEnabled: newValue },
									})
								}
								// If no options enabled, do nothing
							}}
						/>
					</StandardTooltip>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "4px",
						flex: 1,
						minWidth: 0,
					}}>
					<span
						style={{
							color: "var(--vscode-foreground)",
							flexShrink: 0,
						}}>
						{t("chat:autoApprove.title")}
					</span>
					<span
						style={{
							color: "var(--vscode-descriptionForeground)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							flex: 1,
							minWidth: 0,
						}}>
						{displayText}
					</span>
					<span
						className={`codicon codicon-chevron-right flex-shrink-0 transition-transform duration-200 ease-in-out ${
							isExpanded ? "-rotate-90 ml-[2px]" : "rotate-0 -ml-[2px]"
						}`}
					/>
				</div>
			</div>
		</div>
	)
}

export default memo(AutoApproveMenu)
