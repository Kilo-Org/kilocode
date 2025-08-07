import { HTMLAttributes } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { MessageSquare, Zap, History, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Button } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { MessageSendingConfig } from "./MessageSendingConfig"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type MessageSendingSettingsProps = HTMLAttributes<HTMLDivElement> & {
	messageSendingConfig?: MessageSendingConfig
	setCachedStateField: SetCachedStateField<"messageSendingConfig">
}

const TEMPLATE_OPTIONS = [
	{ value: "balanced", label: "平衡模式" },
	{ value: "performance", label: "性能优先" },
	{ value: "quality", label: "质量优先" },
	{ value: "minimal", label: "最小化" },
	{ value: "custom", label: "自定义" },
]

const defaultConfig: MessageSendingConfig = {
	useSmartTemplate: true,
	selectedTemplate: "balanced",
	customTemplate: "",
	showTokenSavings: true,
	includeSystemPrompt: true,
	includeConversationHistory: true,
	includeFileContext: true,
	includeCodeContext: true,
	maxHistoryMessages: 10,
	enableHistoryCompression: false,
	compressionRatio: 50,
	enableContextCaching: true,
	enableImageOptimization: true,
	enableTokenOptimization: true,
	maxTokensPerRequest: 4000,
	enableRealTimePreview: true,
	showEstimatedCost: true,
}

