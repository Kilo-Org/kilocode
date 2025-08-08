import React, { useState, useEffect, useRef } from "react"
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

	// 拖动相关状态
	const [position, setPosition] = useState({ x: 70, y: 100 })
	const [isDragging, setIsDragging] = useState(false)
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
	const modalRef = useRef<HTMLDivElement>(null)

	// 计算初始尺寸：当前视口减去边距
	const getInitialSize = () => {
		const viewportWidth = window.innerWidth
		const viewportHeight = window.innerHeight
		return {
			width: Math.max(300, viewportWidth - 140), // 左右边距70px * 2
			height: Math.max(300, viewportHeight - 200), // 上下边距100px * 2
		}
	}

	// 尺寸调整相关状态
	const [size, setSize] = useState(getInitialSize)
	const [isResizing, setIsResizing] = useState(false)
	const [resizeDirection, setResizeDirection] = useState<"se" | "sw" | "ne" | "nw" | "n" | "s" | "e" | "w" | null>(
		null,
	)
	const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 })

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

	// 拖动事件处理
	const handleMouseDown = (e: React.MouseEvent) => {
		setIsDragging(true)
		setDragStart({
			x: e.clientX - position.x,
			y: e.clientY - position.y,
		})
	}

	// 尺寸调整事件处理
	const handleResizeMouseDown = (
		e: React.MouseEvent,
		direction: "se" | "sw" | "ne" | "nw" | "n" | "s" | "e" | "w",
	) => {
		e.stopPropagation()
		setIsResizing(true)
		setResizeDirection(direction)
		setResizeStart({
			x: e.clientX,
			y: e.clientY,
			width: size.width,
			height: size.height,
			posX: position.x,
			posY: position.y,
		})
	}

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (isDragging) {
				const newX = e.clientX - dragStart.x
				const newY = e.clientY - dragStart.y

				// 限制拖动范围，确保窗口不会完全移出视口
				const maxX = window.innerWidth - 200 // 至少保留200px可见
				const maxY = window.innerHeight - 100 // 至少保留100px可见

				setPosition({
					x: Math.max(0, Math.min(newX, maxX)),
					y: Math.max(0, Math.min(newY, maxY)),
				})
			}

			if (isResizing && resizeDirection) {
				const deltaX = e.clientX - resizeStart.x
				const deltaY = e.clientY - resizeStart.y

				let newWidth = resizeStart.width
				let newHeight = resizeStart.height
				let newX = resizeStart.posX
				let newY = resizeStart.posY

				switch (resizeDirection) {
					case "se": // 右下角
						newWidth = Math.max(300, Math.min(window.innerWidth - position.x, resizeStart.width + deltaX))
						newHeight = Math.max(
							300,
							Math.min(window.innerHeight - position.y, resizeStart.height + deltaY),
						)
						break
					case "sw": // 左下角
						newWidth = Math.max(300, resizeStart.width - deltaX)
						newHeight = Math.max(
							300,
							Math.min(window.innerHeight - position.y, resizeStart.height + deltaY),
						)
						newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 300)
						break
					case "ne": // 右上角
						newWidth = Math.max(300, Math.min(window.innerWidth - position.x, resizeStart.width + deltaX))
						newHeight = Math.max(300, resizeStart.height - deltaY)
						newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 300)
						break
					case "nw": // 左上角
						newWidth = Math.max(300, resizeStart.width - deltaX)
						newHeight = Math.max(300, resizeStart.height - deltaY)
						newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 300)
						newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 300)
						break
					case "n": // 上边
						newHeight = Math.max(300, resizeStart.height - deltaY)
						newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 300)
						break
					case "s": // 下边
						newHeight = Math.max(
							300,
							Math.min(window.innerHeight - position.y, resizeStart.height + deltaY),
						)
						break
					case "e": // 右边
						newWidth = Math.max(300, Math.min(window.innerWidth - position.x, resizeStart.width + deltaX))
						break
					case "w": // 左边
						newWidth = Math.max(300, resizeStart.width - deltaX)
						newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 300)
						break
				}

				// 确保窗口不会超出视口边界
				newX = Math.max(0, Math.min(newX, window.innerWidth - newWidth))
				newY = Math.max(0, Math.min(newY, window.innerHeight - newHeight))

				setSize({ width: newWidth, height: newHeight })
				if (resizeDirection === "sw" || resizeDirection === "nw" || resizeDirection === "w") {
					setPosition((prev) => ({ ...prev, x: newX }))
				}
				if (resizeDirection === "ne" || resizeDirection === "nw" || resizeDirection === "n") {
					setPosition((prev) => ({ ...prev, y: newY }))
				}
			}
		}

		const handleMouseUp = () => {
			setIsDragging(false)
			setIsResizing(false)
			setResizeDirection(null)
		}

		if (isDragging || isResizing) {
			document.addEventListener("mousemove", handleMouseMove)
			document.addEventListener("mouseup", handleMouseUp)

			return () => {
				document.removeEventListener("mousemove", handleMouseMove)
				document.removeEventListener("mouseup", handleMouseUp)
			}
		}
	}, [isDragging, isResizing, dragStart, resizeStart, position, size, resizeDirection])

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

	// 移除点击背景关闭功能，只能通过关闭按钮关闭
	// const handleBackdropClick = (e: React.MouseEvent) => {
	// 	if (e.target === e.currentTarget) {
	// 		onClose()
	// 	}
	// }

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				backgroundColor: "rgba(0, 0, 0, 0.5)",
				zIndex: 999999,
			}}>
			<div
				ref={modalRef}
				style={{
					position: "absolute",
					top: `${position.y}px`,
					left: `${position.x}px`,
					width: `${size.width}px`,
					height: `${size.height}px`,
					backgroundColor: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-editorGroup-border)",
					borderRadius: "8px",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
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
						cursor: isDragging ? "grabbing" : "grab",
						userSelect: "none",
					}}
					onMouseDown={handleMouseDown}>
					<h3 style={{ margin: 0, color: "var(--vscode-foreground)", pointerEvents: "none" }}>
						API 请求详情
					</h3>
					<VSCodeButton
						appearance="icon"
						onClick={(e) => {
							e.stopPropagation()
							onClose()
						}}
						title="关闭"
						style={{ pointerEvents: "auto" }}>
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

				{/* Resize Handles - 四个角和四条边 */}
				{/* 右下角 */}
				<div
					style={{
						position: "absolute",
						bottom: 0,
						right: 0,
						width: "20px",
						height: "20px",
						cursor: "nw-resize",
						backgroundImage: `linear-gradient(-45deg, transparent 0%, transparent 30%, var(--vscode-editorGroup-border) 30%, var(--vscode-editorGroup-border) 35%, transparent 35%, transparent 65%, var(--vscode-editorGroup-border) 65%, var(--vscode-editorGroup-border) 70%, transparent 70%)`,
						backgroundSize: "8px 8px",
						backgroundRepeat: "repeat",
						borderBottomRightRadius: "8px",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "se")}
					title="拖动调整窗口大小"
				/>

				{/* 左下角 */}
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						width: "20px",
						height: "20px",
						cursor: "ne-resize",
						backgroundImage: `linear-gradient(45deg, transparent 0%, transparent 30%, var(--vscode-editorGroup-border) 30%, var(--vscode-editorGroup-border) 35%, transparent 35%, transparent 65%, var(--vscode-editorGroup-border) 65%, var(--vscode-editorGroup-border) 70%, transparent 70%)`,
						backgroundSize: "8px 8px",
						backgroundRepeat: "repeat",
						borderBottomLeftRadius: "8px",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "sw")}
					title="拖动调整窗口大小"
				/>

				{/* 右上角 */}
				<div
					style={{
						position: "absolute",
						top: 0,
						right: 0,
						width: "20px",
						height: "20px",
						cursor: "ne-resize",
						backgroundImage: `linear-gradient(45deg, transparent 0%, transparent 30%, var(--vscode-editorGroup-border) 30%, var(--vscode-editorGroup-border) 35%, transparent 35%, transparent 65%, var(--vscode-editorGroup-border) 65%, var(--vscode-editorGroup-border) 70%, transparent 70%)`,
						backgroundSize: "8px 8px",
						backgroundRepeat: "repeat",
						borderTopRightRadius: "8px",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "ne")}
					title="拖动调整窗口大小"
				/>

				{/* 左上角 */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "20px",
						height: "20px",
						cursor: "nw-resize",
						backgroundImage: `linear-gradient(-45deg, transparent 0%, transparent 30%, var(--vscode-editorGroup-border) 30%, var(--vscode-editorGroup-border) 35%, transparent 35%, transparent 65%, var(--vscode-editorGroup-border) 65%, var(--vscode-editorGroup-border) 70%, transparent 70%)`,
						backgroundSize: "8px 8px",
						backgroundRepeat: "repeat",
						borderTopLeftRadius: "8px",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "nw")}
					title="拖动调整窗口大小"
				/>

				{/* 上边 */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: "20px",
						right: "20px",
						height: "4px",
						cursor: "n-resize",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "n")}
					title="拖动调整窗口高度"
				/>

				{/* 下边 */}
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: "20px",
						right: "20px",
						height: "4px",
						cursor: "s-resize",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "s")}
					title="拖动调整窗口高度"
				/>

				{/* 左边 */}
				<div
					style={{
						position: "absolute",
						left: 0,
						top: "20px",
						bottom: "20px",
						width: "4px",
						cursor: "w-resize",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "w")}
					title="拖动调整窗口宽度"
				/>

				{/* 右边 */}
				<div
					style={{
						position: "absolute",
						right: 0,
						top: "20px",
						bottom: "20px",
						width: "4px",
						cursor: "e-resize",
						zIndex: 1001,
					}}
					onMouseDown={(e) => handleResizeMouseDown(e, "e")}
					title="拖动调整窗口宽度"
				/>
			</div>
		</div>
	)
}
