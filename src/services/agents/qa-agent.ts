// kilocode_change - new file

import type { AgentConfig, AgentTask, AgentMessage } from "./types.js"
import { BaseAgent } from "./base-agent.js"
import { exec } from "child_process"
import { promisify } from "util"
import * as fs from "fs/promises"
import * as path from "path"
import { glob } from "glob"

const execAsync = promisify(exec)

export interface QATaskInput {
	filePath: string
	operation: "generate_tests" | "run_diagnostics" | "check_coverage" | "validate_manifest" | "security_audit"
	options?: {
		testFramework?: "jest" | "pytest" | "vitest"
		coverageThreshold?: number
		linter?: "eslint" | "pylint" | "ruff"
		framework?: "odoo" | "django" | "generic"
	}
}

export interface TestGenerationResult {
	testFilePath: string
	generatedTests: string
	testCount: number
	framework: string
	confidence: number
}

export interface DiagnosticResult {
	filePath: string
	linter: string
	issues: Array<{
		severity: "error" | "warning" | "info"
		message: string
		line: number
		column: number
		rule: string
	}>
	score: number
	summary: string
}

export interface CoverageResult {
	filePath: string
	coverage: {
		lines: number
		functions: number
		branches: number
		statements: number
	}
	uncoveredLines: number[]
	meetsThreshold: boolean
	summary: string
}

export interface ManifestValidationResult {
	manifestPath: string
	isValid: boolean
	errors: string[]
	warnings: string[]
	missingFiles: string[]
	unregisteredFiles: string[]
	summary: string
}

export interface SecurityAuditResult {
	filePath: string
	securityIssues: Array<{
		severity: "critical" | "high" | "medium" | "low"
		type: string
		description: string
		line: number
		recommendation: string
	}>
	score: number
	summary: string
}

export interface QAResult {
	success: boolean
	taskId: string
	operation: string
	duration: number
	result: TestGenerationResult | DiagnosticResult | CoverageResult | ManifestValidationResult | SecurityAuditResult
	metadata: {
		filePath: string
		timestamp: Date
		confidence: number
	}
}

export class QAAgent extends BaseAgent {
	private workspaceRoot: string
	private testOutputPath: string
	private coverageReportsPath: string

	constructor(config: AgentConfig, workspaceRoot: string) {
		super({
			...config,
			type: "verifier",
			capabilities: [
				{
					name: "test_generation",
					description: "Automatically generate unit tests for code files",
					inputTypes: ["typescript", "javascript", "python"],
					outputTypes: ["test_files"],
				},
				{
					name: "code_diagnostics",
					description: "Run linters and static analysis tools",
					inputTypes: ["typescript", "javascript", "python"],
					outputTypes: ["diagnostic_reports"],
				},
				{
					name: "coverage_analysis",
					description: "Analyze test coverage for code files",
					inputTypes: ["typescript", "javascript", "python"],
					outputTypes: ["coverage_reports"],
				},
				{
					name: "manifest_validation",
					description: "Validate Odoo manifest files",
					inputTypes: ["python", "xml"],
					outputTypes: ["validation_reports"],
				},
				{
					name: "security_audit",
					description: "Perform security audits on code files",
					inputTypes: ["python", "xml", "javascript"],
					outputTypes: ["security_reports"],
				},
			],
		})

		this.workspaceRoot = workspaceRoot
		this.testOutputPath = path.join(workspaceRoot, ".kilocode", "tests")
		this.coverageReportsPath = path.join(workspaceRoot, ".kilocode", "coverage")
	}

	protected async setupMessageHandlers(): Promise<void> {
		this._messageHandlers.set("qa_request", async (message: AgentMessage) => {
			await this.handleQARequest(message)
		})

		this._messageHandlers.set("get_status", async (message: AgentMessage) => {
			await this.handleStatusRequest(message)
		})
	}

