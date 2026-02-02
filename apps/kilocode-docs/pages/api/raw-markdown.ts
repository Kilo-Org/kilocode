import type { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== "GET") {
		return res.status(405).json({ error: "Method not allowed" })
	}

	const { path: mdPath } = req.query

	if (!mdPath || typeof mdPath !== "string") {
		return res.status(400).json({ error: "Missing path parameter" })
	}

	try {
		// Sanitize the path to prevent directory traversal
		const sanitizedPath = mdPath.replace(/\.\./g, "").replace(/^\/+/, "")

		// Construct the file path - try .md extension
		const pagesDir = path.join(process.cwd(), "pages")
		let filePath = path.join(pagesDir, `${sanitizedPath}.md`)

		// Check if it's an index file
		if (!fs.existsSync(filePath)) {
			filePath = path.join(pagesDir, sanitizedPath, "index.md")
		}

		// Verify the path is within the pages directory
		const resolvedPath = path.resolve(filePath)
		if (!resolvedPath.startsWith(path.resolve(pagesDir))) {
			return res.status(403).json({ error: "Access denied" })
		}

		if (!fs.existsSync(resolvedPath)) {
			return res.status(404).json({ error: "File not found" })
		}

		const content = fs.readFileSync(resolvedPath, "utf-8")

		res.setHeader("Content-Type", "text/plain; charset=utf-8")
		res.status(200).send(content)
	} catch (error) {
		console.error("Error reading markdown file:", error)
		res.status(500).json({ error: "Internal server error" })
	}
}
