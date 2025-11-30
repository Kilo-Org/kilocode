// kilocode_change - new file
import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { vscode } from "@src/utils/vscode"

import { ExtensionMessage } from "@roo/ExtensionMessage"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Checkbox, Input, SearchableSelect, type SearchableSelectOption } from "@src/components/ui"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"
import { DeploymentRecord } from "../../../../../src/api/providers/fetchers/sap-ai-core"
import { ModelInfoView } from "@/components/settings/ModelInfoView"
import { ModelRecord } from "@roo/api"

type SapAiCoreProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (
		field: keyof ProviderSettings,
		value: ProviderSettings[keyof ProviderSettings],
		isUserAction?: boolean,
	) => void
}

// Fields that trigger model/deployment refetch when changed
const REFETCH_FIELDS = ["sapAiCoreServiceKey", "sapAiCoreResourceGroup", "sapAiCoreUseOrchestration"] as const

const SapAiCore = ({ apiConfiguration, setApiConfigurationField }: SapAiCoreProps) => {
	const { t } = useAppTranslation()
	const [models, setModels] = useState<ModelRecord>({})
	const [deployments, setDeployments] = useState<DeploymentRecord>({})
	const [loading, setLoading] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	// Extracted common auth values to avoid repetition
	const sapAiCoreConfiguration = useMemo(
		() => ({
			sapAiCoreServiceKey: apiConfiguration.sapAiCoreServiceKey || "",
			sapAiCoreResourceGroup: apiConfiguration.sapAiCoreResourceGroup || "",
			sapAiCoreUseOrchestration: apiConfiguration.sapAiCoreUseOrchestration || false,
		}),
		[apiConfiguration],
	)

	const fetchModels = useCallback(() => {
		setLoading(true)
		vscode.postMessage({
			type: "requestSapAiCoreModels",
			values: sapAiCoreConfiguration,
		})
	}, [sapAiCoreConfiguration])

	const fetchDeployments = useCallback(() => {
		setLoading(true)
		vscode.postMessage({
			type: "requestSapAiCoreDeployments",
			values: sapAiCoreConfiguration,
		})
	}, [sapAiCoreConfiguration])

	const clearModelSelection = useCallback(() => {
		// Clear model-related fields when toggling orchestration
		const fieldsToReset = ["sapAiCoreModelId", "sapAiCoreCustomModelInfo", "sapAiCoreDeploymentId"]
		fieldsToReset.forEach((field) => setApiConfigurationField(field as keyof ProviderSettings, undefined))
	}, [setApiConfigurationField])

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
				if (REFETCH_FIELDS.includes(field as any)) {
					clearModelSelection()
					fetchModels()
					fetchDeployments()
				}
			},
		[setApiConfigurationField, fetchModels, fetchDeployments, clearModelSelection],
	)

	useEffect(() => {
		fetchModels()
		fetchDeployments()
	}, [fetchModels, fetchDeployments])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "sapAiCoreModels":
				setModels(message.sapAiCoreModels || {})
				setLoading(false)
				break
			case "sapAiCoreDeployments":
				setDeployments(message.sapAiCoreDeployments || {})
				setLoading(false)
				break
		}
	}, [])

	useEvent("message", onMessage)

	// Simplified handlers
	const handleModelSelect = (modelId: string) => {
		setApiConfigurationField("sapAiCoreModelId", modelId)
		setApiConfigurationField("sapAiCoreCustomModelInfo", models[modelId])
		setApiConfigurationField("sapAiCoreDeploymentId", undefined)
	}

	const handleDeploymentSelect = (deploymentId: string) => {
		setApiConfigurationField("sapAiCoreDeploymentId", deploymentId)
	}

	const handleUseOrchestrationSelect = (useOrchestration: boolean) => {
		clearModelSelection()
		setApiConfigurationField("sapAiCoreUseOrchestration", useOrchestration)
	}

	// Deployment filtering logic
	const getAvailableDeployments = useCallback(
		(modelId?: string) => {
			return Object.values(deployments).filter((deployment) => deployment.model === modelId)
		},
		[deployments],
	)

	const hasAvailableDeployments = useCallback(
		(modelId?: string) => {
			return getAvailableDeployments(modelId).length > 0
		},
		[getAvailableDeployments],
	)

	// Model options with sorting
	const modelOptions = useMemo(() => {
		return Object.keys(models)
			.map(
				(modelId): SearchableSelectOption => ({
					value: modelId,
					label: modelId,
					disabled: !apiConfiguration.sapAiCoreUseOrchestration && !hasAvailableDeployments(modelId),
				}),
			)
			.sort((a, b) => {
				if (!apiConfiguration.sapAiCoreUseOrchestration && a.disabled !== b.disabled) {
					return a.disabled ? 1 : -1
				}
				return a.label.localeCompare(b.label)
			})
	}, [models, apiConfiguration.sapAiCoreUseOrchestration, hasAvailableDeployments])

	// Deployment options for selected model
	const deploymentOptions = useMemo(() => {
		if (!apiConfiguration.sapAiCoreModelId) return []

		return getAvailableDeployments(apiConfiguration.sapAiCoreModelId)
			.sort((a, b) => Number(b.targetStatus === "RUNNING") - Number(a.targetStatus === "RUNNING"))
			.map(
				(deployment): SearchableSelectOption => ({
					value: deployment.id,
					label:
						deployment.targetStatus === "RUNNING"
							? deployment.id
							: `${deployment.id} (${deployment.targetStatus.toLowerCase()})`,
					disabled: deployment.targetStatus !== "RUNNING",
				}),
			)
	}, [apiConfiguration.sapAiCoreModelId, getAvailableDeployments])

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-2">
				<label htmlFor="sap-ai-core-service-key" className="block font-medium mb-1">
					{t("settings:providers.sapAiCore.serviceKey")}
				</label>
				<Input
					id="sap-ai-core-service-key"
					type="text"
					value={apiConfiguration.sapAiCoreServiceKey || ""}
					onInput={handleInputChange("sapAiCoreServiceKey")}
					placeholder={t("settings:providers.sapAiCore.serviceKeyJson")}
				/>
			</div>

			<div className="text-xs text-vscode-descriptionForeground mb-3">
				{t("settings:providers.sapAiCore.credentialsNote")}{" "}
				<VSCodeLink
					href="https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/enabling-service-in-cloud-foundry"
					target="_blank">
					{t("settings:providers.sapAiCore.learnMore")}
				</VSCodeLink>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="sap-ai-core-resource-group" className="block font-medium mb-1">
					{t("settings:providers.sapAiCore.resourceGroup")}
				</label>
				<Input
					id="sap-ai-core-resource-group"
					type="text"
					value={apiConfiguration.sapAiCoreResourceGroup || ""}
					onInput={handleInputChange("sapAiCoreResourceGroup")}
					placeholder="default"
				/>
			</div>

			<div className="flex items-center space-x-2">
				<Checkbox
					id="sap-ai-core-orchestration"
					checked={apiConfiguration.sapAiCoreUseOrchestration ?? false}
					onCheckedChange={handleUseOrchestrationSelect}
				/>
				<label htmlFor="sap-ai-core-orchestration">{t("settings:providers.sapAiCore.orchestrationMode")}</label>
			</div>

			<div className="text-xs text-vscode-descriptionForeground mb-3">
				<div className="mb-1">{t("settings:providers.sapAiCore.orchestrationEnabledDesc")}</div>
				<div>{t("settings:providers.sapAiCore.orchestrationDisabledDesc")}</div>
			</div>

			{!apiConfiguration.sapAiCoreUseOrchestration && (
				<div className="mt-3 p-3 bg-vscode-editorWidget-background border border-vscode-editorWidget-border rounded">
					<div className="flex items-center gap-2 mb-2">
						<i className="codicon codicon-warning text-vscode-notificationsWarningIcon-foreground" />
						<span className="font-semibold text-sm">
							{t("settings:providers.sapAiCore.supportedProviders")}
						</span>
					</div>
					<span className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.sapAiCore.supportedProvidersDesc1")}
					</span>
					<ul className="list-disc list-inside space-y-1 text-sm text-vscode-descriptionForeground">
						<li>{t("settings:codeIndex.openaiProvider")}</li>
					</ul>
					<span className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.sapAiCore.supportedProvidersDesc2")}
					</span>
					<div className="mt-2">
						<VSCodeLink
							href="https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/orchestration-8d022355037643cebf775cd3bf662cc5"
							target="_blank">
							{t("settings:providers.sapAiCore.supportedProvidersDesc3")}
						</VSCodeLink>
					</div>
				</div>
			)}

			<div className="flex flex-col gap-2">
				<label className="block font-medium text-sm">
					{t("settings:providers.model")}
					{loading ? (
						<span className="text-xs text-gray-400 ml-2">{t("settings:providers.sapAiCore.loading")}</span>
					) : (
						<span className="text-xs text-gray-400 ml-2">
							{t("settings:providers.sapAiCore.modelsCount", {
								count: Object.keys(models).length,
							})}
						</span>
					)}
				</label>

				<SearchableSelect
					value={apiConfiguration?.sapAiCoreModelId || ""}
					onValueChange={handleModelSelect}
					options={modelOptions}
					placeholder={t("settings:providers.sapAiCore.selectModel")}
					searchPlaceholder={t("settings:providers.sapAiCore.searchModels")}
					emptyMessage={t("settings:providers.sapAiCore.noModelsFound")}
					disabled={loading}
				/>
			</div>

			{!apiConfiguration.sapAiCoreUseOrchestration && !apiConfiguration.sapAiCoreModelId && (
				<div className="text-xs text-vscode-descriptionForeground mb-3">
					<div className="mb-1">{t("settings:providers.sapAiCore.modelDeploymentDesc")}</div>
				</div>
			)}

			{!apiConfiguration.sapAiCoreUseOrchestration && apiConfiguration.sapAiCoreModelId && (
				<div className="flex flex-col gap-2">
					<label className="block font-medium text-sm">
						{t("settings:providers.sapAiCore.deployment")}
						{loading ? (
							<span className="text-xs text-gray-400 ml-2">
								{t("settings:providers.sapAiCore.loading")}
							</span>
						) : (
							<span className="text-xs text-gray-400 ml-2">
								{t("settings:providers.sapAiCore.deploymentsCount", {
									count: getAvailableDeployments(apiConfiguration.sapAiCoreModelId).length,
								})}
							</span>
						)}
					</label>

					<SearchableSelect
						value={apiConfiguration?.sapAiCoreDeploymentId || ""}
						onValueChange={handleDeploymentSelect}
						options={deploymentOptions}
						placeholder={
							hasAvailableDeployments(apiConfiguration.sapAiCoreModelId)
								? t("settings:providers.sapAiCore.selectDeployment")
								: t("settings:providers.sapAiCore.noDeploymentFound")
						}
						searchPlaceholder={t("settings:providers.sapAiCore.searchDeployments")}
						emptyMessage={t("settings:providers.sapAiCore.noDeploymentFound")}
						disabled={!hasAvailableDeployments(apiConfiguration.sapAiCoreModelId)}
					/>
				</div>
			)}

			{apiConfiguration.sapAiCoreModelId && (
				<ModelInfoView
					apiProvider={apiConfiguration.apiProvider}
					selectedModelId={apiConfiguration.sapAiCoreModelId}
					modelInfo={models[apiConfiguration.sapAiCoreModelId]}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
				/>
			)}

			<div className="mt-2">
				<VSCodeLink href="https://help.sap.com/docs/sap-ai-core" target="_blank">
					{t("settings:providers.sapAiCore.getStarted")}
				</VSCodeLink>
			</div>
		</div>
	)
}

export default SapAiCore
