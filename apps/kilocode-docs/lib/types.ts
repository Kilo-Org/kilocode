export interface NavLink {
	href: string
	children: string
}

export interface NavSection {
	title: string
	links: NavLink[]
}

export interface SectionNav {
	[key: string]: NavSection[]
}
