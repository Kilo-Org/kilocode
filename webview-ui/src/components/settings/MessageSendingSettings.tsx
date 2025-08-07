import { HTMLAttributes } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { MessageSquare, Zap, History, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { MessageSendingConfig } from "@roo-code/types"
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

			<div className="space-y-6">
				<div className="text-sm text-vscode-descriptionForeground">
					配置消息发送的各项参数，包括智能模板、内容控制、历史管理、性能优化和实时预览等功能。合理的配置可以显著提升AI响应质量，同时有效控制Token使用量和API成本。建议根据具体使用场景和预算需求进行个性化调整。
				</div>
			</div>

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
						启用智能模板功能，系统会根据消息类型和上下文自动选择最优模板。可以显著提高响应质量并减少Token使用量，同时确保消息格式的一致性和专业性。关闭后将使用默认的消息格式。
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
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								选择适合的消息模板类型。平衡模式在质量和性能间取得最佳平衡；性能优先模式减少Token使用量，提高响应速度；质量优先模式提供最详细的分析和建议；最小化模式仅包含核心信息；自定义模式允许使用个人定制的格式。
							</div>
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
								<div className="text-vscode-descriptionForeground text-sm mt-1">
									输入自定义的消息模板格式。可以使用变量占位符如 {"{user_input}"}、{"{context}"}、
									{"{history}"} 等来动态插入内容。模板应该简洁明了，避免冗余信息以优化Token使用效率。
								</div>
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
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								显示智能模板相比默认格式节省的Token数量和成本。启用后可以实时查看优化效果，了解不同模板的效率差异，帮助选择最适合的模板类型并监控成本节省情况。
							</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							在消息中包含系统级别的提示词。启用后可以提供更准确的上下文信息，但会增加Token使用量。适用于需要特定行为指导的场景。
						</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							在新消息中包含之前的对话记录。启用后AI可以更好地理解上下文和连续性，但会显著增加Token消耗。建议在需要上下文连贯性的长对话中启用。
						</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							在消息中包含当前打开文件的相关信息。启用后AI可以更好地理解代码结构和文件关系，提供更精准的建议，但会增加Token使用量。
						</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							在消息中包含相关的代码片段和函数定义。启用后可以获得更准确的代码分析和建议，但会大幅增加Token消耗。推荐在代码审查和调试时启用。
						</div>
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
							value={[messageSendingConfig.maxHistoryMessages ?? 10]}
							onValueChange={([value]) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									maxHistoryMessages: value,
								})
							}
							data-testid="max-history-messages-slider"
						/>
						<span className="w-10">{messageSendingConfig.maxHistoryMessages ?? 10}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						设置包含在新消息中的历史消息数量上限。较少的消息数（1-10）可以降低Token消耗和成本，但可能丢失重要上下文；较多的消息数（20-50）能保持完整的对话连贯性，但会显著增加Token使用量和响应时间。
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
						对历史消息进行智能压缩以减少Token使用量。启用后系统会自动总结和精简历史对话内容，保留关键信息的同时大幅降低Token消耗，特别适合长对话场景。可能会丢失部分细节信息。
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
								value={[messageSendingConfig.compressionRatio ?? 50]}
								onValueChange={([value]) =>
									setCachedStateField("messageSendingConfig", {
										...messageSendingConfig,
										compressionRatio: value,
									})
								}
								data-testid="compression-ratio-slider"
							/>
							<span className="w-10">{messageSendingConfig.compressionRatio ?? 50}%</span>
						</div>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							设置历史消息的压缩程度。较低的比例（10%-30%）会进行更激进的压缩，大幅减少Token但可能丢失更多细节；较高的比例（60%-90%）保留更多原始信息，压缩效果有限但信息完整性更好。
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							启用上下文缓存以提高响应速度和降低成本。系统会缓存常用的上下文信息，减少重复处理，显著提升连续对话的响应速度，同时降低API调用成本。
						</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							自动优化图片大小和格式以减少传输成本。启用后系统会压缩图片、调整分辨率并选择最优格式，在保持视觉质量的同时大幅降低Token消耗和传输时间。
						</div>
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
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							启用智能Token优化算法。系统会自动分析和精简消息内容，移除冗余信息，优化文本结构，在保持语义完整性的前提下最大化减少Token使用量，有效控制API成本。
						</div>
					</div>
				</div>

				<div className="mt-4">
					<span className="block font-medium mb-1">
						{t("settings:messageSending.performance.maxTokensPerRequest")} (
						{(messageSendingConfig.maxTokensPerRequest ?? 4000).toLocaleString()})
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1000}
							max={32000}
							step={1000}
							value={[messageSendingConfig.maxTokensPerRequest ?? 4000]}
							onValueChange={([value]) =>
								setCachedStateField("messageSendingConfig", {
									...messageSendingConfig,
									maxTokensPerRequest: value,
								})
							}
							data-testid="max-tokens-per-request-slider"
						/>
						<span className="w-16">{messageSendingConfig.maxTokensPerRequest ?? 4000}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						设置单次请求的最大Token限制。较低的值（1000-4000）适合简单问答，成本低但可能截断复杂内容；较高的值（8000-32000）适合复杂分析，功能完整但成本较高。建议根据使用场景和预算进行调整。
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
							在发送前实时预览消息内容和结构。启用后可以在发送前查看完整的消息内容、Token数量和预估成本，帮助优化消息质量并控制费用。特别适合复杂查询和成本敏感的使用场景。
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
							显示基于Token使用量的预估API成本。启用后可以实时了解每次请求的大概费用，帮助合理控制使用成本并优化消息内容。成本计算基于当前模型的定价，有助于预算管理和成本优化。
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
