import { HTMLAttributes, useState } from "react"
import { X, CheckCheck } from "lucide-react"
import { Trans } from "react-i18next"
import { Package } from "@roo/package"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import { Button, Input, Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui" // kilocode_change

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { AutoApproveToggle } from "./AutoApproveToggle"
import { MaxLimitInputs } from "./MaxLimitInputs"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApprovalState } from "@/hooks/useAutoApprovalState"
import { useAutoApprovalToggles } from "@/hooks/useAutoApprovalToggles"

type AutoApproveSettingsProps = HTMLAttributes<HTMLDivElement> & {
	alwaysAllowReadOnly?: boolean
	alwaysAllowReadOnlyOutsideWorkspace?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowWriteOutsideWorkspace?: boolean
	alwaysAllowWriteProtected?: boolean
	alwaysAllowBrowser?: boolean
	alwaysApproveResubmit?: boolean
	requestDelaySeconds: number
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysAllowExecute?: boolean
	alwaysAllowFollowupQuestions?: boolean
	alwaysAllowUpdateTodoList?: boolean
	followupAutoApproveTimeoutMs?: number
	allowedCommands?: string[]
	allowedMaxRequests?: number | undefined
	allowedMaxCost?: number | undefined
	showAutoApproveMenu?: boolean // kilocode_change
	yoloMode?: boolean // kilocode_change
	yoloGatekeeperApiConfigId?: string // kilocode_change: AI gatekeeper for YOLO mode
	deniedCommands?: string[]
	setCachedStateField: SetCachedStateField<
		| "alwaysAllowReadOnly"
		| "alwaysAllowReadOnlyOutsideWorkspace"
		| "alwaysAllowWrite"
		| "alwaysAllowWriteOutsideWorkspace"
		| "alwaysAllowWriteProtected"
		| "alwaysAllowDelete" // kilocode_change
		| "alwaysAllowBrowser"
		| "alwaysApproveResubmit"
		| "requestDelaySeconds"
		| "alwaysAllowMcp"
		| "alwaysAllowModeSwitch"
		| "alwaysAllowSubtasks"
		| "alwaysAllowExecute"
		| "alwaysAllowFollowupQuestions"
		| "followupAutoApproveTimeoutMs"
		| "allowedCommands"
		| "allowedMaxRequests"
		| "allowedMaxCost"
		| "showAutoApproveMenu" // kilocode_change
		| "yoloMode" // kilocode_change
		| "yoloGatekeeperApiConfigId" // kilocode_change: AI gatekeeper for YOLO mode
		| "deniedCommands"
		| "alwaysAllowUpdateTodoList"
	>
}

