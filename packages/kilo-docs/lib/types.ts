export type Platform = "legacy" | "new" | "all"

export interface NavLink {
  href: string
  children: string
  platform?: Platform // "legacy" = stable VSCode only, "new" = new VSCode + CLI only, omitted = universal
  subLinks?: NavLink[] // Optional nested links for second-level navigation
}

export interface NavSection {
  title: string
  links: NavLink[]
}

export interface SectionNav {
  [key: string]: NavSection[]
}
