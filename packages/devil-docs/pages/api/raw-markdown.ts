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
    // Normalize the path to resolve traversal sequences before checking bounds
    const sanitizedPath = path.normalize(mdPath).replace(/^\/+/, "")

    const pagesDir = path.join(process.cwd(), "pages")
    const resolvedPagesDir = path.resolve(pagesDir)

    // Verify bounds BEFORE any filesystem probes to prevent info leakage
    const candidatePath = path.resolve(pagesDir, `${sanitizedPath}.md`)
    const candidateIndexPath = path.resolve(pagesDir, sanitizedPath, "index.md")

    if (!candidatePath.startsWith(resolvedPagesDir) || !candidateIndexPath.startsWith(resolvedPagesDir)) {
      return res.status(403).json({ error: "Access denied" })
    }

    // Now safe to probe filesystem
    let resolvedPath = candidatePath
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = candidateIndexPath
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
