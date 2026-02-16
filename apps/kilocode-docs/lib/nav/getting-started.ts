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
				href: "/getting-started/using-kilo-for-free",
				children: "Using Kilo for Free",
			},
			{
				href: "/getting-started/byok",
				children: "Bring Your Own Key (BYOK)",
			},
			{ href: "/ai-providers", children: "AI Providers" },
			{
				href: "/getting-started/settings",
				children: "Settings",
				subLinks: [
					{ href: "/getting-started/settings/auto-approving-actions", children: "Auto-Approving Actions" },
					{ href: "/getting-started/settings/auto-cleanup", children: "Auto Cleanup" },
					{ href: "/getting-started/settings/system-notifications", children: "System Notifications" },
				],
			},
			{ href: "/getting-started/adding-credits", children: "Adding Credits" },
			{ href: "/getting-started/rate-limits-and-costs", children: "Rate Limits and Costs" },
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
