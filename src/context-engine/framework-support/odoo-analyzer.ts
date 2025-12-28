/**
 * Odoo Framework Analyzer
 * Analyzes Odoo modules, XML views, and Python models
 */

import * as fs from "fs"
import * as path from "path"
import type { IFrameworkAnalyzer } from "./framework-detector"

export class OdooAnalyzer implements IFrameworkAnalyzer {
	private workspaceRoot: string

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	async analyzeFile(filePath: string, content: string): Promise<any> {
		const ext = path.extname(filePath)

		if (ext === ".py") {
			return this.analyzePythonModel(filePath, content)
		} else if (ext === ".xml") {
			return this.analyzeXMLView(filePath, content)
		}

		return {
			framework: "odoo",
			fileType: "unknown",
		}
	}

	private analyzePythonModel(filePath: string, content: string): any {
		const metadata: any = {
			framework: "odoo",
			fileType: "python-model",
			models: [],
			inherits: [],
			fields: [],
		}

		// Extract Odoo models
		const modelPattern = /class\s+(\w+)\(models\.Model\):/g
		let match
		while ((match = modelPattern.exec(content)) !== null) {
			metadata.models.push(match[1])
		}

		// Extract _inherit
		const inheritPattern = /_inherit\s*=\s*['"]([^'"]+)['"]/g
		while ((match = inheritPattern.exec(content)) !== null) {
			metadata.inherits.push(match[1])
		}

		// Extract fields
		const fieldPattern = /(\w+)\s*=\s*fields\.(Char|Integer|Boolean|Many2one|One2many|Many2many)\(/g
		while ((match = fieldPattern.exec(content)) !== null) {
			metadata.fields.push({
				name: match[1],
				type: match[2],
			})
		}

		return metadata
	}

	private analyzeXMLView(filePath: string, content: string): any {
		const metadata: any = {
			framework: "odoo",
			fileType: "xml-view",
			views: [],
			menuItems: [],
		}

		// Extract view records
		const viewPattern = /<record[^>]+id="([^"]+)"[^>]+model="ir\.ui\.view"/g
		let match
		while ((match = viewPattern.exec(content)) !== null) {
			metadata.views.push(match[1])
		}

		// Extract menu items
		const menuPattern = /<menuitem[^>]+id="([^"]+)"/g
		while ((match = menuPattern.exec(content)) !== null) {
			metadata.menuItems.push(match[1])
		}

		return metadata
	}

	async extractRelationships(filePath: string, content: string): Promise<any> {
		const relationships: any = {
			pythonToXml: [],
			xmlToPython: [],
			modelInheritance: [],
		}

		// Extract model to view relationships
		if (path.extname(filePath) === ".xml") {
			const modelPattern = /model="([^"]+)"/g
			let match
			while ((match = modelPattern.exec(content)) !== null) {
				relationships.xmlToPython.push({
					xmlFile: filePath,
					model: match[1],
				})
			}
		}

		// Extract inheritance relationships
		if (path.extname(filePath) === ".py") {
			const inheritPattern = /_inherit\s*=\s*['"]([^'"]+)['"]/g
			let match
			while ((match = inheritPattern.exec(content)) !== null) {
				relationships.modelInheritance.push({
					file: filePath,
					inherits: match[1],
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

		// Read __manifest__.py to get module dependencies
		const manifestPath = path.join(this.workspaceRoot, "__manifest__.py")
		if (fs.existsSync(manifestPath)) {
			try {
				const content = fs.readFileSync(manifestPath, "utf8")

				// Extract module name
				const nameMatch = /'name':\s*'([^']+)'/.exec(content)
				if (nameMatch) {
					graph.nodes.push({
						id: nameMatch[1],
						type: "module",
					})
				}

				// Extract dependencies
				const depsMatch = /'depends':\s*\[([\s\S]*?)\]/.exec(content)
				if (depsMatch) {
					const deps = depsMatch[1]
						.split(",")
						.map((d) => d.trim().replace(/['"]/g, ""))
						.filter((d) => d.length > 0)

					deps.forEach((dep) => {
						graph.edges.push({
							from: nameMatch ? nameMatch[1] : "unknown",
							to: dep,
							type: "depends",
						})
					})
				}
			} catch (error) {
				console.error("Failed to parse __manifest__.py:", error)
			}
		}

		return graph
	}
}
