import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import type { FrameworkType } from "../types"

/**
 * Framework detector to identify which framework(s) a project uses
 */
export class FrameworkDetector {
	private workspaceRoot: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	/**
	 * Detect all frameworks used in the project
	 */
	async detectFrameworks(): Promise<FrameworkType[]> {
		const frameworks: FrameworkType[] = []

		// Check for JavaScript/TypeScript frameworks
		const packageJson = await this.readPackageJson()
		if (packageJson) {
			if (this.hasOdoo(packageJson)) frameworks.push("odoo")
			if (this.hasReact(packageJson)) frameworks.push("react")
			if (this.hasVue(packageJson)) frameworks.push("vue")
			if (this.hasAngular(packageJson)) frameworks.push("angular")
			if (this.hasNextJs(packageJson)) frameworks.push("nextjs")
			if (this.hasNuxtJs(packageJson)) frameworks.push("nuxtjs")
		}

		// Check for Python frameworks
		const requirementsTxt = await this.readRequirementsTxt()
		if (requirementsTxt) {
			if (this.hasDjango(requirementsTxt)) frameworks.push("django")
			if (this.hasFastAPI(requirementsTxt)) frameworks.push("fastapi")
		}

		// If no specific framework detected, use generic
		if (frameworks.length === 0) {
			frameworks.push("generic")
		}

		return frameworks
	}

	/**
	 * Get primary framework
	 */
	async getPrimaryFramework(): Promise<FrameworkType> {
		const frameworks = await this.detectFrameworks()
		return frameworks[0] || "generic"
	}

	private async readPackageJson(): Promise<any | null> {
		const packageJsonPath = path.join(this.workspaceRoot, "package.json")
		if (!fs.existsSync(packageJsonPath)) {
			return null
		}

		try {
			const content = fs.readFileSync(packageJsonPath, "utf8")
			return JSON.parse(content)
		} catch (error) {
			console.error("Failed to read package.json:", error)
			return null
		}
	}

	private async readRequirementsTxt(): Promise<string | null> {
		const requirementsPath = path.join(this.workspaceRoot, "requirements.txt")
		if (!fs.existsSync(requirementsPath)) {
			return null
		}

		try {
			return fs.readFileSync(requirementsPath, "utf8")
		} catch (error) {
			console.error("Failed to read requirements.txt:", error)
			return null
		}
	}

	// Framework detection methods

	private hasOdoo(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return Object.keys(deps).some((key) => key.includes("odoo"))
	}

	private hasReact(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return "react" in deps || "react-dom" in deps
	}

	private hasVue(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return "vue" in deps || "@vue/core" in deps
	}

	private hasAngular(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return Object.keys(deps).some((key) => key.startsWith("@angular/"))
	}

	private hasNextJs(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return "next" in deps
	}

	private hasNuxtJs(packageJson: any): boolean {
		const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
		return "nuxt" in deps || "nuxt3" in deps
	}

	private hasDjango(requirementsTxt: string): boolean {
		return requirementsTxt.toLowerCase().includes("django")
	}

	private hasFastAPI(requirementsTxt: string): boolean {
		return requirementsTxt.toLowerCase().includes("fastapi")
	}
}

/**
 * Base framework analyzer interface
 */
export interface IFrameworkAnalyzer {
	analyzeFile(filePath: string, content: string): Promise<any>
	extractRelationships(filePath: string, content: string): Promise<any>
	buildDependencyGraph(): Promise<any>
}

/**
 * Generic framework analyzer (default)
 */
export class GenericAnalyzer implements IFrameworkAnalyzer {
	async analyzeFile(filePath: string, content: string): Promise<any> {
		return {
			framework: "generic",
			metadata: {},
		}
	}

	async extractRelationships(filePath: string, content: string): Promise<any> {
		return {
			imports: [],
			exports: [],
		}
	}

	async buildDependencyGraph(): Promise<any> {
		return {
			nodes: [],
			edges: [],
		}
	}
}

/**
 * React framework analyzer
 */
export class ReactAnalyzer implements IFrameworkAnalyzer {
	async analyzeFile(filePath: string, content: string): Promise<any> {
		// TODO: Implement React-specific analysis
		// - Detect component type (class/functional)
		// - Extract props interface
		// - Find hooks usage
		// - Identify state management
		return {
			framework: "react",
			isComponent: this.isReactComponent(content),
			hooks: this.extractHooks(content),
		}
	}

	async extractRelationships(filePath: string, content: string): Promise<any> {
		return {
			imports: this.extractImports(content),
			exports: this.extractExports(content),
			propsFlow: [], // TODO: Track props passing
		}
	}

	async buildDependencyGraph(): Promise<any> {
		// TODO: Build React component hierarchy
		return {
			nodes: [],
			edges: [],
		}
	}

	private isReactComponent(content: string): boolean {
		return content.includes("React.Component") || (content.includes("function ") && content.includes("return ("))
	}

	private extractHooks(content: string): string[] {
		const hooks: string[] = []
		const hookPatterns = [
			/useState/g,
			/useEffect/g,
			/useContext/g,
			/useReducer/g,
			/useCallback/g,
			/useMemo/g,
			/useRef/g,
		]

		for (const pattern of hookPatterns) {
			if (pattern.test(content)) {
				hooks.push(pattern.source)
			}
		}

		return hooks
	}

	private extractImports(content: string): string[] {
		const imports: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			if (line.trim().startsWith("import ")) {
				imports.push(line.trim())
			}
		}

		return imports
	}

	private extractExports(content: string): string[] {
		const exports: string[] = []
		const lines = content.split("\n")

		for (const line of lines) {
			if (line.trim().startsWith("export ")) {
				exports.push(line.trim())
			}
		}

		return exports
	}
}

/**
 * Factory to get appropriate analyzer for framework
 */
export class FrameworkAnalyzerFactory {
	static getAnalyzer(framework: FrameworkType, workspaceRoot?: string): IFrameworkAnalyzer {
		const root = workspaceRoot || process.cwd()

		switch (framework) {
			case "react":
				return new ReactAnalyzer()
			case "odoo": {
				const { OdooAnalyzer } = require("./odoo-analyzer")
				return new OdooAnalyzer(root)
			}
			case "django": {
				const { DjangoAnalyzer } = require("./django-analyzer")
				return new DjangoAnalyzer(root)
			}
			// TODO: Add more analyzers
			// case "vue":
			//     return new VueAnalyzer()
			// case "angular":
			//     return new AngularAnalyzer()
			// case "nextjs":
			//     return new NextJsAnalyzer()
			default:
				return new GenericAnalyzer()
		}
	}
}
