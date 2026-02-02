export interface NavLink {
	href: string
	children: string
	subLinks?: NavLink[] // Optional nested links for second-level navigation
}

export interface NavSection {
	title: string
	links: NavLink[]
}

export interface SectionNav {
	[key: string]: NavSection[]
}
