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
		],
	},
	{
		title: "Architecture",
		links: [
			{ href: "/contributing/architecture", children: "Architecture Overview" },
			{
				href: "/contributing/architecture/annual-billing",
				children: "Annual Billing",
			},
			{
				href: "/contributing/architecture/enterprise-mcp-controls",
				children: "Enterprise MCP Controls",
			},
			{
				href: "/contributing/architecture/onboarding-improvements",
				children: "Onboarding Improvements",
			},
			{
				href: "/contributing/architecture/organization-modes-library",
				children: "Organization Modes Library",
			},
			{
				href: "/contributing/architecture/track-repo-url",
				children: "Track Repo URL",
			},
			{
				href: "/contributing/architecture/vercel-ai-gateway",
				children: "Vercel AI Gateway",
			},
			{
				href: "/contributing/architecture/voice-transcription",
				children: "Voice Transcription",
			},
		],
	},
]
