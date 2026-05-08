import type { NextApiRequest, NextApiResponse } from "next"
import { Nav } from "../../lib/nav"
import type { NavLink, NavSection } from "../../lib/types"

const origin = "https://kilo.ai"
const base = "/docs"

function links(sections: NavSection[]): string[] {
  const out: string[] = []
  function walk(items: NavLink[]) {
    for (const item of items) {
      out.push(item.href)
      if (item.subLinks) walk(item.subLinks)
    }
  }
  for (const s of sections) walk(s.links)
  return out
}

export function buildSitemapXml(): string {
  const all = Object.values(Nav).flatMap(links)
  const hrefs = Array.from(new Set(["", ...all])).sort()
  const urls = hrefs.map((h) => `  <url><loc>${origin}${base}${h}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

export default function handler(_: NextApiRequest, res: NextApiResponse) {
  const xml = buildSitemapXml()
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400")
  res.status(200).send(xml)
}
