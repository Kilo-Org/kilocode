import * as fs from "fs"
import * as path from "path"
import { getTaskDirectoryPath, getStorageBasePath } from "../utils/storage"

/**
 * API请求数据结构
 */
export interface ApiRequestData {
	method: string
	url?: string
	headers?: Record<string, string>
	body?: any
	timestamp: number
	model?: string
	maxTokens?: number
	temperature?: number
}

/**
 * API响应数据结构
 */
export interface ApiResponseData {
	status?: number
	headers?: Record<string, string>
	body?: any
	timestamp: number
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	duration?: number
	error?: string
}

/**
 * API元数据结构
 */
export interface ApiMetadata {
	messageId: string
	taskId: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	duration?: number
	error?: string
	cancelReason?: string
	streamingFailedMessage?: string
	usageMissing?: boolean
	createdAt: number
	updatedAt: number
}

/**
 * 获取任务的API数据目录
 */
async function getApiDataDir(globalStoragePath: string, taskId: string): Promise<string> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	return path.join(taskDir, "apiData")
}

/**
 * 确保API数据目录存在
 */
async function ensureApiDataDir(globalStoragePath: string, taskId: string): Promise<void> {
	const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
	if (!fs.existsSync(apiDataDir)) {
		fs.mkdirSync(apiDataDir, { recursive: true })
	}
}

/**
 * 保存API请求数据
 */
export async function saveApiRequestData(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
	requestData: ApiRequestData,
): Promise<void> {
	try {
		await ensureApiDataDir(globalStoragePath, taskId)
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_request.json`)
		fs.writeFileSync(filePath, JSON.stringify(requestData, null, 2), "utf8")
	} catch (error) {
		console.error(`Failed to save API request data for message ${messageId}:`, error)
	}
}

/**
 * 保存API响应数据
 */
export async function saveApiResponseData(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
	responseData: ApiResponseData,
): Promise<void> {
	try {
		await ensureApiDataDir(globalStoragePath, taskId)
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_response.json`)
		fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2), "utf8")
	} catch (error) {
		console.error(`Failed to save API response data for message ${messageId}:`, error)
	}
}

/**
 * 保存API元数据
 */
export async function saveApiMetadata(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
	metadata: Partial<ApiMetadata>,
): Promise<void> {
	try {
		await ensureApiDataDir(globalStoragePath, taskId)
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_metadata.json`)

		// 读取现有元数据（如果存在）
		let existingMetadata: Partial<ApiMetadata> = {}
		if (fs.existsSync(filePath)) {
			try {
				const content = fs.readFileSync(filePath, "utf8")
				existingMetadata = JSON.parse(content)
			} catch (error) {
				console.warn(`Failed to read existing metadata for message ${messageId}:`, error)
			}
		}

		// 合并元数据
		const updatedMetadata: ApiMetadata = {
			messageId,
			taskId,
			createdAt: existingMetadata.createdAt || Date.now(),
			updatedAt: Date.now(),
			...existingMetadata,
			...metadata,
		}

		fs.writeFileSync(filePath, JSON.stringify(updatedMetadata, null, 2), "utf8")
	} catch (error) {
		console.error(`Failed to save API metadata for message ${messageId}:`, error)
	}
}

/**
 * 读取API请求数据
 */
export async function readApiRequestData(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
): Promise<ApiRequestData | null> {
	try {
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_request.json`)
		if (!fs.existsSync(filePath)) {
			return null
		}
		const content = fs.readFileSync(filePath, "utf8")
		return JSON.parse(content)
	} catch (error) {
		console.error(`Failed to read API request data for message ${messageId}:`, error)
		return null
	}
}

/**
 * 读取API响应数据
 */
