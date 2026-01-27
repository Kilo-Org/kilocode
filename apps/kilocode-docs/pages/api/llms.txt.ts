import type { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"

/**
 * Recursively finds all markdown files in a directory
 */
function findMarkdownFiles(dir: string, baseDir: string = dir): string[] {
	const files: string[] = []
	const entries = fs.readdirSync(dir, { withFileTypes: true })

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			// Skip api directory
			if (entry.name === "api") continue
			files.push(...findMarkdownFiles(fullPath, baseDir))
		} else if (entry.name.endsWith(".md")) {
			files.push(fullPath)
		}
	}

	return files
}

/**
 * Converts a file path to a URL path
 */
function filePathToUrlPath(filePath: string, pagesDir: string): string {
	let relativePath = path.relative(pagesDir, filePath)
	// Remove .md extension
	relativePath = relativePath.replace(/\.md$/, "")
	// Handle index files
	relativePath = relativePath.replace(/\/index$/, "")
	// Convert to URL path
	return "/" + relativePath
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" })
	}

	try {
		const pagesDir = path.join(process.cwd(), "pages")
		const markdownFiles = findMarkdownFiles(pagesDir)

		// Sort files for consistent output
		markdownFiles.sort()

		const sections: string[] = []

		// Add header
		sections.push("# Kilo Code Documentation")
		sections.push("")
		sections.push(
			"This file contains the complete documentation for Kilo Code, the leading open source agentic engineering platform.",
		)
		sections.push("")
		sections.push("---")
		sections.push("")

		for (const filePath of markdownFiles) {
			const urlPath = filePathToUrlPath(filePath, pagesDir)
			const content = fs.readFileSync(filePath, "utf-8")

			sections.push(`## Source: ${urlPath}`)
			sections.push("")
			sections.push(content)
			sections.push("")
			sections.push("---")
			sections.push("")
		}

		const output = sections.join("\n")

		res.setHeader("Content-Type", "text/plain; charset=utf-8")
		res.setHeader("Cache-Control", "public, max-age=3600") // Cache for 1 hour
		res.status(200).send(output)
	} catch (error) {
		console.error("Error generating llms.txt:", error)
		res.status(500).json({ error: "Internal server error" })
	}
}
