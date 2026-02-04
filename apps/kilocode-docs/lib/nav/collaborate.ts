import { NavSection } from "../types"

export const CollaborateNav: NavSection[] = [
	{
		title: "Sharing",
		links: [
			{ href: "/collaborate", children: "Overview" },
			{ href: "/collaborate/sessions-sharing", children: "Sessions & Sharing" },
		],
	},
	{
		title: "Kilo for Teams",
		links: [
			{ href: "/collaborate/teams/about-plans", children: "About Plans" },
			{
				href: "/collaborate/teams/getting-started",
				children: "Getting Started with Teams",
			},
			{ href: "/collaborate/teams/dashboard", children: "Dashboard" },
			{
				href: "/collaborate/teams/team-management",
				children: "Team Management",
			},
			{
				href: "/collaborate/teams/custom-modes-org",
				children: "Custom Modes (Org)",
			},
			{ href: "/collaborate/teams/billing", children: "Billing" },
			{ href: "/collaborate/teams/analytics", children: "Analytics" },
		],
	},
	{
		title: "AI Adoption Dashboard",
		links: [
			{
				href: "/collaborate/adoption-dashboard/overview",
				children: "Overview",
			},
			{
				href: "/collaborate/adoption-dashboard/understanding-your-score",
				children: "Understanding Your Score",
			},
			{
				href: "/collaborate/adoption-dashboard/improving-your-score",
				children: "Improving Your Score",
			},
			{
				href: "/collaborate/adoption-dashboard/for-team-leads",
				children: "For Team Leads",
			},
		],
	},
	{
		title: "Enterprise",
		links: [
			{ href: "/collaborate/enterprise/sso", children: "SSO" },
			{
				href: "/collaborate/enterprise/model-access-controls",
				children: "Model Access Controls",
			},
			{ href: "/collaborate/enterprise/audit-logs", children: "Audit Logs" },
			{ href: "/collaborate/enterprise/migration", children: "Migration" },
		],
	},
]