export const AutoApproveSettings = ({
	alwaysAllowReadOnly,
	alwaysAllowReadOnlyOutsideWorkspace,
	alwaysAllowWrite,
	alwaysAllowWriteOutsideWorkspace,
	alwaysAllowWriteProtected,
	alwaysAllowBrowser,
	alwaysApproveResubmit,
	requestDelaySeconds,
	alwaysAllowMcp,
	alwaysAllowModeSwitch,
	alwaysAllowSubtasks,
	alwaysAllowExecute,
	alwaysAllowFollowupQuestions,
	followupAutoApproveTimeoutMs = 60000,
	alwaysAllowUpdateTodoList,
	allowedCommands,
	allowedMaxRequests,
	allowedMaxCost,
	showAutoApproveMenu, // kilocode_change
	yoloMode, // kilocode_change
	yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
	deniedCommands,
	setCachedStateField,
	...props
}: AutoApproveSettingsProps) => {
	const { t } = useAppTranslation()
	const [commandInput, setCommandInput] = useState("")
	const [deniedCommandInput, setDeniedCommandInput] = useState("")
	const { autoApprovalEnabled, setAutoApprovalEnabled, listApiConfigMeta } = useExtensionState() // kilocode_change: Add listApiConfigMeta for gatekeeper

	const toggles = useAutoApprovalToggles()

	const { effectiveAutoApprovalEnabled } = useAutoApprovalState(toggles, autoApprovalEnabled)

	const handleAddCommand = () => {
		const currentCommands = allowedCommands ?? []

		if (commandInput && !currentCommands.includes(commandInput)) {
			const newCommands = [...currentCommands, commandInput]
			setCachedStateField("allowedCommands", newCommands)
			setCommandInput("")
			vscode.postMessage({ type: "updateSettings", updatedSettings: { allowedCommands: newCommands } })
		}
	}

	const handleAddDeniedCommand = () => {
		const currentCommands = deniedCommands ?? []

		if (deniedCommandInput && !currentCommands.includes(deniedCommandInput)) {
			const newCommands = [...currentCommands, deniedCommandInput]
			setCachedStateField("deniedCommands", newCommands)
			setDeniedCommandInput("")
			vscode.postMessage({ type: "updateSettings", updatedSettings: { deniedCommands: newCommands } })
		}
	}

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<CheckCheck className="w-4 h-4" />
					<div>{t("settings:sections.autoApprove")}</div>
				</div>
			</SectionHeader>

			{/* kilocode_change start */}
			{yoloMode && (
				<Section>
					<div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 flex items-center gap-2">
						<span className="text-lg">⚡</span>
						<span className="text-sm font-medium text-yellow-500">
							YOLO Mode is active - all auto-approval settings below are overridden
						</span>
					</div>
				</Section>
			)}
			{/* kilocode_change end */}

			<Section>
				<div>
					<VSCodeCheckbox
						checked={showAutoApproveMenu}
						onChange={(e: any) => setCachedStateField("showAutoApproveMenu", e.target.checked)}
						data-testid="show-auto-approve-menu-checkbox">
						<span className="font-medium">{t("settings:autoApprove.showMenu.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:autoApprove.showMenu.description")}
					</div>
				</div>
			</Section>

			<Section>
				<div className="space-y-4">
					<VSCodeCheckbox
						checked={effectiveAutoApprovalEnabled}
						aria-label={t("settings:autoApprove.toggleAriaLabel")}
						onChange={() => {
							const newValue = !(autoApprovalEnabled ?? false)
							setAutoApprovalEnabled(newValue)
							vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
						}}>
						<span className="font-medium">{t("settings:autoApprove.enabled")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						<p>{t("settings:autoApprove.description")}</p>
						<p>
							<Trans
								i18nKey="settings:autoApprove.toggleShortcut"
								components={{
									SettingsLink: (
										<a
											href="#"
											className="text-vscode-textLink-foreground hover:underline cursor-pointer"
											onClick={(e) => {
												e.preventDefault()
												// Send message to open keyboard shortcuts with search for toggle command
												vscode.postMessage({
													type: "openKeyboardShortcuts",
													text: `${Package.name}.toggleAutoApprove`,
												})
											}}
										/>
									),
								}}
							/>
						</p>
					</div>

					<AutoApproveToggle
						alwaysAllowReadOnly={alwaysAllowReadOnly}
						alwaysAllowWrite={alwaysAllowWrite}
						alwaysAllowBrowser={alwaysAllowBrowser}
						alwaysApproveResubmit={alwaysApproveResubmit}
						alwaysAllowMcp={alwaysAllowMcp}
						alwaysAllowModeSwitch={alwaysAllowModeSwitch}
						alwaysAllowSubtasks={alwaysAllowSubtasks}
						alwaysAllowExecute={alwaysAllowExecute}
						alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
						alwaysAllowUpdateTodoList={alwaysAllowUpdateTodoList}
						onToggle={(key, value) => setCachedStateField(key, value)}
					/>

					<MaxLimitInputs
						allowedMaxRequests={allowedMaxRequests}
						allowedMaxCost={allowedMaxCost}
						onMaxRequestsChange={(value) => setCachedStateField("allowedMaxRequests", value)}
						onMaxCostChange={(value) => setCachedStateField("allowedMaxCost", value)}
					/>
				</div>

				{/* ADDITIONAL SETTINGS */}

				{alwaysAllowReadOnly && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-eye" />
							<div>{t("settings:autoApprove.readOnly.label")}</div>
						</div>
						<div>
							<VSCodeCheckbox
								checked={alwaysAllowReadOnlyOutsideWorkspace}
								onChange={(e: any) =>
									setCachedStateField("alwaysAllowReadOnlyOutsideWorkspace", e.target.checked)
								}
								data-testid="always-allow-readonly-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.readOnly.outsideWorkspace.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.readOnly.outsideWorkspace.description")}
							</div>
						</div>
					</div>
				)}

				{alwaysAllowWrite && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-edit" />
							<div>{t("settings:autoApprove.write.label")}</div>
						</div>
						<div>
							<VSCodeCheckbox
								checked={alwaysAllowWriteOutsideWorkspace}
								onChange={(e: any) =>
									setCachedStateField("alwaysAllowWriteOutsideWorkspace", e.target.checked)
								}
								data-testid="always-allow-write-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.write.outsideWorkspace.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.write.outsideWorkspace.description")}
							</div>
						</div>
						<div>
							<VSCodeCheckbox
								checked={alwaysAllowWriteProtected}
								onChange={(e: any) =>
									setCachedStateField("alwaysAllowWriteProtected", e.target.checked)
								}
								data-testid="always-allow-write-protected-checkbox">
								<span className="font-medium">{t("settings:autoApprove.write.protected.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
								{t("settings:autoApprove.write.protected.description")}
							</div>
						</div>
					</div>
				)}

				{alwaysApproveResubmit && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-refresh" />
							<div>{t("settings:autoApprove.retry.label")}</div>
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={5}
									max={100}
									step={1}
									value={[requestDelaySeconds]}
									onValueChange={([value]) => setCachedStateField("requestDelaySeconds", value)}
									data-testid="request-delay-slider"
								/>
								<span className="w-20">{requestDelaySeconds}s</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.retry.delayLabel")}
							</div>
						</div>
					</div>
				)}

				{alwaysAllowFollowupQuestions && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-question" />
							<div>{t("settings:autoApprove.followupQuestions.label")}</div>
						</div>
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={1000}
									max={300000}
									step={1000}
									value={[followupAutoApproveTimeoutMs]}
									onValueChange={([value]) =>
										setCachedStateField("followupAutoApproveTimeoutMs", value)
									}
									data-testid="followup-timeout-slider"
								/>
								<span className="w-20">{followupAutoApproveTimeoutMs / 1000}s</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.followupQuestions.timeoutLabel")}
							</div>
						</div>
					</div>
				)}

				{alwaysAllowExecute && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-terminal" />
							<div>{t("settings:autoApprove.execute.label")}</div>
						</div>

						<div>
							<label className="block font-medium mb-1" data-testid="allowed-commands-heading">
								{t("settings:autoApprove.execute.allowedCommands")}
							</label>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.execute.allowedCommandsDescription")}
							</div>
						</div>

						<div className="flex gap-2">
							<Input
								value={commandInput}
								onChange={(e: any) => setCommandInput(e.target.value)}
								onKeyDown={(e: any) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleAddCommand()
									}
								}}
								placeholder={t("settings:autoApprove.execute.commandPlaceholder")}
								className="grow"
								data-testid="command-input"
							/>
							<Button className="h-8" onClick={handleAddCommand} data-testid="add-command-button">
								{t("settings:autoApprove.execute.addButton")}
							</Button>
						</div>

						<div className="flex flex-wrap gap-2">
							{(allowedCommands ?? []).map((cmd, index) => (
								<Button
									key={index}
									variant="secondary"
									data-testid={`remove-command-${index}`}
									onClick={() => {
										const newCommands = (allowedCommands ?? []).filter((_, i) => i !== index)
										setCachedStateField("allowedCommands", newCommands)

										vscode.postMessage({
											type: "updateSettings",
											updatedSettings: { allowedCommands: newCommands },
										})
									}}>
									<div className="flex flex-row items-center gap-1">
										<div>{cmd}</div>
										<X className="text-foreground scale-75" />
									</div>
								</Button>
							))}
						</div>

						{/* Denied Commands Section */}
						<div className="mt-6">
							<label className="block font-medium mb-1" data-testid="denied-commands-heading">
								{t("settings:autoApprove.execute.deniedCommands")}
							</label>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.execute.deniedCommandsDescription")}
							</div>
						</div>

						<div className="flex gap-2">
							<Input
								value={deniedCommandInput}
								onChange={(e: any) => setDeniedCommandInput(e.target.value)}
								onKeyDown={(e: any) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleAddDeniedCommand()
									}
								}}
								placeholder={t("settings:autoApprove.execute.deniedCommandPlaceholder")}
								className="grow"
								data-testid="denied-command-input"
							/>
							<Button
								className="h-8"
								onClick={handleAddDeniedCommand}
								data-testid="add-denied-command-button">
								{t("settings:autoApprove.execute.addButton")}
							</Button>
						</div>

						<div className="flex flex-wrap gap-2">
							{(deniedCommands ?? []).map((cmd, index) => (
								<Button
									key={index}
									variant="secondary"
									data-testid={`remove-denied-command-${index}`}
									onClick={() => {
										const newCommands = (deniedCommands ?? []).filter((_, i) => i !== index)
										setCachedStateField("deniedCommands", newCommands)

										vscode.postMessage({
											type: "updateSettings",
											updatedSettings: { deniedCommands: newCommands },
										})
									}}>
									<div className="flex flex-row items-center gap-1">
										<div>{cmd}</div>
										<X className="text-foreground scale-75" />
									</div>
								</Button>
							))}
						</div>
					</div>
				)}
			</Section>

			{/* kilocode_change start */}
			<Section>
				<div className="border-2 border-yellow-500 rounded-md p-4 bg-yellow-500/10">
					<div className="flex items-center gap-2 mb-3">
						<span className="text-2xl">⚠️</span>
						<h3 className="text-lg font-bold text-yellow-500">YOLO Mode</h3>
					</div>
					<VSCodeCheckbox
						checked={yoloMode ?? false}
						onChange={(e: any) => setCachedStateField("yoloMode", e.target.checked)}
						data-testid="yolo-mode-checkbox">
						<span className="font-bold text-base">Enable YOLO Mode - Auto-approve EVERYTHING</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-2 pl-6">
						<p className="mb-2">
							When enabled,{" "}
							<strong>all operations will be automatically approved without confirmation</strong>.
						</p>
						<p className="text-yellow-500 font-medium">
							⚡ This includes file modifications, command execution, MCP tools, browser actions, and all
							other operations. Use with extreme caution!
						</p>
					</div>

					{/* kilocode_change start: AI gatekeeper for YOLO mode */}
					{yoloMode && (
						<div className="mt-4 pl-6 border-l-2 border-yellow-500/50">
							<label className="block font-medium mb-1">AI Safety Gatekeeper (Optional)</label>
							<Select
								value={yoloGatekeeperApiConfigId || "-"}
								onValueChange={(value) => {
									const newConfigId = value === "-" ? "" : value
									setCachedStateField("yoloGatekeeperApiConfigId", newConfigId)
									vscode.postMessage({
										type: "yoloGatekeeperApiConfigId",
										text: newConfigId,
									})
								}}>
								<SelectTrigger data-testid="gatekeeper-api-config-select" className="w-full">
									<SelectValue placeholder="No gatekeeper (approve all)" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="-">No gatekeeper (approve all)</SelectItem>
									{(listApiConfigMeta || []).map((config) => (
										<SelectItem
											key={config.id}
											value={config.id}
											data-testid={`gatekeeper-${config.id}-option`}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="text-sm text-vscode-descriptionForeground mt-1">
								Select a model to evaluate each action before auto-approving. The gatekeeper will decide
								if risky operations should be allowed. We suggest using a small, fast model. This will
								incur additional costs, as well as additional latency.
							</div>
						</div>
					)}
					{/* kilocode_change end */}
				</div>
			</Section>
			{/* kilocode_change end */}
		</div>
	)
}
