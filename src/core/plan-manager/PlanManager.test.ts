import { describe, it, beforeEach, afterEach, expect } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { PlanManager } from "./PlanManager"

describe("PlanManager", () => {
	let planManager: PlanManager
	let tempDir: string

	beforeEach(() => {
		tempDir = "/tmp/test-kilocode-plans-" + Date.now()
		planManager = PlanManager.getInstance(tempDir)
	})

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	describe("ensurePlansDirectory", () => {
		it("should create plans directory if it does not exist", async () => {
			await planManager.ensurePlansDirectory()

			const plansDir = planManager.getPlansDirectory()
			const exists = await fs
				.access(plansDir)
				.then(() => true)
				.catch(() => false)

			expect(exists).toBe(true)
		})
	})

	describe("writePlanFile", () => {
		it("should write a plan file successfully", async () => {
			const filename = "test-plan.md"
			const content = "# Test Plan\nThis is a test plan."

			await planManager.writePlanFile(filename, content)

			const plansDir = planManager.getPlansDirectory()
			const filePath = path.join(plansDir, filename)
			const fileContent = await fs.readFile(filePath, "utf8")

			expect(fileContent).toBe(content)
		})
	})

	describe("safeReadPlanFile", () => {
		it("should return null for non-existent file", async () => {
			const result = await planManager.safeReadPlanFile("non-existent.md")
			expect(result).toBeNull()
		})

		it("should read existing plan file", async () => {
			const filename = "test-plan.md"
			const content = "# Test Plan\n\nThis is a test plan."

			await planManager.writePlanFile(filename, content)
			const result = await planManager.safeReadPlanFile(filename)

			expect(result).toBe(content)
		})
	})

	describe("getPlanFiles", () => {
		it("should return empty array when no plan files exist", async () => {
			const files = await planManager.getPlanFiles()
			expect(files).toEqual([])
		})

		it("should return plan files", async () => {
			const planManagerTest = PlanManager.getInstance("/tmp/test-get-plan-files-" + Date.now())
			await planManagerTest.ensurePlansDirectory()

			await planManagerTest.writePlanFile("plan1.md", "# Plan 1")
			await planManagerTest.writePlanFile("plan2.json", '{"plan": "2"}')
			await planManagerTest.writePlanFile("not-a-plan.txt", "Not a plan")

			const files = await planManagerTest.getPlanFiles()

			expect(files).toContain("plan1.md")
			expect(files).toContain("plan2.json")
			expect(files).not.toContain("not-a-plan.txt")
			expect(files).toHaveLength(2)
		})
	})

	describe("deletePlanFile", () => {
		it("should return false for non-existent file", async () => {
			const result = await planManager.deletePlanFile("non-existent.md")
			expect(result).toBe(false)
		})

		it("should delete existing plan file", async () => {
			const filename = "test-plan.md"
			const content = "# Test Plan\n\nThis is a test plan."

			await planManager.writePlanFile(filename, content)

			const existsBefore = await planManager.safeReadPlanFile(filename)
			expect(existsBefore).not.toBeNull()

			const deleted = await planManager.deletePlanFile(filename)
			expect(deleted).toBe(true)

			const existsAfter = await planManager.safeReadPlanFile(filename)
			expect(existsAfter).toBeNull()
		})
	})

	describe("singleton pattern", () => {
		it("should return the same instance for the same workspace", () => {
			const workspaceDir = "/tmp/test-workspace-" + Date.now()
			const instance1 = PlanManager.getInstance(workspaceDir)
			const instance2 = PlanManager.getInstance(workspaceDir)

			expect(instance1).toBe(instance2)
		})

		it("should return different instances for different workspaces", () => {
			const instance1 = PlanManager.getInstance("/tmp/workspace1-" + Date.now())
			const instance2 = PlanManager.getInstance("/tmp/workspace2-" + Date.now())

			expect(instance1).not.toBe(instance2)
		})
	})

	afterAll(() => {
		PlanManager.clearInstances()
	})
})
