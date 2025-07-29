import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { McpTool } from "@roo/shared/mcp"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	serverSource?: "global" | "project"
	alwaysAllowMcp?: boolean
}

const McpToolRow = ({ tool, serverName, serverSource, alwaysAllowMcp }: McpToolRowProps) => {
	const { t } = useAppTranslation()
	const handleAlwaysAllowChange = () => {
		if (!serverName) return
		vscode.postMessage({
			type: "toggleToolAlwaysAllow",
			serverName,
			source: serverSource || "global",
			toolName: tool.name,
			alwaysAllow: !tool.alwaysAllow,
		})
	}

	return (
		<div
			key={tool.name}
			style={{
				padding: "3px 0",
				opacity: tool.disabled ? 0.6 : 1,
			}}>
			<div
				data-testid="tool-row-container"
				style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
				onClick={(e) => e.stopPropagation()}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span className="codicon codicon-symbol-method" style={{ marginRight: "6px" }}></span>
					<span style={{ fontWeight: 500 }}>{tool.name}</span>
				</div>
				<div style={{ display: "flex", alignItems: "center" }}>
					{serverName && alwaysAllowMcp && (
						<VSCodeCheckbox checked={tool.alwaysAllow} onChange={handleAlwaysAllowChange} data-tool={tool.name}>
							{t("mcp:tool.alwaysAllow")}
						</VSCodeCheckbox>
					)}
					{serverName && (
						<div
							role="switch"
							aria-checked={!tool.disabled}
							tabIndex={0}
							style={{
								width: "20px",
								height: "10px",
								backgroundColor: tool.disabled
									? "var(--vscode-titleBar-inactiveForeground)"
									: "var(--vscode-button-background)",
								borderRadius: "5px",
								position: "relative",
								cursor: "pointer",
								transition: "background-color 0.2s",
								opacity: tool.disabled ? 0.4 : 0.8,
								marginLeft: "10px"
							}}
							onClick={() => {
								vscode.postMessage({
									type: "toggleMcpTool",
									serverName: serverName,
									source: serverSource || "global",
									toolName: tool.name,
									disabled: !tool.disabled
								})
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault()
									vscode.postMessage({
										type: "toggleMcpTool",
										serverName: serverName,
										source: serverSource || "global",
										toolName: tool.name,
										disabled: !tool.disabled
									})
								}
							}}>
							<div
								style={{
									width: "6px",
									height: "6px",
									backgroundColor: "var(--vscode-titleBar-activeForeground)",
									borderRadius: "50%",
									position: "absolute",
									top: "2px",
									left: tool.disabled ? "2px" : "12px",
									transition: "left 0.2s",
								}}
							/>
						</div>
					)}
				</div>
			</div>
			{tool.description && (
				<div
					style={{
						marginLeft: "0px",
						marginTop: "4px",
						opacity: 0.8,
						fontSize: "12px",
					}}>
					{tool.description}
				</div>
			)}
			{tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div
						style={{
							marginTop: "8px",
							fontSize: "12px",
							border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent)",
							borderRadius: "3px",
							padding: "8px",
						}}>
						<div
							style={{ marginBottom: "4px", opacity: 0.8, fontSize: "11px", textTransform: "uppercase" }}>
							{t("mcp:tool.parameters")}
						</div>
						{Object.entries(tool.inputSchema.properties as Record<string, any>).map(
							([paramName, schema]) => {
								const isRequired =
									tool.inputSchema &&
									"required" in tool.inputSchema &&
									Array.isArray(tool.inputSchema.required) &&
									tool.inputSchema.required.includes(paramName)

								return (
									<div
										key={paramName}
										style={{
											display: "flex",
											alignItems: "baseline",
											marginTop: "4px",
										}}>
										<code
											style={{
												color: "var(--vscode-textPreformat-foreground)",
												marginRight: "8px",
											}}>
											{paramName}
											{isRequired && (
												<span style={{ color: "var(--vscode-errorForeground)" }}>*</span>
											)}
										</code>
										<span
											style={{
												opacity: 0.8,
												overflowWrap: "break-word",
												wordBreak: "break-word",
											}}>
											{schema.description || t("mcp:tool.noDescription")}
										</span>
									</div>
								)
							},
						)}
					</div>
				)}
		</div>
	)
}

export default McpToolRow
