import { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"

// Base URL for the site
const BASE_URL = "https://kilo.ai/docs"

// Function to recursively get all markdown files
function getAllMarkdownFiles(dir: string, baseDir: string = dir): string[] {
	const files: string[] = []
	const items = fs.readdirSync(dir)

	for (const item of items) {
		const fullPath = path.join(dir, item)
		const stat = fs.statSync(fullPath)

		if (stat.isDirectory()) {
			// Skip api directory
			if (item !== "api") {
				files.push(...getAllMarkdownFiles(fullPath, baseDir))
			}
		} else if (item.endsWith(".md")) {
			// Convert file path to URL path
			const relativePath = path.relative(baseDir, fullPath)
			const urlPath = relativePath
				.replace(/\\/g, "/") // Convert Windows paths
				.replace(/\.md$/, "") // Remove .md extension
				.replace(/\/index$/, "") // Remove /index from paths

			files.push(urlPath || "") // Empty string for root index
		}
	}

	return files
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
	try {
		const pagesDir = path.join(process.cwd(), "pages")
		const markdownFiles = getAllMarkdownFiles(pagesDir)

		// Generate sitemap XML
		const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${markdownFiles
	.map((file) => {
		const url = file ? `${BASE_URL}/${file}` : BASE_URL
		return `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>${file === "" ? "1.0" : "0.8"}</priority>
  </url>`
	})
	.join("\n")}
</urlset>`

		res.setHeader("Content-Type", "text/xml")
		res.status(200).send(sitemap)
	} catch (error) {
		console.error("Error generating sitemap:", error)
		res.status(500).json({ error: "Failed to generate sitemap" })
	}
}
