import { useState, useEffect, useCallback, useMemo } from "react"
import { useEvent } from "react-use"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { RefreshCw, Loader2, FileCode } from "lucide-react"

import type { SerializedCustomToolDefinition } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"

import { vscode } from "@/utils/vscode"

import { Button } from "@/components/ui"

interface ToolParameter {
	name: string
	type: string
	description?: string
	required: boolean
}

interface ProcessedTool {
	name: string
	description: string
	parameters: ToolParameter[]
	source?: string
}

interface CustomToolsSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
}

export const CustomToolsSettings = ({ enabled, onChange }: CustomToolsSettingsProps) => {
	const { t } = useAppTranslation()
	const [tools, setTools] = useState<SerializedCustomToolDefinition[]>([])
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [refreshError, setRefreshError] = useState<string | null>(null)

	useEffect(() => {
		if (enabled) {
			vscode.postMessage({ type: "refreshCustomTools" })
		} else {
			setTools([])
		}
	}, [enabled])

	useEvent("message", (event: MessageEvent) => {
		const message = event.data

		if (message.type === "customToolsResult") {
			setTools(message.tools || [])
			setIsRefreshing(false)
			setRefreshError(message.error ?? null)
		}
	})

	const onRefresh = useCallback(() => {
		setIsRefreshing(true)
		setRefreshError(null)
		vscode.postMessage({ type: "refreshCustomTools" })
	}, [])

	const processedTools = useMemo<ProcessedTool[]>(
		() =>
			tools.map((tool) => {
				const params = tool.parameters
				const properties = (params?.properties ?? {}) as Record<string, { type?: string; description?: string }>
				const required = (params?.required as string[] | undefined) ?? []

				return {
					name: tool.name,
					description: tool.description,
					source: tool.source,
					parameters: Object.entries(properties).map(([name, def]) => ({
						name,
						type: def.type ?? "any",
						description: def.description,
						required: required.includes(name),
					})),
				}
			}),
		[tools],
	)

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.CUSTOM_TOOLS.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.CUSTOM_TOOLS.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					<div className="flex items-center justify-between gap-4">
						<label className="block font-medium">
							{t("settings:experimental.CUSTOM_TOOLS.toolsHeader")}
						</label>
						<Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
							<div className="flex items-center gap-2">
								{isRefreshing ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : (
									<RefreshCw className="w-4 h-4" />
								)}
								{isRefreshing
									? t("settings:experimental.CUSTOM_TOOLS.refreshing")
									: t("settings:experimental.CUSTOM_TOOLS.refreshButton")}
							</div>
						</Button>
					</div>

					{refreshError && (
						<div className="p-2 bg-vscode-inputValidation-errorBackground text-vscode-errorForeground rounded text-sm border border-vscode-inputValidation-errorBorder">
							{t("settings:experimental.CUSTOM_TOOLS.refreshError")}: {refreshError}
						</div>
					)}

					{processedTools.length === 0 ? (
						<p className="text-vscode-descriptionForeground text-sm italic">
							{t("settings:experimental.CUSTOM_TOOLS.noTools")}
						</p>
					) : (
						processedTools.map((tool) => (
							<div
								key={tool.name}
								className="bg-vscode-editor-background border border-vscode-panel-border rounded space-y-3 p-3">
								<div className="space-y-1">
									<div className="font-medium text-vscode-foreground">{tool.name}</div>
									{tool.source && (
										<div className="flex items-center text-xs text-vscode-descriptionForeground">
											<FileCode className="size-3 flex-shrink-0" />
											<span className="font-mono truncate" title={tool.source}>
												{tool.source}
											</span>
										</div>
									)}
								</div>
								<div className="text-vscode-descriptionForeground text-sm">{tool.description}</div>
								{tool.parameters.length > 0 && (
									<div className="space-y-1">
										<div className="text-xs font-medium text-vscode-foreground">
											{t("settings:experimental.CUSTOM_TOOLS.toolParameters")}:
										</div>
										<div>
											{tool.parameters.map((param) => (
												<div
													key={param.name}
													className="flex items-start gap-2 text-xs pl-2 py-1 border-l-2 border-vscode-panel-border">
													<code className="text-vscode-textLink-foreground font-mono">
														{param.name}
													</code>
													<span className="text-vscode-descriptionForeground">
														({param.type})
													</span>
													{param.required && (
														<span className="text-vscode-errorForeground text-[10px] uppercase">
															required
														</span>
													)}
													{param.description && (
														<span className="text-vscode-descriptionForeground">
															— {param.description}
														</span>
													)}
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						))
					)}
				</div>
			)}
		</div>
	)
}
