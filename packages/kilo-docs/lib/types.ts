export type Platform = "classic" | "next" | "all"

export interface NavLink {
  href: string
  children: string
  platform?: Platform // "classic" = 5.x only, "next" = 7.x+ only, "all" or omitted = universal
  subLinks?: NavLink[] // Optional nested links for second-level navigation
}

export interface NavSection {
  title: string
  links: NavLink[]
}

export interface SectionNav {
  [key: string]: NavSection[]
}
