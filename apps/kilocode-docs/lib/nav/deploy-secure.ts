import { NavSection } from "../types"

export const DeploySecureNav: NavSection[] = [
	{
		title: "Deployment",
		links: [
			{ href: "/deploy-secure", children: "Overview" },
			{ href: "/deploy-secure/deploy", children: "Deploy" },
			{ href: "/deploy-secure/managed-indexing", children: "Managed Indexing" },
		],
	},
	{
		title: "Security",
		links: [{ href: "/deploy-secure/security-reviews", children: "Security Reviews" }],
	},
]
