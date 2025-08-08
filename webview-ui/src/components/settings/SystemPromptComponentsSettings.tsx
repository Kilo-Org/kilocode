import React, { useState, useEffect } from "react"
import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@src/components/ui"
import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import { Settings, FileText, Eye } from "lucide-react"

// 系统提示词组件类型
type SystemPromptComponentType =
	| "roleDefinition"
	| "toolUse"
	| "rules"
	| "systemInfo"
	| "capabilities"
	| "modes"
	| "objective"
	| "customInstructions"
	| "markdownFormatting"
	| "mcpServers"

// 组件配置
type SystemPromptComponentConfig = {
	type: "default" | "custom"
	customPath?: string
}

// 所有组件的配置
type SystemPromptComponentsConfig = {
	[K in SystemPromptComponentType]: SystemPromptComponentConfig
}

// 默认配置
const defaultConfig: SystemPromptComponentsConfig = {
	roleDefinition: { type: "default" },
	toolUse: { type: "default" },
	rules: { type: "default" },
	systemInfo: { type: "default" },
	capabilities: { type: "default" },
	modes: { type: "default" },
	objective: { type: "default" },
	customInstructions: { type: "default" },
	markdownFormatting: { type: "default" },
	mcpServers: { type: "default" },
}

// 组件标签映射
const componentLabels: Record<SystemPromptComponentType, string> = {
	roleDefinition: "角色定义",
	toolUse: "工具使用说明",
	rules: "规则",
	systemInfo: "系统信息",
	capabilities: "能力说明",
	modes: "模式说明",
	objective: "目标说明",
	customInstructions: "自定义指令",
	markdownFormatting: "Markdown格式化",
	mcpServers: "MCP服务器",
}

// 组件描述映射
const componentDescriptions: Record<SystemPromptComponentType, string> = {
	roleDefinition: "定义AI助手的角色和基本行为",
	toolUse: "说明如何使用各种工具",
	rules: "定义代码编写和行为规则",
	systemInfo: "提供系统环境信息",
	capabilities: "说明AI助手的能力范围",
	modes: "说明不同工作模式",
	objective: "定义任务目标和期望",
	customInstructions: "用户自定义的额外指令",
	markdownFormatting: "定义Markdown格式化规则",
	mcpServers: "配置MCP服务器相关信息",
}

interface SystemPromptComponentsSettingsProps {
	config?: SystemPromptComponentsConfig
	onConfigChange?: (config: SystemPromptComponentsConfig) => void
}