export const MessageSendingSettings = ({
	messageSendingConfig = defaultConfig,
	setCachedStateField,
	className,
	...props
}: MessageSendingSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={t("settings:messageSending.description")}>
				<div className="flex items-center gap-2">
					<MessageSquare className="w-4" />
					<div>{t("settings:sections.messageSending")}</div>
				</div>
			</SectionHeader>

			{/* 智能模板选择 */}
			<Section>
				<div className="flex items-center gap-2 mb-3">
					<Zap className="w-4" />
					<span className="font-medium">{t("settings:messageSending.smartTemplate.title")}</span>
				</div>

				<div>
					<VSCodeCheckbox
						checked={messageSendingConfig.useSmartTemplate}
						onChange={(e: any) =>
							setCachedStateField("messageSendingConfig", {
								...messageSendingConfig,
								useSmartTemplate: e.target.checked,
							})
						}
						data-testid="use-smart-template-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:messageSending.smartTemplate.enable")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:messageSending.smartTemplate.description")}
					</div>
				</div>

				{messageSendingConfig.useSmartTemplate && (
					<div className="pl-3 border-l-2 border-vscode-button-background">
						<div>
							<span className="block font-medium mb-2">
								{t("settings:messageSending.smartTemplate.selectTemplate")}
							</span>
							<Select
								value={messageSendingConfig.selectedTemplate}
								onValueChange={(value) =>
									setCachedStateField("messageSendingConfig", {
										...messageSendingConfig,
										selectedTemplate: value,
									})
								}
								data-testid="template-select">
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={t("settings:messageSending.smartTemplate.selectPlaceholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{TEMPLATE_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{messageSendingConfig.selectedTemplate === "custom" && (
							<div className="mt-3">
								<span className="block font-medium mb-2">
									{t("settings:messageSending.smartTemplate.customTemplate")}
								</span>
								<Input
									type="text"
									className="w-full"
									value={messageSendingConfig.customTemplate}
									onChange={(e) =>
										setCachedStateField("messageSendingConfig", {
											...messageSendingConfig,
											customTemplate: e.target.value,
										})
									}
									placeholder={t("settings:messageSending.smartTemplate.customPlaceholder")}
									data-testid="custom-template-input"
								/>
							</div>
						)}

						<div className="mt-3">
							<VSCodeCheckbox
								checked={messageSendingConfig.showTokenSavings}
								onChange={(e: any) =>
									setCachedStateField("messageSendingConfig", {
										...messageSendingConfig,
										showTokenSavings: e.target.checked,
									})
								}
								data-testid="show-token-savings-checkbox">
								{t("settings:messageSending.smartTemplate.showTokenSavings")}
							</VSCodeCheckbox>
						</div>
					</div>
				)}
			</Section>

			{/* 内容控制选项 */}
			<Section>
				<div className="flex items-center gap-2 mb-3">
					<Settings className="w-4" />
					<span className="font-medium">{t("settings:messageSending.contentControl.title")}</span>
				</div>

				<div className="space-y-3">
					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.includeSystemPrompt}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									includeSystemPrompt: e.target.checked,
								})
							}
							data-testid="include-system-prompt-checkbox">
							{t("settings:messageSending.contentControl.includeSystemPrompt")}
						</VSCodeCheckbox>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.includeConversationHistory}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									includeConversationHistory: e.target.checked,
								})
							}
							data-testid="include-conversation-history-checkbox">
							{t("settings:messageSending.contentControl.includeConversationHistory")}
						</VSCodeCheckbox>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.includeFileContext}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									includeFileContext: e.target.checked,
								})
							}
							data-testid="include-file-context-checkbox">
							{t("settings:messageSending.contentControl.includeFileContext")}
						</VSCodeCheckbox>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.includeCodeContext}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									includeCodeContext: e.target.checked,
								})
							}
							data-testid="include-code-context-checkbox">
							{t("settings:messageSending.contentControl.includeCodeContext")}
						</VSCodeCheckbox>
					</div>
				</div>
			</Section>

			{/* 历史消息管理 */}
			<Section>
				<div className="flex items-center gap-2 mb-3">
					<History className="w-4" />
					<span className="font-medium">{t("settings:messageSending.historyManagement.title")}</span>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:messageSending.historyManagement.maxMessages")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={50}
							step={1}
							value={[messageSendingConfig.maxHistoryMessages]}
							onValueChange={([value]) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									maxHistoryMessages: value,
								})
							}
							data-testid="max-history-messages-slider"
						/>
						<span className="w-10">{messageSendingConfig.maxHistoryMessages}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:messageSending.historyManagement.maxMessagesDescription")}
					</div>
				</div>

				<div className="mt-4">
					<VSCodeCheckbox
						checked={messageSendingConfig.enableHistoryCompression}
						onChange={(e: any) =>
							setCachedStateField("messageSendingConfig", {
								...messageSendingConfig,
								enableHistoryCompression: e.target.checked,
							})
						}
						data-testid="enable-history-compression-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:messageSending.historyManagement.enableCompression")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:messageSending.historyManagement.compressionDescription")}
					</div>
				</div>

				{messageSendingConfig.enableHistoryCompression && (
					<div className="pl-3 border-l-2 border-vscode-button-background">
						<span className="block font-medium mb-1">
							{t("settings:messageSending.historyManagement.compressionRatio")}
						</span>
						<div className="flex items-center gap-2">
							<Slider
								min={10}
								max={90}
								step={5}
								value={[messageSendingConfig.compressionRatio]}
								onValueChange={([value]) =>
									setCachedStateField("messageSendingConfig", {
										...messageSendingConfig,
										compressionRatio: value,
									})
								}
								data-testid="compression-ratio-slider"
							/>
							<span className="w-10">{messageSendingConfig.compressionRatio}%</span>
						</div>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:messageSending.historyManagement.compressionRatioDescription")}
						</div>
					</div>
				)}
			</Section>

			{/* 性能优化选项 */}
			<Section>
				<div className="flex items-center gap-2 mb-3">
					<Zap className="w-4" />
					<span className="font-medium">{t("settings:messageSending.performance.title")}</span>
				</div>

				<div className="space-y-3">
					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.enableContextCaching}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									enableContextCaching: e.target.checked,
								})
							}
							data-testid="enable-context-caching-checkbox">
							{t("settings:messageSending.performance.enableContextCaching")}
						</VSCodeCheckbox>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.enableImageOptimization}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									enableImageOptimization: e.target.checked,
								})
							}
							data-testid="enable-image-optimization-checkbox">
							{t("settings:messageSending.performance.enableImageOptimization")}
						</VSCodeCheckbox>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.enableTokenOptimization}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									enableTokenOptimization: e.target.checked,
								})
							}
							data-testid="enable-token-optimization-checkbox">
							{t("settings:messageSending.performance.enableTokenOptimization")}
						</VSCodeCheckbox>
					</div>
				</div>

				<div className="mt-4">
					<span className="block font-medium mb-1">
						{t("settings:messageSending.performance.maxTokensPerRequest")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1000}
							max={32000}
							step={1000}
							value={[messageSendingConfig.maxTokensPerRequest]}
							onValueChange={([value]) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									maxTokensPerRequest: value,
								})
							}
							data-testid="max-tokens-per-request-slider"
						/>
						<span className="w-16">{messageSendingConfig.maxTokensPerRequest}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:messageSending.performance.maxTokensDescription")}
					</div>
				</div>
			</Section>

			{/* 实时预览 */}
			<Section>
				<div className="flex items-center gap-2 mb-3">
					<MessageSquare className="w-4" />
					<span className="font-medium">{t("settings:messageSending.preview.title")}</span>
				</div>

				<div className="space-y-3">
					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.enableRealTimePreview}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									enableRealTimePreview: e.target.checked,
								})
							}
							data-testid="enable-real-time-preview-checkbox">
							{t("settings:messageSending.preview.enableRealTimePreview")}
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:messageSending.preview.previewDescription")}
						</div>
					</div>

					<div>
						<VSCodeCheckbox
							checked={messageSendingConfig.showEstimatedCost}
							onChange={(e: any) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									showEstimatedCost: e.target.checked,
								})
							}
							data-testid="show-estimated-cost-checkbox">
							{t("settings:messageSending.preview.showEstimatedCost")}
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:messageSending.preview.costDescription")}
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