export async function readApiResponseData(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
): Promise<ApiResponseData | null> {
	try {
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_response.json`)
		if (!fs.existsSync(filePath)) {
			return null
		}
		const content = fs.readFileSync(filePath, "utf8")
		return JSON.parse(content)
	} catch (error) {
		console.error(`Failed to read API response data for message ${messageId}:`, error)
		return null
	}
}

/**
 * 读取API元数据
 */
export async function readApiMetadata(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
): Promise<ApiMetadata | null> {
	try {
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const filePath = path.join(apiDataDir, `${messageId}_metadata.json`)
		if (!fs.existsSync(filePath)) {
			return null
		}
		const content = fs.readFileSync(filePath, "utf8")
		return JSON.parse(content)
	} catch (error) {
		console.error(`Failed to read API metadata for message ${messageId}:`, error)
		return null
	}
}

/**
 * 读取完整的API数据（请求+响应+元数据）
 */
export interface CompleteApiData {
	request: ApiRequestData | null
	response: ApiResponseData | null
	metadata: ApiMetadata | null
}

export async function readCompleteApiData(
	globalStoragePath: string,
	taskId: string,
	messageId: string,
): Promise<CompleteApiData> {
	return {
		request: await readApiRequestData(globalStoragePath, taskId, messageId),
		response: await readApiResponseData(globalStoragePath, taskId, messageId),
		metadata: await readApiMetadata(globalStoragePath, taskId, messageId),
	}
}

/**
 * 检查API数据是否存在
 */
export async function apiDataExists(globalStoragePath: string, taskId: string, messageId: string): Promise<boolean> {
	try {
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const requestFile = path.join(apiDataDir, `${messageId}_request.json`)
		const responseFile = path.join(apiDataDir, `${messageId}_response.json`)
		const metadataFile = path.join(apiDataDir, `${messageId}_metadata.json`)

		return fs.existsSync(requestFile) || fs.existsSync(responseFile) || fs.existsSync(metadataFile)
	} catch (error) {
		return false
	}
}

/**
 * 删除API数据
 */
export async function deleteApiData(globalStoragePath: string, taskId: string, messageId: string): Promise<void> {
	try {
		const apiDataDir = await getApiDataDir(globalStoragePath, taskId)
		const files = [
			path.join(apiDataDir, `${messageId}_request.json`),
			path.join(apiDataDir, `${messageId}_response.json`),
			path.join(apiDataDir, `${messageId}_metadata.json`),
		]

		files.forEach((file) => {
			if (fs.existsSync(file)) {
				fs.unlinkSync(file)
			}
		})
	} catch (error) {
		console.error(`Failed to delete API data for message ${messageId}:`, error)
	}
}

/**
 * 通过messageId搜索所有任务目录，查找API数据
 */
async function findApiDataByMessageId(
	globalStoragePath: string,
	messageId: string,
): Promise<{ taskId: string; apiDataDir: string } | null> {
	try {
		const basePath = await getStorageBasePath(globalStoragePath)
		const tasksDir = path.join(basePath, "tasks")

		if (!fs.existsSync(tasksDir)) {
			return null
		}

		const taskDirs = fs
			.readdirSync(tasksDir, { withFileTypes: true })
			.filter((dirent) => dirent.isDirectory())
			.map((dirent) => dirent.name)

		for (const taskId of taskDirs) {
			const apiDataDir = path.join(tasksDir, taskId, "apiData")
			if (!fs.existsSync(apiDataDir)) {
				continue
			}

			const files = [
				path.join(apiDataDir, `${messageId}_request.json`),
				path.join(apiDataDir, `${messageId}_response.json`),
				path.join(apiDataDir, `${messageId}_metadata.json`),
			]

			if (files.some((file) => fs.existsSync(file))) {
				return { taskId, apiDataDir }
			}
		}

		return null
	} catch (error) {
		console.error(`Failed to find API data for message ${messageId}:`, error)
		return null
	}
}

/**
 * 仅通过messageId读取完整的API数据
 */
export async function readCompleteApiDataByMessageId(
	globalStoragePath: string,
	messageId: string,
): Promise<CompleteApiData> {
	const result = await findApiDataByMessageId(globalStoragePath, messageId)
	if (!result) {
		return {
			request: null,
			response: null,
			metadata: null,
		}
	}

	return readCompleteApiData(globalStoragePath, result.taskId, messageId)
}

/**
 * 仅通过messageId检查API数据是否存在
 */
export async function apiDataExistsByMessageId(globalStoragePath: string, messageId: string): Promise<boolean> {
	const result = await findApiDataByMessageId(globalStoragePath, messageId)
	return result !== null
}
