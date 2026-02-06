import type { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"

const SITE_URL = "https://kilo.ai/docs"

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
	relativePath = relativePath.replace(/(^|\/)index$/, "")
	// Convert to URL path
	return "/" + relativePath.split(path.sep).join("/")
}

/**
 * Gets the last modified date of a file
 */
function getLastModified(filePath: string): string {
	const stats = fs.statSync(filePath)
	return stats.mtime.toISOString().split("T")[0]
}

/**
 * Escapes special XML characters
 */
function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
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

		const urls: string[] = []

		// Add homepage
		urls.push(`  <url>
    <loc>${SITE_URL}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`)

		for (const filePath of markdownFiles) {
			const urlPath = filePathToUrlPath(filePath, pagesDir)
			const lastMod = getLastModified(filePath)
			const fullUrl = `${SITE_URL}${urlPath}`

			// Determine priority based on path depth
			const depth = urlPath.split("/").filter(Boolean).length
			const priority = Math.max(0.5, 1.0 - depth * 0.1).toFixed(1)

			urls.push(`  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`)
		}

		const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`

		res.setHeader("Content-Type", "application/xml; charset=utf-8")
		res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600") // Cache for 1 hour
		res.status(200).send(sitemap)
	} catch (error) {
		console.error("Error generating sitemap:", error)
		res.status(500).json({ error: "Internal server error" })
	}
}
