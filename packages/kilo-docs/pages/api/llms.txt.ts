import type { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"
import { Nav } from "../../lib/nav"
import type { NavLink, NavSection } from "../../lib/types"

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

function extractFrontmatterTitle(content: string): string | null {
  const match = content.match(/^---\n[\s\S]*?^title:\s*"?([^"\n]+)"?\s*$[\s\S]*?^---\n/m)
  if (!match) return null
  return match[1]?.trim() || null
}

function buildTitleMap(markdownFiles: string[], pagesDir: string) {
  const map = new Map<string, string>()

  for (const filePath of markdownFiles) {
    const urlPath = filePathToUrlPath(filePath, pagesDir)
    const content = fs.readFileSync(filePath, "utf-8")
    const title = extractFrontmatterTitle(content)
    if (title) {
      map.set(urlPath, title)
    }
  }

  return map
}

function addNavLink(items: string[], link: NavLink, baseUrl: string, depth: number, titleMap: Map<string, string>) {
  const indent = "  ".repeat(depth)
  const rawUrl = `${baseUrl}/api/raw-markdown?path=${encodeURIComponent(link.href)}`
  const title = titleMap.get(link.href) || link.children
  items.push(`${indent}- [${title}](${rawUrl})`)

  if (link.subLinks) {
    for (const subLink of link.subLinks) {
      addNavLink(items, subLink, baseUrl, depth + 1, titleMap)
    }
  }
}

function addNavSection(items: string[], section: NavSection, baseUrl: string, titleMap: Map<string, string>) {
  items.push(`### ${section.title}`)
  items.push("")

  for (const link of section.links) {
    addNavLink(items, link, baseUrl, 0, titleMap)
  }

  items.push("")
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
    const protocol = req.headers["x-forwarded-proto"] || "https"
    const host = req.headers.host || "kilo.ai"
    const baseUrl = `${protocol}://${host}`
    const titleMap = buildTitleMap(markdownFiles, pagesDir)

    sections.push("## Page Index")
    sections.push("")
    sections.push("Each page is available as raw markdown via the /api/raw-markdown endpoint.")
    sections.push("")

    const navGroups = [
      { title: "Getting Started", nav: Nav.GettingStartedNav },
      { title: "Code with AI", nav: Nav.CodeWithAiNav },
      { title: "Customize", nav: Nav.CustomizeNav },
      { title: "Collaborate", nav: Nav.CollaborateNav },
      { title: "Automate", nav: Nav.AutomateNav },
      { title: "Deploy & Secure", nav: Nav.DeploySecureNav },
      { title: "Contributing", nav: Nav.ContributingNav },
      { title: "AI Providers", nav: Nav.AiProvidersNav },
      { title: "Gateway", nav: Nav.GatewayNav },
      { title: "Tools", nav: Nav.ToolsNav },
    ]

    for (const group of navGroups) {
      sections.push(`## ${group.title}`)
      sections.push("")

      for (const section of group.nav) {
        addNavSection(sections, section, baseUrl, titleMap)
      }
    }

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
