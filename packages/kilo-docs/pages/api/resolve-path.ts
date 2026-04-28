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

  const sanitizedPath = path.normalize(mdPath).replace(/^\/+/, "")
  const pagesDir = path.join(process.cwd(), "pages")
  const resolvedPagesDir = path.resolve(pagesDir)

  const candidatePath = path.resolve(pagesDir, `${sanitizedPath}.md`)
  const candidateIndexPath = path.resolve(pagesDir, sanitizedPath, "index.md")

  if (!candidatePath.startsWith(resolvedPagesDir) || !candidateIndexPath.startsWith(resolvedPagesDir)) {
    return res.status(403).json({ error: "Access denied" })
  }

  if (fs.existsSync(candidatePath)) {
    return res.status(200).json({ filePath: `packages/kilo-docs/pages/${sanitizedPath}.md` })
  }

  if (fs.existsSync(candidateIndexPath)) {
    return res.status(200).json({ filePath: `packages/kilo-docs/pages/${sanitizedPath}/index.md` })
  }

  return res.status(404).json({ error: "File not found" })
}
