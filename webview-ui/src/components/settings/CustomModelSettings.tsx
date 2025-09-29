import { useCallback } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type ModelInfo,
	type ReasoningEffort,
	openAiModelInfoSaneDefaults,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"

import { ThinkingBudget } from "./ThinkingBudget"

type CustomModelSettingsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: any) => void
	modelInfo?: ModelInfo // Used to provide default values
}

export const CustomModelSettings = ({
	apiConfiguration,
	setApiConfigurationField,
	modelInfo,
}: CustomModelSettingsProps) => {
	const { t } = useAppTranslation()

	const customModelInfo = apiConfiguration.customModelInfo || modelInfo || openAiModelInfoSaneDefaults

	const updateModelInfo = useCallback(
		<T extends keyof ModelInfo>(field: T, transform: (value: any) => ModelInfo[T]) =>
			(value: any) => {
				const newValue = transform(value)
				setApiConfigurationField("customModelInfo", {
					...(customModelInfo || openAiModelInfoSaneDefaults),
					[field]: newValue,
				})
			},
		[setApiConfigurationField, customModelInfo],
	)

	return (
		<div className="flex flex-col gap-3">
			<div className="text-sm text-vscode-descriptionForeground whitespace-pre-line">
				{t("settings:providers.customModel.capabilities")}
			</div>

			<div>
				<VSCodeTextField
					value={
						customModelInfo?.maxTokens?.toString() ||
						openAiModelInfoSaneDefaults.maxTokens?.toString() ||
						""
					}
					type="text"
					style={{
						borderColor: (() => {
							const value = customModelInfo?.maxTokens

							if (!value) {
								return "var(--vscode-input-border)"
							}

							return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
						})(),
					}}
					onInput={updateModelInfo("maxTokens", (e) => {
						const value = parseInt((e.target as HTMLInputElement).value)
						return isNaN(value) ? undefined : value
					})}
					placeholder={t("settings:placeholders.numbers.maxTokens")}
					className="w-full">
					<label className="block font-medium mb-1">
						{t("settings:providers.customModel.maxTokens.label")}
					</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.customModel.maxTokens.description")}
				</div>
			</div>

			<div>
				<VSCodeTextField
					value={
						customModelInfo?.contextWindow?.toString() ||
						openAiModelInfoSaneDefaults.contextWindow?.toString() ||
						""
					}
					type="text"
					style={{
						borderColor: (() => {
							const value = customModelInfo?.contextWindow

							if (!value) {
								return "var(--vscode-input-border)"
							}

							return value > 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
						})(),
					}}
					onInput={updateModelInfo("contextWindow", (e) => {
						const value = (e.target as HTMLInputElement).value
						const parsed = parseInt(value)
						return isNaN(parsed) ? openAiModelInfoSaneDefaults.contextWindow : parsed
					})}
					placeholder={t("settings:placeholders.numbers.contextWindow")}
					className="w-full">
					<label className="block font-medium mb-1">
						{t("settings:providers.customModel.contextWindow.label")}
					</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.customModel.contextWindow.description")}
				</div>
			</div>

			<div>
				<div className="flex items-center gap-1">
					<Checkbox
						checked={customModelInfo?.supportsImages ?? openAiModelInfoSaneDefaults.supportsImages}
						onChange={updateModelInfo("supportsImages", (checked) => checked)}>
						<span className="font-medium">{t("settings:providers.customModel.imageSupport.label")}</span>
					</Checkbox>
					<StandardTooltip content={t("settings:providers.customModel.imageSupport.description")}>
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							style={{ fontSize: "12px" }}
						/>
					</StandardTooltip>
				</div>
				<div className="text-sm text-vscode-descriptionForeground pt-1">
					{t("settings:providers.customModel.imageSupport.description")}
				</div>
			</div>

			<div>
				<div className="flex items-center gap-1">
					<Checkbox
						checked={customModelInfo?.supportsComputerUse ?? false}
						onChange={updateModelInfo("supportsComputerUse", (checked) => checked)}>
						<span className="font-medium">{t("settings:providers.customModel.computerUse.label")}</span>
					</Checkbox>
					<StandardTooltip content={t("settings:providers.customModel.computerUse.description")}>
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							style={{ fontSize: "12px" }}
						/>
					</StandardTooltip>
				</div>
				<div className="text-sm text-vscode-descriptionForeground pt-1">
					{t("settings:providers.customModel.computerUse.description")}
				</div>
			</div>

			<div>
				<div className="flex items-center gap-1">
					<Checkbox
						checked={customModelInfo?.supportsPromptCache ?? false}
						onChange={updateModelInfo("supportsPromptCache", (checked) => checked)}>
						<span className="font-medium">{t("settings:providers.customModel.promptCache.label")}</span>
					</Checkbox>
					<StandardTooltip content={t("settings:providers.customModel.promptCache.description")}>
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							style={{ fontSize: "12px" }}
						/>
					</StandardTooltip>
				</div>
				<div className="text-sm text-vscode-descriptionForeground pt-1">
					{t("settings:providers.customModel.promptCache.description")}
				</div>
			</div>

			<div>
				<VSCodeTextField
					value={
						customModelInfo?.inputPrice?.toString() ??
						openAiModelInfoSaneDefaults.inputPrice?.toString() ??
						""
					}
					type="text"
					style={{
						borderColor: (() => {
							const value = customModelInfo?.inputPrice

							if (!value && value !== 0) {
								return "var(--vscode-input-border)"
							}

							return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
						})(),
					}}
					onInput={updateModelInfo("inputPrice", (e) => {
						const value = (e.target as HTMLInputElement).value
						const parsed = parseFloat(value)
						return isNaN(parsed) ? openAiModelInfoSaneDefaults.inputPrice : parsed
					})}
					placeholder={t("settings:placeholders.numbers.inputPrice")}
					className="w-full">
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.pricing.input.label")}
						</label>
						<StandardTooltip content={t("settings:providers.customModel.pricing.input.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
				</VSCodeTextField>
			</div>

			<div>
				<VSCodeTextField
					value={
						customModelInfo?.outputPrice?.toString() ||
						openAiModelInfoSaneDefaults.outputPrice?.toString() ||
						""
					}
					type="text"
					style={{
						borderColor: (() => {
							const value = customModelInfo?.outputPrice

							if (!value && value !== 0) {
								return "var(--vscode-input-border)"
							}

							return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
						})(),
					}}
					onInput={updateModelInfo("outputPrice", (e) => {
						const value = (e.target as HTMLInputElement).value
						const parsed = parseFloat(value)
						return isNaN(parsed) ? openAiModelInfoSaneDefaults.outputPrice : parsed
					})}
					placeholder={t("settings:placeholders.numbers.outputPrice")}
					className="w-full">
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("settings:providers.customModel.pricing.output.label")}
						</label>
						<StandardTooltip content={t("settings:providers.customModel.pricing.output.description")}>
							<i
								className="codicon codicon-info text-vscode-descriptionForeground"
								style={{ fontSize: "12px" }}
							/>
						</StandardTooltip>
					</div>
				</VSCodeTextField>
			</div>

			{customModelInfo?.supportsPromptCache && (
				<>
					<div>
						<VSCodeTextField
							value={customModelInfo?.cacheReadsPrice?.toString() ?? "0"}
							type="text"
							style={{
								borderColor: (() => {
									const value = customModelInfo?.cacheReadsPrice

									if (!value && value !== 0) {
										return "var(--vscode-input-border)"
									}

									return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
								})(),
							}}
							onInput={updateModelInfo("cacheReadsPrice", (e) => {
								const value = (e.target as HTMLInputElement).value
								const parsed = parseFloat(value)
								return isNaN(parsed) ? 0 : parsed
							})}
							placeholder={t("settings:placeholders.numbers.inputPrice")}
							className="w-full">
							<div className="flex items-center gap-1">
								<span className="font-medium">
									{t("settings:providers.customModel.pricing.cacheReads.label")}
								</span>
								<StandardTooltip
									content={t("settings:providers.customModel.pricing.cacheReads.description")}>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										style={{ fontSize: "12px" }}
									/>
								</StandardTooltip>
							</div>
						</VSCodeTextField>
					</div>
					<div>
						<VSCodeTextField
							value={customModelInfo?.cacheWritesPrice?.toString() ?? "0"}
							type="text"
							style={{
								borderColor: (() => {
									const value = customModelInfo?.cacheWritesPrice

									if (!value && value !== 0) {
										return "var(--vscode-input-border)"
									}

									return value >= 0 ? "var(--vscode-charts-green)" : "var(--vscode-errorForeground)"
								})(),
							}}
							onInput={updateModelInfo("cacheWritesPrice", (e) => {
								const value = (e.target as HTMLInputElement).value
								const parsed = parseFloat(value)
								return isNaN(parsed) ? 0 : parsed
							})}
							placeholder={t("settings:placeholders.numbers.cacheWritePrice")}
							className="w-full">
							<div className="flex items-center gap-1">
								<label className="block font-medium mb-1">
									{t("settings:providers.customModel.pricing.cacheWrites.label")}
								</label>
								<StandardTooltip
									content={t("settings:providers.customModel.pricing.cacheWrites.description")}>
									<i
										className="codicon codicon-info text-vscode-descriptionForeground"
										style={{ fontSize: "12px" }}
									/>
								</StandardTooltip>
							</div>
						</VSCodeTextField>
					</div>
				</>
			)}

			{/* Reasoning effort section for models that support it */}
			{apiConfiguration.enableReasoningEffort && (
				<ThinkingBudget
					apiConfiguration={{
						...apiConfiguration,
						reasoningEffort: customModelInfo?.reasoningEffort,
					}}
					setApiConfigurationField={(field: keyof ProviderSettings, value: any) => {
						if (field === "reasoningEffort") {
							const updatedModelInfo = customModelInfo || openAiModelInfoSaneDefaults

							setApiConfigurationField("customModelInfo", {
								...updatedModelInfo,
								reasoningEffort: value as ReasoningEffort,
							})
						}
					}}
					modelInfo={{
						...(customModelInfo || openAiModelInfoSaneDefaults),
						supportsReasoningEffort: true,
					}}
				/>
			)}

			<Button
				variant="secondary"
				onClick={() => {
					// Clean copy of defaults to ensure no problematic fields
					const cleanedDefaults = { ...openAiModelInfoSaneDefaults }
					// Remove tiers field if it exists (it shouldn't, but just to be safe)
					if ("tiers" in cleanedDefaults) {
						delete cleanedDefaults.tiers
					}
					setApiConfigurationField("customModelInfo", cleanedDefaults)
				}}>
				{t("settings:providers.customModel.resetDefaults")}
			</Button>
		</div>
	)
}
