import * as fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"

export class PlanManager {
	private static instances = new Map<string, PlanManager>()
	private plansDir: string

	private constructor(private workspaceDir: string) {
		this.plansDir = path.join(workspaceDir, "plans")
	}

	public static getInstance(workspaceDir: string): PlanManager {
		if (!PlanManager.instances.has(workspaceDir)) {
			PlanManager.instances.set(workspaceDir, new PlanManager(workspaceDir))
		}
		return PlanManager.instances.get(workspaceDir)!
	}

	/**
	 * يتأكد من وجود مجلد الـ plans ويقوم بإنشائه إذا لم يكن موجودًا
	 */
	public async ensurePlansDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.plansDir, { recursive: true })
		} catch (error) {
			console.error(`Error ensuring plans directory: ${error}`)
			throw error
		}
	}

	/**
	 * يقرأ ملف خطة بأمان مع معالجة خطأ ENOENT
	 */
	public async safeReadPlanFile(filename: string): Promise<string | null> {
		const filePath = path.join(this.plansDir, filename)

		try {
			const exists = await fileExistsAtPath(filePath)
			if (!exists) {
				console.log(`Plan file does not exist: ${filePath}`)
				return null
			}

			return await fs.readFile(filePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				console.log(`Plan file not found: ${filePath}`)
				return null
			}
			console.error(`Error reading plan file: ${error}`)
			throw error
		}
	}

	/**
	 * يكتب ملف خطة بأمان بعد التأكد من وجود المجلد
	 */
	public async writePlanFile(filename: string, content: string): Promise<void> {
		await this.ensurePlansDirectory()
		const filePath = path.join(this.plansDir, filename)

		try {
			await fs.writeFile(filePath, content, "utf8")
		} catch (error) {
			console.error(`Error writing plan file: ${error}`)
			throw error
		}
	}

	/**
	 * يحصل على قائمة بجميع ملفات الخطة
	 */
	public async getPlanFiles(): Promise<string[]> {
		try {
			const exists = await fileExistsAtPath(this.plansDir)
			if (!exists) {
				return []
			}

			const files = await fs.readdir(this.plansDir)
			return files.filter((file) => file.endsWith(".md") || file.endsWith(".json"))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return []
			}
			console.error(`Error reading plans directory: ${error}`)
			throw error
		}
	}

	/**
	 * يحذف ملف خطة
	 */
	public async deletePlanFile(filename: string): Promise<boolean> {
		const filePath = path.join(this.plansDir, filename)

		try {
			const exists = await fileExistsAtPath(filePath)
			if (!exists) {
				return false
			}

			await fs.unlink(filePath)
			return true
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return false
			}
			console.error(`Error deleting plan file: ${error}`)
			throw error
		}
	}

	public getPlansDirectory(): string {
		return this.plansDir
	}

	/**
	 * مسح المثيلات - يستخدم فقط للاختبارات
	 */
	public static clearInstances(): void {
		PlanManager.instances.clear()
	}
}
