/**
 * Django Framework Analyzer
 * Analyzes Django models, views, URLs, and templates
 */

import * as fs from "fs"
import * as path from "path"
import type { IFrameworkAnalyzer } from "./framework-detector"

export class DjangoAnalyzer implements IFrameworkAnalyzer {
	private workspaceRoot: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	async analyzeFile(filePath: string, content: string): Promise<any> {
		const filename = path.basename(filePath)

		if (filename === "models.py") {
			return this.analyzeModels(filePath, content)
		} else if (filename === "views.py") {
			return this.analyzeViews(filePath, content)
		} else if (filename === "urls.py") {
			return this.analyzeURLs(filePath, content)
		} else if (filename.endsWith(".html")) {
			return this.analyzeTemplate(filePath, content)
		}

		return {
			framework: "django",
			fileType: "unknown",
		}
	}

	private analyzeModels(filePath: string, content: string): any {
		const metadata: any = {
			framework: "django",
			fileType: "models",
			models: [],
			fields: [],
		}

		// Extract Django models
		const modelPattern = /class\s+(\w+)\(models\.Model\):/g
		let match
		while ((match = modelPattern.exec(content)) !== null) {
			metadata.models.push(match[1])
		}

		// Extract fields
		const fieldPattern = /(\w+)\s*=\s*models\.(CharField|IntegerField|BooleanField|ForeignKey|ManyToManyField)\(/g
		while ((match = fieldPattern.exec(content)) !== null) {
			metadata.fields.push({
				name: match[1],
				type: match[2],
			})
		}

		return metadata
	}

	private analyzeViews(filePath: string, content: string): any {
		const metadata: any = {
			framework: "django",
			fileType: "views",
			functionViews: [],
			classViews: [],
		}

		// Extract function-based views
		const funcViewPattern = /def\s+(\w+)\(request[^)]*\):/g
		let match
		while ((match = funcViewPattern.exec(content)) !== null) {
			metadata.functionViews.push(match[1])
		}

		// Extract class-based views
		const classViewPattern =
			/class\s+(\w+)\((ListView|DetailView|CreateView|UpdateView|DeleteView|TemplateView)\):/g
		while ((match = classViewPattern.exec(content)) !== null) {
			metadata.classViews.push({
				name: match[1],
				baseClass: match[2],
			})
		}

		return metadata
	}

	private analyzeURLs(filePath: string, content: string): any {
		const metadata: any = {
			framework: "django",
			fileType: "urls",
			patterns: [],
		}

		// Extract URL patterns
		const urlPattern = /path\(['"]([^'"]+)['"],\s*([^,\)]+)/g
		let match
		while ((match = urlPattern.exec(content)) !== null) {
			metadata.patterns.push({
				pattern: match[1],
				view: match[2].trim(),
			})
		}

		return metadata
	}

	private analyzeTemplate(filePath: string, content: string): any {
		const metadata: any = {
			framework: "django",
			fileType: "template",
			blocks: [],
			includes: [],
			extends: null,
		}

		// Extract template blocks
		const blockPattern = /\{%\s*block\s+(\w+)\s*%\}/g
		let match
		while ((match = blockPattern.exec(content)) !== null) {
			metadata.blocks.push(match[1])
		}

		// Extract includes
		const includePattern = /\{%\s*include\s+['"]([^'"]+)['"]/g
		while ((match = includePattern.exec(content)) !== null) {
			metadata.includes.push(match[1])
		}

		// Extract extends
		const extendsMatch = /\{%\s*extends\s+['"]([^'"]+)['"]/.exec(content)
		if (extendsMatch) {
			metadata.extends = extendsMatch[1]
		}

		return metadata
	}

	async extractRelationships(filePath: string, content: string): Promise<any> {
		const relationships: any = {
			modelToView: [],
			viewToTemplate: [],
			urlToView: [],
		}

		const filename = path.basename(filePath)

		// Extract model references from views
		if (filename === "views.py") {
			const modelPattern = /(\w+)\.objects/g
			let match
			while ((match = modelPattern.exec(content)) !== null) {
				relationships.modelToView.push({
					view: filePath,
					model: match[1],
				})
			}

			// Extract template references
			const templatePattern = /render\([^,]+,\s*['"]([^'"]+)['"]/g
			while ((match = templatePattern.exec(content)) !== null) {
				relationships.viewToTemplate.push({
					view: filePath,
					template: match[1],
				})
			}
		}

		// Extract view references from URLs
		if (filename === "urls.py") {
			const viewRefPattern = /path\([^,]+,\s*(\w+)/g
			let match
			while ((match = viewRefPattern.exec(content)) !== null) {
				relationships.urlToView.push({
					url: filePath,
					view: match[1],
				})
			}
		}

		return relationships
	}

	async buildDependencyGraph(): Promise<any> {
		const graph = {
			nodes: [] as any[],
			edges: [] as any[],
		}

		// Read settings.py to get installed apps
		const settingsPath = path.join(this.workspaceRoot, "settings.py")
		if (fs.existsSync(settingsPath)) {
			try {
				const content = fs.readFileSync(settingsPath, "utf8")

				// Extract INSTALLED_APPS
				const appsMatch = /INSTALLED_APPS\s*=\s*\[([\s\S]*?)\]/.exec(content)
				if (appsMatch) {
					const apps = appsMatch[1]
						.split(",")
						.map((app) => app.trim().replace(/['"]/g, ""))
						.filter((app) => app.length > 0)

					apps.forEach((app) => {
						graph.nodes.push({
							id: app,
							type: "django-app",
						})
					})
				}
			} catch (error) {
				console.error("Failed to parse settings.py:", error)
			}
		}

		return graph
	}
}
