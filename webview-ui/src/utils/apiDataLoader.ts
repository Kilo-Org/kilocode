import { vscode } from "./vscode"

/**
 * API请求数据接口
 */
export interface ApiRequestData {
	method: string
	url: string
	headers?: Record<string, string>
	body?: any
	model?: string
	maxTokens?: number
	temperature?: number
	topP?: number
	presencePenalty?: number
	frequencyPenalty?: number
	stop?: string[]
	stream?: boolean
}

/**
 * API响应数据接口
 */
export interface ApiResponseData {
	status: number
	statusText: string
	headers?: Record<string, string>
	body?: any
	error?: string
	responseTime?: number
}

/**
 * API元数据接口
 */
export interface ApiMetadata {
	messageId: string
	taskId: string
	createdAt: number
	updatedAt: number
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	cost?: number
	model?: string
	provider?: string
}

/**
 * 完整的API数据
 */
export interface CompleteApiData {
	request: ApiRequestData | null
	response: ApiResponseData | null
	metadata: ApiMetadata | null
}

/**
 * 加载API数据的结果
 */
export interface ApiDataLoadResult {
	success: boolean
	data?: CompleteApiData
	error?: string
}

/**
 * API数据加载器类
 */
export class ApiDataLoader {
	private static instance: ApiDataLoader
	private loadingPromises: Map<string, Promise<ApiDataLoadResult>> = new Map()

	static getInstance(): ApiDataLoader {
		if (!ApiDataLoader.instance) {
			ApiDataLoader.instance = new ApiDataLoader()
		}
		return ApiDataLoader.instance
	}

	/**
	 * 加载完整的API数据（使用taskId和messageId）
	 */
	async loadApiData(taskId: string, messageId: string): Promise<ApiDataLoadResult> {
		const cacheKey = `${taskId}:${messageId}`

		// 如果正在加载，返回现有的Promise
		if (this.loadingPromises.has(cacheKey)) {
			return this.loadingPromises.get(cacheKey)!
		}

		// 创建新的加载Promise
		const loadPromise = this.performLoad(taskId, messageId)
		this.loadingPromises.set(cacheKey, loadPromise)

		// 加载完成后清理缓存
		loadPromise.finally(() => {
			this.loadingPromises.delete(cacheKey)
		})

		return loadPromise
	}

	/**
	 * 仅使用messageId加载完整的API数据
	 */
	async loadApiDataByMessageId(messageId: string): Promise<ApiDataLoadResult> {
		const cacheKey = `messageId:${messageId}`

		// 如果正在加载，返回现有的Promise
		if (this.loadingPromises.has(cacheKey)) {
			return this.loadingPromises.get(cacheKey)!
		}

		// 创建新的加载Promise
		const loadPromise = this.performLoadByMessageId(messageId)
		this.loadingPromises.set(cacheKey, loadPromise)

		// 加载完成后清理缓存
		loadPromise.finally(() => {
			this.loadingPromises.delete(cacheKey)
		})

		return loadPromise
	}

	/**
	 * 执行实际的数据加载
	 */
	private async performLoad(taskId: string, messageId: string): Promise<ApiDataLoadResult> {
		try {
			// 向VSCode扩展发送消息请求API数据
			const response = await this.sendMessage({
				type: "loadApiData",
				taskId,
				messageId,
			})

			if (response.success) {
				return {
					success: true,
					data: response.data,
				}
			} else {
				return {
					success: false,
					error: response.error || "Failed to load API data",
				}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error occurred",
			}
		}
	}

	/**
	 * 仅使用messageId执行实际的数据加载
	 */
	private async performLoadByMessageId(messageId: string): Promise<ApiDataLoadResult> {
		try {
			// 向VSCode扩展发送消息请求API数据
			const response = await this.sendMessage({
				type: "loadApiDataByMessageId",
				messageId,
			})

			if (response.success) {
				return {
					success: true,
					data: response.data,
				}
			} else {
				return {
					success: false,
					error: response.error || "Failed to load API data",
				}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error occurred",
			}
		}
	}

	/**
	 * 检查API数据是否存在
	 */
	async checkApiDataExists(taskId: string, messageId: string): Promise<boolean> {
		try {
			const response = await this.sendMessage({
				type: "checkApiDataExists",
				taskId,
				messageId,
			})

			return response.exists || false
		} catch (error) {
			console.error("Failed to check API data existence:", error)
			return false
		}
	}

	/**
	 * 向VSCode扩展发送消息
	 */
	private sendMessage(message: any): Promise<any> {
		return new Promise((resolve, reject) => {
			const messageId = Date.now().toString() + Math.random().toString(36).substr(2, 9)

			// 设置超时
			const timeout = setTimeout(() => {
				window.removeEventListener("message", messageHandler)
				reject(new Error("Request timeout"))
			}, 10000) // 10秒超时

			// 消息处理器
			const messageHandler = (event: MessageEvent) => {
				if (event.data.messageId === messageId) {
					clearTimeout(timeout)
					window.removeEventListener("message", messageHandler)
					resolve(event.data)
				}
			}

			// 监听响应
			window.addEventListener("message", messageHandler)

			// 发送消息
			vscode.postMessage({
				...message,
				messageId,
			})
		})
	}
}

/**
 * 获取API数据加载器实例
 */
export function getApiDataLoader(): ApiDataLoader {
	return ApiDataLoader.getInstance()
}

/**
 * 便捷函数：加载API数据
 */
export async function loadApiData(taskId: string, messageId: string): Promise<ApiDataLoadResult> {
	return getApiDataLoader().loadApiData(taskId, messageId)
}

/**
 * 便捷函数：仅使用messageId加载API数据
 */
export async function loadApiDataByMessageId(messageId: string): Promise<ApiDataLoadResult> {
	return getApiDataLoader().loadApiDataByMessageId(messageId)
}

/**
 * 便捷函数：检查API数据是否存在
 */
export async function checkApiDataExists(taskId: string, messageId: string): Promise<boolean> {
	return getApiDataLoader().checkApiDataExists(taskId, messageId)
}
