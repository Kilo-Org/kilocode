import React, { useState, useEffect } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { vscode } from "@src/utils/vscode"

interface ApiRequestModalProps {
	isOpen: boolean
	onClose: () => void
	messageText: string
	messageId: string
}

interface ApiDataRecord {
	id?: number
	messageId: string
	taskId: string
	requestData?: string
	responseData?: string
	createdAt: string
	updatedAt: string
}

export const ApiRequestModal: React.FC<ApiRequestModalProps> = ({ isOpen, onClose, messageText, messageId }) => {
	const [activeTab, setActiveTab] = useState<"request" | "response">("request")
	const [apiData, setApiData] = useState<ApiDataRecord | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { copyWithFeedback, showCopyFeedback } = useCopyToClipboard()

	// 尝试从ApiDataStorage获取完整数据
	useEffect(() => {
		if (isOpen && messageId) {
			setLoading(true)
			setError(null)
			setApiData(null)
			console.log(`Requesting API data for messageId: ${messageId}`)
			vscode.postMessage({
				type: "getApiData",
				messageId: messageId,
			})
		}
	}, [isOpen, messageId])

	// 监听来自后端的API数据响应
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "apiDataResponse") {
				console.log("Received apiDataResponse:", message)
				setLoading(false)

				if (message.error) {
					console.error("API data error:", message.error)
					setError(message.error)
					setApiData(null)
				} else {
					setApiData(message.apiData)
					setError(null)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	if (!isOpen) return null

	// 解析数据：优先使用ApiDataStorage的数据，回退到messageText
	let requestData: any = null
	let responseData: any = null

	if (apiData) {
		// 使用ApiDataStorage的数据
		if (apiData.requestData) {
			try {
				requestData = JSON.parse(apiData.requestData)
			} catch (e) {
				console.error("Failed to parse request data:", e)
			}
		}
		if (apiData.responseData) {
			try {
				responseData = JSON.parse(apiData.responseData)
			} catch (e) {
				console.error("Failed to parse response data:", e)
			}
		}
	} else {
		// 回退到messageText解析
		const parsedData = safeJsonParse<any>(messageText)
		requestData = parsedData?.request
		responseData = parsedData?.response
	}

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onClose()
		}
	}

	return (
		<div
			style={{
				position: "fixed",
				top: "100px",
				left: "70px",
				right: "70px",
				bottom: "100px",
				backgroundColor: "rgba(0, 0, 0, 0.5)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 1000,
			}}
			onClick={handleBackdropClick}>
			<div
				style={{
					backgroundColor: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-editorGroup-border)",
					borderRadius: "8px",
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
				onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "16px",
						borderBottom: "1px solid var(--vscode-editorGroup-border)",
					}}>
					<h3 style={{ margin: 0, color: "var(--vscode-foreground)" }}>API 请求详情</h3>
					<VSCodeButton appearance="icon" onClick={onClose} title="关闭">
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>

				{/* Tabs */}
				<div
					style={{
						display: "flex",
						borderBottom: "1px solid var(--vscode-editorGroup-border)",
					}}>
					<button
						style={{
							padding: "12px 24px",
							border: "none",
							background: activeTab === "request" ? "var(--vscode-tab-activeBackground)" : "transparent",
							color:
								activeTab === "request"
									? "var(--vscode-tab-activeForeground)"
									: "var(--vscode-tab-inactiveForeground)",
							cursor: "pointer",
							borderBottom:
								activeTab === "request"
									? "2px solid var(--vscode-focusBorder)"
									: "2px solid transparent",
						}}
						onClick={() => setActiveTab("request")}>
						请求信息
					</button>
					<button
						style={{
							padding: "12px 24px",
							border: "none",
							background: activeTab === "response" ? "var(--vscode-tab-activeBackground)" : "transparent",
							color:
								activeTab === "response"
									? "var(--vscode-tab-activeForeground)"
									: "var(--vscode-tab-inactiveForeground)",
							cursor: "pointer",
							borderBottom:
								activeTab === "response"
									? "2px solid var(--vscode-focusBorder)"
									: "2px solid transparent",
						}}
						onClick={() => setActiveTab("response")}>
						响应信息
					</button>
				</div>

				{/* Content */}
				<div style={{ flex: 1, overflow: "auto", padding: "16px", maxHeight: "calc(100% - 120px)" }}>
					{loading && (
						<div
							style={{
								color: "var(--vscode-descriptionForeground)",
								textAlign: "center",
								padding: "40px",
							}}>
							正在加载API数据...
						</div>
					)}

					{error && (
						<div
							style={{
								color: "var(--vscode-errorForeground)",
								textAlign: "center",
								padding: "40px",
								border: "1px solid var(--vscode-inputValidation-errorBorder)",
								backgroundColor: "var(--vscode-inputValidation-errorBackground)",
								borderRadius: "4px",
								margin: "16px 0",
							}}>
							<div style={{ fontWeight: "bold", marginBottom: "8px" }}>加载API数据失败</div>
							<div>{error}</div>
						</div>
					)}

					{!loading && !error && activeTab === "request" && (
						<div>
							{requestData ? (
								<div>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											marginBottom: "12px",
										}}>
										<span style={{ fontWeight: "bold", color: "var(--vscode-foreground)" }}>
											请求详情:
										</span>
										<VSCodeButton
											appearance="icon"
											onClick={() => copyWithFeedback(JSON.stringify(requestData, null, 2))}
											title={showCopyFeedback ? "已复制!" : "复制请求信息"}>
											<span
												className={`codicon ${showCopyFeedback ? "codicon-check" : "codicon-copy"}`}></span>
										</VSCodeButton>
									</div>
									<pre
										style={{
											backgroundColor: "var(--vscode-textCodeBlock-background)",
											padding: "12px",
											borderRadius: "4px",
											overflow: "auto",
											maxHeight: "400px",
											fontFamily: "var(--vscode-editor-font-family)",
											fontSize: "var(--vscode-editor-font-size)",
											color: "var(--vscode-foreground)",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
											margin: 0,
										}}>
										{JSON.stringify(requestData, null, 2)}
									</pre>
								</div>
							) : (
								<div
									style={{
										color: "var(--vscode-descriptionForeground)",
										textAlign: "center",
										padding: "40px",
									}}>
									暂无请求信息
								</div>
							)}
						</div>
					)}

					{!loading && !error && activeTab === "response" && (
						<div>
							{responseData ? (
								<div>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											marginBottom: "12px",
										}}>
										<span style={{ fontWeight: "bold", color: "var(--vscode-foreground)" }}>
											响应详情:
										</span>
										<VSCodeButton
											appearance="icon"
											onClick={() => copyWithFeedback(JSON.stringify(responseData, null, 2))}
											title={showCopyFeedback ? "已复制!" : "复制响应信息"}>
											<span
												className={`codicon ${showCopyFeedback ? "codicon-check" : "codicon-copy"}`}></span>
										</VSCodeButton>
									</div>
									<pre
										style={{
											backgroundColor: "var(--vscode-textCodeBlock-background)",
											padding: "12px",
											borderRadius: "4px",
											overflow: "auto",
											maxHeight: "400px",
											fontFamily: "var(--vscode-editor-font-family)",
											fontSize: "var(--vscode-editor-font-size)",
											color: "var(--vscode-foreground)",
											whiteSpace: "pre-wrap",
											wordBreak: "break-word",
											margin: 0,
										}}>
										{JSON.stringify(responseData, null, 2)}
									</pre>
								</div>
							) : (
								<div
									style={{
										color: "var(--vscode-descriptionForeground)",
										textAlign: "center",
										padding: "40px",
									}}>
									暂无响应信息
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