const SystemPromptComponentsSettings = ({
	config = defaultConfig,
	onConfigChange,
}: SystemPromptComponentsSettingsProps) => {
	const { t: _t } = useAppTranslation()
	const [activeComponent, setActiveComponent] = useState<SystemPromptComponentType>("roleDefinition")
	const [previewContent, setPreviewContent] = useState<string>("")
	const [isLoadingPreview, setIsLoadingPreview] = useState(false)
	const [editContent, setEditContent] = useState<string>("")
	const [isEditing, setIsEditing] = useState(false)

	// 获取组件的默认文件路径
	const getDefaultPath = (componentType: SystemPromptComponentType): string => {
		return `.kilo/prompt/${componentType}.md`
	}

	// 获取组件的实际文件路径
	const _getComponentPath = (componentType: SystemPromptComponentType): string => {
		const componentConfig = config[componentType]
		return componentConfig.customPath || getDefaultPath(componentType)
	}

	// 更新组件配置
	const updateComponentConfig = (
		componentType: SystemPromptComponentType,
		newConfig: SystemPromptComponentConfig,
	) => {
		const updatedConfig = {
			...config,
			[componentType]: newConfig,
		}
		onConfigChange?.(updatedConfig)

		// 发送消息到扩展
		vscode.postMessage({
			type: "updateSystemPromptComponentConfig",
			componentType,
			config: newConfig,
		})
	}

	// 预览组件内容
	const previewComponent = async (componentType: SystemPromptComponentType) => {
		setIsLoadingPreview(true)
		try {
			vscode.postMessage({
				type: "previewSystemPromptComponent",
				componentType,
			})
		} catch (error) {
			console.error("Error previewing component:", error)
			setIsLoadingPreview(false)
		}
	}

	// 编辑组件内容
	const editComponent = async (componentType: SystemPromptComponentType) => {
		setIsEditing(true)
		try {
			vscode.postMessage({
				type: "editSystemPromptComponent",
				componentType,
			})
		} catch (error) {
			console.error("Error editing component:", error)
			setIsEditing(false)
		}
	}

	// 保存编辑内容
	const saveEditContent = () => {
		vscode.postMessage({
			type: "saveSystemPromptComponent",
			componentType: activeComponent,
			content: editContent,
		})
		setIsEditing(false)
		setEditContent("")
	}

	// 监听来自扩展的消息
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			switch (message.type) {
				case "systemPromptComponentPreview":
					setPreviewContent(message.content || "")
					setIsLoadingPreview(false)
					break
				case "systemPromptComponentEdit":
					setEditContent(message.content || "")
					setIsEditing(true)
					break
				case "systemPromptComponentSaved":
					// 保存成功后重新预览
					previewComponent(activeComponent)
					break
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [activeComponent])

	// 当活动组件改变时，自动预览
	useEffect(() => {
		previewComponent(activeComponent)
	}, [activeComponent])

	const currentConfig = config[activeComponent]

	return (
		<div>
			<SectionHeader description="配置系统提示词的各个组成部分，可以选择使用默认或自定义版本">
				<div className="flex items-center gap-2">
					<Settings className="w-4" />
					<div>系统提示词组件配置</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<Select
						value={activeComponent}
						onValueChange={(value) => setActiveComponent(value as SystemPromptComponentType)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="选择组件" />
						</SelectTrigger>
						<SelectContent>
							{Object.keys(componentLabels).map((type) => (
								<SelectItem key={type} value={type}>
									{componentLabels[type as SystemPromptComponentType]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{componentDescriptions[activeComponent]}
					</div>
				</div>

				<div className="mt-4">
					<div className="flex justify-between items-center mb-2">
						<label className="block font-medium">配置类型</label>
					</div>

					<Select
						value={currentConfig.type}
						onValueChange={(value) => {
							updateComponentConfig(activeComponent, {
								...currentConfig,
								type: value as "default" | "custom",
							})
						}}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="default">使用默认</SelectItem>
							<SelectItem value="custom">使用自定义</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{currentConfig.type === "custom" && (
					<div className="mt-4">
						<label className="block font-medium mb-2">自定义文件路径</label>
						<input
							type="text"
							value={currentConfig.customPath || getDefaultPath(activeComponent)}
							onChange={(e) => {
								updateComponentConfig(activeComponent, {
									...currentConfig,
									customPath: e.target.value,
								})
							}}
							placeholder={getDefaultPath(activeComponent)}
							className="w-full px-3 py-2 border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground rounded"
						/>
						<div className="text-sm text-vscode-descriptionForeground mt-1">
							相对于项目根目录的路径，默认为 {getDefaultPath(activeComponent)}
						</div>
					</div>
				)}

				<div className="mt-4">
					<div className="flex gap-2 mb-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => previewComponent(activeComponent)}
							disabled={isLoadingPreview}>
							<Eye className="w-4 h-4 mr-1" />
							{isLoadingPreview ? "加载中..." : "预览内容"}
						</Button>

						{currentConfig.type === "custom" && (
							<Button variant="outline" size="sm" onClick={() => editComponent(activeComponent)}>
								<FileText className="w-4 h-4 mr-1" />
								编辑文件
							</Button>
						)}
					</div>

					{/* 预览内容 */}
					{previewContent && (
						<div className="mt-2">
							<label className="block font-medium mb-1">当前内容预览</label>
							<VSCodeTextArea
								resize="vertical"
								value={previewContent}
								readOnly
								rows={8}
								className="w-full"
							/>
						</div>
					)}

					{/* 编辑内容 */}
					{isEditing && (
						<div className="mt-2">
							<label className="block font-medium mb-1">编辑内容</label>
							<VSCodeTextArea
								resize="vertical"
								value={editContent}
								onChange={(e) => setEditContent((e.target as HTMLTextAreaElement).value)}
								rows={8}
								className="w-full"
							/>
							<div className="flex gap-2 mt-2">
								<Button variant="default" size="sm" onClick={saveEditContent}>
									保存
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setIsEditing(false)
										setEditContent("")
									}}>
									取消
								</Button>
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default SystemPromptComponentsSettings
