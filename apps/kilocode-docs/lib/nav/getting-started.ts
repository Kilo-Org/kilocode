import { NavSection } from "../types"

export const GettingStartedNav: NavSection[] = [
	{
		title: "Introduction",
		links: [
			{ href: "/getting-started", children: "Overview" },
			{ href: "/getting-started/installing", children: "Installation" },
			{ href: "/getting-started/quickstart", children: "Quickstart" },
		],
	},
	{
		title: "Configuration",
		links: [
			{
				href: "/getting-started/setup-authentication",
				children: "Setup & Authentication",
			},
			{
				href: "/getting-started/byok",
				children: "Bring Your Own Key (BYOK)",
			},
			{ href: "/ai-providers", children: "AI Providers" },
			{ href: "/getting-started/settings", children: "Settings" },
			{ href: "/getting-started/adding-credits", children: "Adding Credits" },
		],
	},
	{
		title: "Help",
		links: [
			{ href: "/getting-started/faq", children: "FAQ" },
			{
				href: "/getting-started/migrating",
				children: "Migrating from Cursor",
			},
		],
	},
]
