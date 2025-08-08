import * as vscode from "vscode"
import * as sqlite3 from "sqlite3"
import * as path from "path"
import * as fs from "fs"

export interface ApiDataRecord {
	id?: number
	messageId: string
	taskId: string
	requestData?: string
	responseData?: string
	createdAt: string
	updatedAt: string
}

export class ApiDataStorage {
	private db: sqlite3.Database | null = null
	private dbPath: string
	private isInitialized = false

	constructor(private context: vscode.ExtensionContext) {
		this.dbPath = path.join(context.globalStorageUri.fsPath, "api-data.db")
	}

	/**
	 * 初始化数据库
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			// 确保目录存在
			const dbDir = path.dirname(this.dbPath)
			if (!fs.existsSync(dbDir)) {
				fs.mkdirSync(dbDir, { recursive: true })
			}

			// 创建数据库连接
			this.db = new sqlite3.Database(this.dbPath)

			// 创建表
			await this.createTable()

			// 创建索引
			await this.createIndexes()

			this.isInitialized = true
			console.log("ApiDataStorage initialized successfully")
		} catch (error) {
			console.error("Failed to initialize ApiDataStorage:", error)
			throw error
		}
	}

	/**
	 * 创建数据表
	 */
	private createTable(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const sql = `
				CREATE TABLE IF NOT EXISTS api_data (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					message_id TEXT NOT NULL,
					task_id TEXT NOT NULL,
					request_data TEXT,
					response_data TEXT,
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL
				)
			`

			this.db.run(sql, (err: Error | null) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * 创建索引
	 */
	private createIndexes(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const indexes = [
				"CREATE INDEX IF NOT EXISTS idx_message_id ON api_data(message_id)",
				"CREATE INDEX IF NOT EXISTS idx_task_id ON api_data(task_id)",
				"CREATE INDEX IF NOT EXISTS idx_created_at ON api_data(created_at)",
			]

			let completed = 0
			const total = indexes.length

			indexes.forEach((sql) => {
				this.db!.run(sql, (err: Error | null) => {
					if (err) {
						reject(err)
						return
					}
					completed++
					if (completed === total) {
						resolve()
					}
				})
			})
		})
	}

	/**
	 * 保存请求数据
	 */
	async saveRequestData(messageId: string, taskId: string, requestData: any): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize()
		}

		try {
			const now = new Date().toISOString()
			const requestDataStr = JSON.stringify(requestData)

			// 检查记录是否已存在
			const existing = await this.getByMessageId(messageId)
			if (existing) {
				// 更新现有记录
				await this.updateRequestData(messageId, requestDataStr)
			} else {
				// 创建新记录
				await this.insertRecord({
					messageId,
					taskId,
					requestData: requestDataStr,
					createdAt: now,
					updatedAt: now,
				})
			}
		} catch (error) {
			console.error("Failed to save request data:", error)
			// 不抛出错误，避免影响正常API调用
		}
	}

	/**
	 * 保存响应数据
	 */
	async saveResponseData(messageId: string, responseData: any): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize()
		}

		try {
			const responseDataStr = JSON.stringify(responseData)
			await this.updateResponseData(messageId, responseDataStr)
		} catch (error) {
			console.error("Failed to save response data:", error)
			// 不抛出错误，避免影响正常API调用
		}
	}

	/**
	 * 根据消息ID获取数据
	 */
	async getByMessageId(messageId: string): Promise<ApiDataRecord | null> {
		if (!this.isInitialized) {
			await this.initialize()
		}

		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const sql = "SELECT * FROM api_data WHERE message_id = ? LIMIT 1"
			this.db.get(sql, [messageId], (err: Error | null, row: any) => {
				if (err) {
					reject(err)
				} else if (row) {
					resolve({
						id: row.id,
						messageId: row.message_id,
						taskId: row.task_id,
						requestData: row.request_data,
						responseData: row.response_data,
						createdAt: row.created_at,
						updatedAt: row.updated_at,
					})
				} else {
					resolve(null)
				}
			})
		})
	}

	/**
	 * 插入新记录
	 */
	private insertRecord(record: Omit<ApiDataRecord, "id">): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const sql = `
				INSERT INTO api_data (message_id, task_id, request_data, response_data, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
			`

			this.db.run(
				sql,
				[
					record.messageId,
					record.taskId,
					record.requestData || null,
					record.responseData || null,
					record.createdAt,
					record.updatedAt,
				],
				(err: Error | null) => {
					if (err) {
						reject(err)
					} else {
						resolve()
					}
				},
			)
		})
	}

	/**
	 * 更新请求数据
	 */
	private updateRequestData(messageId: string, requestData: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const sql = "UPDATE api_data SET request_data = ?, updated_at = ? WHERE message_id = ?"
			const now = new Date().toISOString()

			this.db.run(sql, [requestData, now, messageId], (err: Error | null) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * 更新响应数据
	 */
	private updateResponseData(messageId: string, responseData: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			const sql = "UPDATE api_data SET response_data = ?, updated_at = ? WHERE message_id = ?"
			const now = new Date().toISOString()

			this.db.run(sql, [responseData, now, messageId], (err: Error | null) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	}

	/**
	 * 清理旧数据（保留最近30天）
	 */
	async cleanupOldData(): Promise<void> {
		if (!this.isInitialized) {
			return
		}

		try {
			const thirtyDaysAgo = new Date()
			thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
			const cutoffDate = thirtyDaysAgo.toISOString()

			await new Promise<void>((resolve, reject) => {
				if (!this.db) {
					reject(new Error("Database not initialized"))
					return
				}

				const sql = "DELETE FROM api_data WHERE created_at < ?"
				this.db.run(sql, [cutoffDate], (err: Error | null) => {
					if (err) {
						reject(err)
					} else {
						resolve()
					}
				})
			})

			console.log("Old API data cleaned up successfully")
		} catch (error) {
			console.error("Failed to cleanup old data:", error)
		}
	}

	/**
	 * 关闭数据库连接
	 */
	async close(): Promise<void> {
		if (this.db) {
			await new Promise<void>((resolve) => {
				this.db!.close((err: Error | null) => {
					if (err) {
						console.error("Error closing database:", err)
					}
					resolve()
				})
			})
			this.db = null
			this.isInitialized = false
		}
	}

	/**
	 * 获取数据库统计信息
	 */
	async getStats(): Promise<{ totalRecords: number; dbSizeBytes: number }> {
		if (!this.isInitialized) {
			await this.initialize()
		}

		const totalRecords = await new Promise<number>((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"))
				return
			}

			this.db.get("SELECT COUNT(*) as count FROM api_data", (err: Error | null, row: any) => {
				if (err) {
					reject(err)
				} else {
					resolve(row.count)
				}
			})
		})

		let dbSizeBytes = 0
		try {
			const stats = fs.statSync(this.dbPath)
			dbSizeBytes = stats.size
		} catch (error) {
			// 文件不存在或无法访问
		}

		return { totalRecords, dbSizeBytes }
	}
}