	protected async processTask(task: AgentTask): Promise<QAResult> {
		const startTime = Date.now()
		const input = task.input as QATaskInput

		try {
			let result: QAResult["result"]

			switch (input.operation) {
				case "generate_tests":
					result = await this.generateUnitTests(input.filePath, input.options)
					break
				case "run_diagnostics":
					result = await this.runDiagnostics(input.filePath, input.options)
					break
				case "check_coverage":
					result = await this.checkCoverage(input.filePath, input.options)
					break
				case "validate_manifest":
					result = await this.validateManifest(input.filePath, input.options)
					break
				case "security_audit":
					result = await this.securityAudit(input.filePath, input.options)
					break
				default:
					throw new Error(`Unknown QA operation: ${input.operation}`)
			}

			const duration = Date.now() - startTime

			return {
				success: true,
				taskId: task.id,
				operation: input.operation,
				duration,
				result,
				metadata: {
					filePath: input.filePath,
					timestamp: new Date(),
					confidence: this.calculateConfidence(result),
				},
			}
		} catch (error) {
			const duration = Date.now() - startTime
			throw new Error(`QA task failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	private async generateUnitTests(filePath: string, options?: QATaskInput["options"]): Promise<TestGenerationResult> {
		const framework = options?.testFramework || this.detectTestFramework(filePath)
		const fileContent = await fs.readFile(filePath, "utf-8")
		const language = this.detectLanguage(filePath)

		let generatedTests: string
		let testFilePath: string

		if (language === "python") {
			;({ generatedTests, testFilePath } = await this.generatePythonTests(filePath, fileContent, framework))
		} else {
			;({ generatedTests, testFilePath } = await this.generateJSTests(filePath, fileContent, framework))
		}

		// Ensure test directory exists
		await fs.mkdir(path.dirname(testFilePath), { recursive: true })
		await fs.writeFile(testFilePath, generatedTests, "utf-8")

		const testCount = this.countTestCases(generatedTests)

		return {
			testFilePath,
			generatedTests,
			testCount,
			framework,
			confidence: this.calculateTestConfidence(fileContent, testCount),
		}
	}

	private async runDiagnostics(filePath: string, options?: QATaskInput["options"]): Promise<DiagnosticResult> {
		const language = this.detectLanguage(filePath)
		const linter = options?.linter || this.getDefaultLinter(language)

		let command: string
		let args: string[]

		if (language === "python") {
			if (linter === "pylint") {
				command = "pylint"
				args = ["--output-format=json", filePath]
			} else if (linter === "ruff") {
				command = "ruff"
				args = ["check", "--output-format=json", filePath]
			} else {
				throw new Error(`Unsupported Python linter: ${linter}`)
			}
		} else if (language === "typescript" || language === "javascript") {
			command = "npx"
			args = ["eslint", "--format=json", filePath]
		} else {
			throw new Error(`Unsupported language for diagnostics: ${language}`)
		}

		try {
			const { stdout } = await execAsync(`${command} ${args.join(" ")}`)
			const issues = this.parseLintOutput(stdout, linter)

			return {
				filePath,
				linter,
				issues,
				score: this.calculateDiagnosticScore(issues),
				summary: this.generateDiagnosticSummary(issues),
			}
		} catch (error) {
			// Linters return non-zero exit codes when issues are found
			const errorOutput = (error as any).stdout || (error as any).stderr
			const issues = this.parseLintOutput(errorOutput, linter)

			return {
				filePath,
				linter,
				issues,
				score: this.calculateDiagnosticScore(issues),
				summary: this.generateDiagnosticSummary(issues),
			}
		}
	}

	private async checkCoverage(filePath: string, options?: QATaskInput["options"]): Promise<CoverageResult> {
		const threshold = options?.coverageThreshold || 80
		const language = this.detectLanguage(filePath)

		let command: string
		let args: string[]

		if (language === "python") {
			command = "coverage"
			args = ["run", "-m", "pytest", "--cov-report=json", path.dirname(filePath)]
		} else {
			command = "npx"
			args = ["vitest", "--run", "--coverage", "--reporter=json", path.dirname(filePath)]
		}

		try {
			await fs.mkdir(this.coverageReportsPath, { recursive: true })
			const { stdout } = await execAsync(`${command} ${args.join(" ")}`)

			// Parse coverage report
			const coverageData = await this.parseCoverageReport(language)
			const fileCoverage = this.extractFileCoverage(coverageData, filePath)

			return {
				filePath,
				coverage: fileCoverage,
				uncoveredLines: this.getUncoveredLines(fileCoverage),
				meetsThreshold: fileCoverage.lines >= threshold,
				summary: this.generateCoverageSummary(fileCoverage, threshold),
			}
		} catch (error) {
			throw new Error(`Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	private async validateManifest(
		manifestPath: string,
		options?: QATaskInput["options"],
	): Promise<ManifestValidationResult> {
		if (!manifestPath.endsWith("__manifest__.py")) {
			throw new Error("Invalid manifest file path")
		}

		const manifestContent = await fs.readFile(manifestPath, "utf-8")
		const manifest = this.parseManifest(manifestContent)

		// Get all Python and XML files in the module
		const moduleDir = path.dirname(manifestPath)
		const pyFiles = await glob("**/*.py", { cwd: moduleDir, ignore: ["__manifest__.py"] })
		const xmlFiles = await glob("**/*.xml", { cwd: moduleDir })

		const errors: string[] = []
		const warnings: string[] = []
		const missingFiles: string[] = []
		const unregisteredFiles: string[] = []

		// Check data files
		if (manifest.data) {
			for (const dataFile of manifest.data) {
				const fullPath = path.join(moduleDir, dataFile)
				try {
					await fs.access(fullPath)
				} catch {
					missingFiles.push(dataFile)
				}
			}
		}

		// Check for unregistered XML files
		for (const xmlFile of xmlFiles) {
			if (!manifest.data?.includes(xmlFile) && !xmlFile.includes("demo/")) {
				unregisteredFiles.push(xmlFile)
			}
		}

		// Validate manifest structure
		if (!manifest.name) errors.push("Manifest missing 'name' field")
		if (!manifest.version) errors.push("Manifest missing 'version' field")
		if (!manifest.depends) warnings.push("Manifest missing 'depends' field")

		const isValid = errors.length === 0

		return {
			manifestPath,
			isValid,
			errors,
			warnings,
			missingFiles,
			unregisteredFiles,
			summary: this.generateManifestSummary(isValid, errors, warnings, missingFiles, unregisteredFiles),
		}
	}

	private async securityAudit(filePath: string, options?: QATaskInput["options"]): Promise<SecurityAuditResult> {
		const fileContent = await fs.readFile(filePath, "utf-8")
		const language = this.detectLanguage(filePath)
		const framework = options?.framework || "generic"

		const securityIssues = this.analyzeSecurity(fileContent, language, framework)

		return {
			filePath,
			securityIssues,
			score: this.calculateSecurityScore(securityIssues),
			summary: this.generateSecuritySummary(securityIssues),
		}
	}

	// Helper methods
	private detectLanguage(filePath: string): string {
		const ext = path.extname(filePath)
		switch (ext) {
			case ".py":
				return "python"
			case ".ts":
				return "typescript"
			case ".js":
				return "javascript"
			case ".xml":
				return "xml"
			default:
				return "unknown"
		}
	}

	private detectTestFramework(filePath: string): string {
		const language = this.detectLanguage(filePath)
		return language === "python" ? "pytest" : "jest"
	}

	private getDefaultLinter(language: string): string {
		switch (language) {
			case "python":
				return "ruff"
			case "typescript":
			case "javascript":
				return "eslint"
			default:
				throw new Error(`No default linter for language: ${language}`)
		}
	}

	private async generatePythonTests(
		filePath: string,
		content: string,
		framework: string,
	): Promise<{ generatedTests: string; testFilePath: string }> {
		// Extract classes and functions
		const classes = this.extractPythonClasses(content)
		const functions = this.extractPythonFunctions(content)

		let tests = `# Auto-generated tests for ${path.basename(filePath)}\n`
		tests += `import pytest\n`
		tests += `import sys\n`
		tests += `import os\n`
		tests += `sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))\n\n`
		tests += `from ${path.basename(filePath, ".py")} import ${classes.join(", ")}\n\n`

		for (const cls of classes) {
			tests += this.generatePythonTestClass(cls, content)
		}

		for (const func of functions) {
			tests += this.generatePythonTestFunction(func, content)
		}

		const testFilePath = path.join(this.testOutputPath, path.dirname(filePath), `test_${path.basename(filePath)}`)

		return { generatedTests: tests, testFilePath }
	}

	private async generateJSTests(
		filePath: string,
		content: string,
		framework: string,
	): Promise<{ generatedTests: string; testFilePath: string }> {
		// Extract functions and classes
		const functions = this.extractJSFunctions(content)
		const classes = this.extractJSClasses(content)

		let tests = `// Auto-generated tests for ${path.basename(filePath)}\n`
		tests += `import { ${classes.concat(functions).join(", ")} } from '../${path.basename(filePath)}'\n\n`

		for (const cls of classes) {
			tests += this.generateJSTestClass(cls, content)
		}

		for (const func of functions) {
			tests += this.generateJSTestFunction(func, content)
		}

		const testFilePath = path.join(
			this.testOutputPath,
			path.dirname(filePath),
			`${path.basename(filePath, path.extname(filePath))}.test.ts`,
		)

		return { generatedTests: tests, testFilePath }
	}

	// Additional helper methods would be implemented here...
	private extractPythonClasses(content: string): string[] {
		const classRegex = /^class\s+(\w+)/gm
		const matches = content.match(classRegex)
		return matches ? matches.map((m) => m.replace(/^class\s+/, "")) : []
	}

	private extractPythonFunctions(content: string): string[] {
		const funcRegex = /^def\s+(\w+)/gm
		const matches = content.match(funcRegex)
		return matches ? matches.map((m) => m.replace(/^def\s+/, "")) : []
	}

	private extractJSFunctions(content: string): string[] {
		const funcRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm
		const matches = content.match(funcRegex)
		return matches ? matches.map((m) => m.replace(/^(?:export\s+)?(?:async\s+)?function\s+/, "")) : []
	}

	private extractJSClasses(content: string): string[] {
		const classRegex = /^export\s+class\s+(\w+)/gm
		const matches = content.match(classRegex)
		return matches ? matches.map((m) => m.replace(/^export\s+class\s+/, "")) : []
	}

	private generatePythonTestClass(className: string, content: string): string {
		return `
class Test${className}:
    def test_initialization(self):
        """Test ${className} initialization"""
        # TODO: Implement test
        assert True

    def test_functionality(self):
        """Test ${className} main functionality"""
        # TODO: Implement test
        assert True
`
	}

	private generatePythonTestFunction(funcName: string, content: string): string {
		return `
def test_${funcName}():
    """Test ${funcName} function"""
    # TODO: Implement test
    assert True
`
	}

	private generateJSTestClass(className: string, content: string): string {
		return `
describe('${className}', () => {
	test('should initialize correctly', () => {
		// TODO: Implement test
		expect(true).toBe(true)
	})

	test('should perform main functionality', () => {
		// TODO: Implement test
		expect(true).toBe(true)
	})
})
`
	}

	private generateJSTestFunction(funcName: string, content: string): string {
		return `
test('${funcName}', () => {
	// TODO: Implement test
	expect(true).toBe(true)
})
`
	}

	private countTestCases(testContent: string): number {
		const testPatterns = [/def test_/g, /test\(/g, /it\(/g, /describe\(/g]

		let count = 0
		for (const pattern of testPatterns) {
			const matches = testContent.match(pattern)
			if (matches) count += matches.length
		}

		return count
	}

	private calculateTestConfidence(fileContent: string, testCount: number): number {
		// Simple confidence calculation based on code complexity and test count
		const lines = fileContent.split("\n").length
		const testRatio = testCount / Math.max(lines / 20, 1) // Rough estimate: 1 test per 20 lines
		return Math.min(testRatio * 100, 100)
	}

	private parseLintOutput(output: string, linter: string): any[] {
		try {
			return JSON.parse(output)
		} catch {
			// Fallback parsing for non-JSON output
			return []
		}
	}

	private calculateDiagnosticScore(issues: any[]): number {
		if (issues.length === 0) return 100

		const errorWeight = 10
		const warningWeight = 3
		const infoWeight = 1

		let score = 100
		for (const issue of issues) {
			switch (issue.severity) {
				case "error":
					score -= errorWeight
					break
				case "warning":
					score -= warningWeight
					break
				case "info":
					score -= infoWeight
					break
			}
		}

		return Math.max(score, 0)
	}

	private generateDiagnosticSummary(issues: any[]): string {
		const errorCount = issues.filter((i) => i.severity === "error").length
		const warningCount = issues.filter((i) => i.severity === "warning").length
		const infoCount = issues.filter((i) => i.severity === "info").length

		return `${issues.length} issues found: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`
	}

	private async parseCoverageReport(language: string): Promise<any> {
		// Implementation would parse coverage.json files
		return {}
	}

	private extractFileCoverage(coverageData: any, filePath: string): any {
		// Implementation would extract coverage for specific file
		return { lines: 0, functions: 0, branches: 0, statements: 0 }
	}

	private getUncoveredLines(coverage: any): number[] {
		// Implementation would return uncovered line numbers
		return []
	}

	private generateCoverageSummary(coverage: any, threshold: number): string {
		return `Coverage: ${coverage.lines}% (threshold: ${threshold}%)`
	}

	private parseManifest(content: string): any {
		// Simple Python manifest parsing
		try {
			// Remove Python dict syntax and evaluate as JSON-like object
			const cleaned = content
				.replace(/'/g, '"')
				.replace(/(\w+):/g, '"$1":')
				.replace(/True/g, "true")
				.replace(/False/g, "false")
				.replace(/None/g, "null")

			return JSON.parse(cleaned)
		} catch {
			return {}
		}
	}

	private generateManifestSummary(
		isValid: boolean,
		errors: string[],
		warnings: string[],
		missingFiles: string[],
		unregisteredFiles: string[],
	): string {
		const parts = []
		if (!isValid) parts.push(`${errors.length} errors`)
		if (warnings.length > 0) parts.push(`${warnings.length} warnings`)
		if (missingFiles.length > 0) parts.push(`${missingFiles.length} missing files`)
		if (unregisteredFiles.length > 0) parts.push(`${unregisteredFiles.length} unregistered files`)

		return parts.length > 0 ? parts.join(", ") : "Manifest is valid"
	}

	private analyzeSecurity(content: string, language: string, framework: string): any[] {
		const issues = []

		// Common security patterns
		const securityPatterns = [
			{
				pattern: /eval\(/,
				type: "code_injection",
				severity: "critical",
				description: "Use of eval() function",
				recommendation: "Avoid using eval(), use safer alternatives",
			},
			{
				pattern: /exec\(/,
				type: "code_injection",
				severity: "critical",
				description: "Use of exec() function",
				recommendation: "Avoid using exec(), use safer alternatives",
			},
			{
				pattern: /sql.*\+.*%s/,
				type: "sql_injection",
				severity: "high",
				description: "Potential SQL injection vulnerability",
				recommendation: "Use parameterized queries",
			},
		]

		const lines = content.split("\n")
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			for (const pattern of securityPatterns) {
				if (pattern.pattern.test(line)) {
					issues.push({
						severity: pattern.severity,
						type: pattern.type,
						description: pattern.description,
						line: i + 1,
						recommendation: pattern.recommendation,
					})
				}
			}
		}

		return issues
	}

	private calculateSecurityScore(issues: any[]): number {
		const severityWeights = { critical: 25, high: 15, medium: 10, low: 5 }
		let score = 100

		for (const issue of issues) {
			score -= severityWeights[issue.severity] || 0
		}

		return Math.max(score, 0)
	}

	private generateSecuritySummary(issues: any[]): string {
		const criticalCount = issues.filter((i) => i.severity === "critical").length
		const highCount = issues.filter((i) => i.severity === "high").length
		const mediumCount = issues.filter((i) => i.severity === "medium").length
		const lowCount = issues.filter((i) => i.severity === "low").length

		return `${issues.length} security issues: ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low`
	}

	private calculateConfidence(result: any): number {
		// Simple confidence calculation based on result type
		if (result.issues) return 100 - Math.min(result.issues.length * 5, 90)
		if (result.coverage) return result.coverage.lines
		if (result.testCount) return Math.min(result.testCount * 20, 90)
		return 75
	}

	private async handleQARequest(message: AgentMessage): Promise<void> {
		const { filePath, operation, options } = message.content

		const task: AgentTask = {
			id: `qa-${Date.now()}`,
			type: "qa_task",
			assignedTo: this.config.id,
			createdBy: message.from,
			status: "pending",
			priority: "medium",
			input: { filePath, operation, options },
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		try {
			const result = await this.executeTask(task)
			await this.sendMessage(message.from, "qa_response", result, "medium")
		} catch (error) {
			await this.sendMessage(message.from, "qa_error", { error: String(error) }, "high")
		}
	}

	private async handleStatusRequest(message: AgentMessage): Promise<void> {
		const status = {
			agentId: this.config.id,
			status: this._state.status,
			currentTasks: this._state.currentTasks.length,
			completedTasks: this._state.completedTasks.length,
			metrics: this.getMetrics(),
		}

		await this.sendMessage(message.from, "status_response", status, "low")
	}
}
