import React, { useState, useEffect, useRef, useCallback } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { vscode } from "@src/utils/vscode"
import "./ApiRequestModal.css"

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
	errorMessage?: string
	createdAt: string
	updatedAt: string
}

export const ApiRequestModal: React.FC<ApiRequestModalProps> = ({
	isOpen,
	onClose,
	messageText,
	messageId: _messageId,
}) => {
	const [activeTab, setActiveTab] = useState<"request" | "response">("request")
	const [apiData, setApiData] = useState<ApiDataRecord | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { copyWithFeedback, showCopyFeedback } = useCopyToClipboard()

	// 计算初始尺寸：当前视口减去边距
	const getInitialSize = useCallback(() => {
		const viewportWidth = window.innerWidth
		const viewportHeight = window.innerHeight
		return {
			width: Math.max(300, viewportWidth - 140), // 左右边距70px * 2
			height: Math.max(300, viewportHeight - 300), // 上下边距150px * 2
		}
	}, [])

	// 计算初始位置：居中显示
	const getInitialPosition = useCallback(() => {
		const viewportWidth = window.innerWidth
		const viewportHeight = window.innerHeight
		const modalSize = getInitialSize()

		return {
			x: Math.max(70, (viewportWidth - modalSize.width) / 2),
			y: Math.max(150, (viewportHeight - modalSize.height) / 2),
		}
	}, [getInitialSize])

	// 拖动相关状态
	const [position, setPosition] = useState(getInitialPosition)
	const [isDragging, setIsDragging] = useState(false)
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
	const modalRef = useRef<HTMLDivElement>(null)

	// 尺寸调整相关状态
	const [size, setSize] = useState(getInitialSize)
	const [isResizing, setIsResizing] = useState(false)
	const [resizeDirection, setResizeDirection] = useState<"se" | "sw" | "ne" | "nw" | "n" | "s" | "e" | "w" | null>(
		null,
	)
	const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, posX: 0, posY: 0 })

	// 加载API数据
	useEffect(() => {
		if (isOpen && _messageId) {
			setLoading(true)
			setError(null)
			setApiData(null)

			// 只使用messageId加载API数据
			vscode.postMessage({
				type: "loadApiDataByMessageId",
				text: JSON.stringify({
					messageId: _messageId,
				}),
			})
		} else if (isOpen && !_messageId) {
			setLoading(false)
			setError("缺少messageId参数")
		}
	}, [isOpen, _messageId])

	// 监听来自extension的API数据响应
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "apiDataResponse") {
				setLoading(false)
				if (message.apiData) {
					setApiData(message.apiData)
					setError(null)
				} else {
					setError("未找到API数据")
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	// 监听窗口大小变化，重新计算位置和尺寸
	useEffect(() => {
		const handleResize = () => {
			if (isOpen) {
				const newSize = getInitialSize()
				const newPosition = getInitialPosition()
				setSize(newSize)
				setPosition(newPosition)
			}
		}

		window.addEventListener("resize", handleResize)
		return () => window.removeEventListener("resize", handleResize)
	}, [isOpen, getInitialPosition, getInitialSize])

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
	let errorMessage: string | null = null

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
		if (apiData.errorMessage) {
			try {
				errorMessage = JSON.parse(apiData.errorMessage)
			} catch (_e) {
				// 如果解析失败，直接使用原始字符串
				errorMessage = apiData.errorMessage
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
		<div className="api-request-modal-backdrop">
			<div
				ref={modalRef}
				className="api-request-modal"
				style={
					{
						"--modal-top": `${position.y}px`,
						"--modal-left": `${position.x}px`,
						"--modal-width": `${size.width}px`,
						"--modal-height": `${size.height}px`,
					} as React.CSSProperties
				}
				onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div
					className={`api-request-modal-header ${isDragging ? "dragging" : ""}`}
					onMouseDown={handleMouseDown}>
					<h3 className="api-request-modal-title">API 请求详情</h3>
					<VSCodeButton
						appearance="icon"
						onClick={(e) => {
							e.stopPropagation()
							onClose()
						}}
						title="关闭"
						className="api-request-modal-close-button">
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>

				{/* Tabs */}
				<div className="api-request-modal-tabs">
					<button
						className={`api-request-modal-tab ${activeTab === "request" ? "active" : ""}`}
						onClick={() => setActiveTab("request")}>
						请求信息
					</button>
					<button
						className={`api-request-modal-tab ${activeTab === "response" ? "active" : ""}`}
						onClick={() => setActiveTab("response")}>
						响应信息
					</button>
				</div>

				{/* Content */}
				<div className="api-request-modal-content">
					{loading && <div className="api-request-modal-loading">正在加载API数据...</div>}

					{error && (
						<div className="api-request-modal-error">
							<div className="api-request-modal-error-title">加载API数据失败</div>
							<div>{error}</div>
						</div>
					)}

					{!loading && !error && activeTab === "request" && (
						<div className="api-request-modal-section">
							{requestData ? (
								<div className="api-request-modal-section">
									<div className="api-request-modal-section-header">
										<span className="api-request-modal-section-title">请求详情:</span>
										<VSCodeButton
											appearance="icon"
											onClick={() => copyWithFeedback(JSON.stringify(requestData, null, 2))}
											title={showCopyFeedback ? "已复制!" : "复制请求信息"}>
											<span
												className={`codicon ${showCopyFeedback ? "codicon-check" : "codicon-copy"}`}></span>
										</VSCodeButton>
									</div>
									<pre className="api-request-modal-code-block">
										{JSON.stringify(requestData, null, 2)}
									</pre>
								</div>
							) : (
								<div className="api-request-modal-empty-state">暂无请求信息</div>
							)}
						</div>
					)}

					{!loading && !error && activeTab === "response" && (
						<div className="api-request-modal-section">
							{errorMessage ? (
								<div className="api-request-modal-section">
									<div className="api-request-modal-section-header">
										<span className="api-request-modal-section-title error">错误信息:</span>
										<VSCodeButton
											appearance="icon"
											onClick={() =>
												copyWithFeedback(
													typeof errorMessage === "string"
														? errorMessage
														: JSON.stringify(errorMessage, null, 2),
												)
											}
											title={showCopyFeedback ? "已复制!" : "复制错误信息"}>
											<span
												className={`codicon ${showCopyFeedback ? "codicon-check" : "codicon-copy"}`}></span>
										</VSCodeButton>
									</div>
									<pre className="api-request-modal-code-block error">
										{typeof errorMessage === "string"
											? errorMessage
											: JSON.stringify(errorMessage, null, 2)}
									</pre>
								</div>
							) : responseData ? (
								<div className="api-request-modal-section">
									<div className="api-request-modal-section-header">
										<span className="api-request-modal-section-title">响应详情:</span>
										<VSCodeButton
											appearance="icon"
											onClick={() => copyWithFeedback(JSON.stringify(responseData, null, 2))}
											title={showCopyFeedback ? "已复制!" : "复制响应信息"}>
											<span
												className={`codicon ${showCopyFeedback ? "codicon-check" : "codicon-copy"}`}></span>
										</VSCodeButton>
									</div>
									<pre className="api-request-modal-code-block">
										{JSON.stringify(responseData, null, 2)}
									</pre>
								</div>
							) : (
								<div className="api-request-modal-empty-state">暂无响应信息</div>
							)}
						</div>
					)}
				</div>

				{/* Resize Handles - 四个角和四条边 */}
				{/* 右下角 */}
				<div
					className="api-request-modal-resize-handle corner se"
					onMouseDown={(e) => handleResizeMouseDown(e, "se")}
					title="拖动调整窗口大小"
				/>

				{/* 左下角 */}
				<div
					className="api-request-modal-resize-handle corner sw"
					onMouseDown={(e) => handleResizeMouseDown(e, "sw")}
					title="拖动调整窗口大小"
				/>

				{/* 右上角 */}
				<div
					className="api-request-modal-resize-handle corner ne"
					onMouseDown={(e) => handleResizeMouseDown(e, "ne")}
					title="拖动调整窗口大小"
				/>

				{/* 左上角 */}
				<div
					className="api-request-modal-resize-handle corner nw"
					onMouseDown={(e) => handleResizeMouseDown(e, "nw")}
					title="拖动调整窗口大小"
				/>

				{/* 上边 */}
				<div
					className="api-request-modal-resize-handle n"
					onMouseDown={(e) => handleResizeMouseDown(e, "n")}
					title="拖动调整窗口高度"
				/>

				{/* 下边 */}
				<div
					className="api-request-modal-resize-handle s"
					onMouseDown={(e) => handleResizeMouseDown(e, "s")}
					title="拖动调整窗口高度"
				/>

				{/* 左边 */}
				<div
					className="api-request-modal-resize-handle w"
					onMouseDown={(e) => handleResizeMouseDown(e, "w")}
					title="拖动调整窗口宽度"
				/>

				{/* 右边 */}
				<div
					className="api-request-modal-resize-handle e"
					onMouseDown={(e) => handleResizeMouseDown(e, "e")}
					title="拖动调整窗口宽度"
				/>
			</div>
		</div>
	)
}
