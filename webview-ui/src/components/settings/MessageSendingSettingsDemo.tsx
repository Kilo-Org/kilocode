import React, { useState } from "react"
import { MessageSendingSettings } from "./MessageSendingSettings"
import { MessageSendingConfig } from "./MessageSendingConfig"

// 默认配置
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

/**
 * 消息发送设置演示组件
 * 用于展示MessageSendingSettings组件的效果
 */
export const MessageSendingSettingsDemo = () => {
	const [config, setConfig] = useState<MessageSendingConfig>(defaultConfig)

	// 模拟 SetCachedStateField 函数
	const setCachedStateField = (_field: "messageSendingConfig", value: MessageSendingConfig) => {
		setConfig(value)
	}

	return (
		<div className="min-h-screen bg-vscode-editor-background text-vscode-editor-foreground">
			<div className="max-w-4xl mx-auto p-6">
				<div className="mb-6">
					<h1 className="text-2xl font-bold mb-2">消息发送优化配置</h1>
					<p className="text-vscode-descriptionForeground">
						这是新增的消息发送配置页面，可以帮助用户优化消息发送机制，减少Token使用量，提升响应速度。
					</p>
				</div>

				<MessageSendingSettings
					messageSendingConfig={config}
					setCachedStateField={setCachedStateField}
					className="bg-vscode-sideBar-background border border-vscode-panel-border rounded-lg"
				/>

				{/* 配置预览 */}
				<div className="mt-6 p-4 bg-vscode-editor-background border border-vscode-input-border rounded-lg">
					<h3 className="text-lg font-medium mb-3">当前配置预览</h3>
					<pre className="text-sm text-vscode-descriptionForeground overflow-auto">
						{JSON.stringify(config, null, 2)}
					</pre>
				</div>

				{/* 功能说明 */}
				<div className="mt-6 p-4 bg-vscode-editor-background border border-vscode-input-border rounded-lg">
					<h3 className="text-lg font-medium mb-3">主要功能</h3>
					<ul className="space-y-2 text-vscode-descriptionForeground">
						<li>
							• <strong>预设模板</strong>：提供最小化、标准、完整三种预设模板，快速配置
						</li>
						<li>
							• <strong>内容控制</strong>：可选择性包含系统提示词、对话历史、环境详情等内容
						</li>
						<li>
							• <strong>历史管理</strong>：限制历史消息数量，支持自动压缩
						</li>
						<li>
							• <strong>性能优化</strong>：启用上下文缓存、图片优化、Token优化等功能
						</li>
						<li>
							• <strong>实时预估</strong>：显示Token节省百分比，帮助用户了解优化效果
						</li>
					</ul>
				</div>
			</div>
		</div>
	)
}

export default MessageSendingSettingsDemo
