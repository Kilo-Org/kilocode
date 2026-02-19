import { NavSection } from "../types"

export const GatewayNav: NavSection[] = [
	{
		title: "Introduction",
		links: [
			{ href: "/gateway", children: "Overview" },
			{ href: "/gateway/quickstart", children: "Quickstart" },
		],
	},
	{
		title: "Configuration",
		links: [
			{ href: "/gateway/authentication", children: "Authentication" },
			{ href: "/gateway/models-and-providers", children: "Models & Providers" },
		],
	},
	{
		title: "Features",
		links: [
			{ href: "/gateway/streaming", children: "Streaming" },
			{ href: "/gateway/usage-and-billing", children: "Usage & Billing" },
		],
	},
	{
		title: "Reference",
		links: [
			{ href: "/gateway/api-reference", children: "API Reference" },
			{ href: "/gateway/sdks-and-frameworks", children: "SDKs & Frameworks" },
		],
	},
]
