import { NavSection } from "../types"

export const ContributingNav: NavSection[] = [
	{
		title: "Getting Started",
		links: [
			{ href: "/contributing", children: "Contributing Overview" },
			{
				href: "/contributing/development-environment",
				children: "Development Environment",
			},
			{
				href: "/contributing/cline-to-kilo-migration",
				children: "Cline to Kilo Migration",
			},
		],
	},
	{
		title: "Architecture",
		links: [{ href: "/contributing/architecture", children: "Architecture Overview" }],
	},
]
