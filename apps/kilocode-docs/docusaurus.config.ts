import { themes as prismThemes } from "prism-react-renderer"
import type { Config } from "@docusaurus/types"
import type * as Preset from "@docusaurus/preset-classic"
import {
	DISCORD_URL,
	REDDIT_URL,
	TWITTER_URL,
	GITHUB_MAIN_REPO_URL,
	GITHUB_ISSUES_MAIN_URL,
	GITHUB_FEATURES_URL,
	VSCODE_MARKETPLACE_URL,
	OPEN_VSX_URL,
	CONTACT_EMAIL,
	CAREERS_URL,
	WEBSITE_PRIVACY_URL,
	EXTENSION_PRIVACY_URL,
	GITHUB_REPO_URL,
} from "./src/constants"

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
	title: "Kilo Code Docs",
	tagline: "Kilo Code Documentation",
	favicon: "img/favicon.ico",

	// Set the production url of your site here
	url: "https://kilo.ai",
	// Set the /<baseUrl>/ pathname under which your site is served
	// For GitHub pages deployment, it is often '/<projectName>/'
	baseUrl: "/docs",

	customFields: {
		freeTierAmount: process.env.FREE_TIER_AMOUNT || "$20",
	},

	onBrokenLinks: "throw",
	onBrokenMarkdownLinks: "warn",

	// Even if you don't use internationalization, you can use this field to set
	// useful metadata like html lang. For example, if your site is Chinese, you
	// may want to replace "en" with "zh-Hans".
	i18n: {
		defaultLocale: "en",
		locales: ["en", "zh-CN"],
	},

	presets: [
		[
			"classic",
			{
				docs: {
					sidebarPath: "./sidebars.ts",
					routeBasePath: "/",
					editUrl: `${GITHUB_MAIN_REPO_URL}/edit/main/apps/kilocode-docs/`,
					showLastUpdateTime: true,
				},
				blog: false, // Disable blog feature
				sitemap: {
					lastmod: "date",
					priority: null,
					changefreq: null,
				},
				theme: {
					customCss: "./src/css/custom.css",
				},
			} satisfies Preset.Options,
		],
	],

	themes: [
		[
			require.resolve("@easyops-cn/docusaurus-search-local"),
			{
				hashed: true,
				language: ["en"],
				highlightSearchTermsOnTargetPage: false,
				explicitSearchResultPath: true,
				docsRouteBasePath: "/",
			},
		],
	],

	plugins: [
		...(process.env.POSTHOG_API_KEY
			? [
					[
						"posthog-docusaurus",
						{
							apiKey: process.env.POSTHOG_API_KEY,
							appUrl: "https://us.i.posthog.com",
							enableInDevelopment: true,
						},
					],
				]
			: []),
		[
			"@docusaurus/plugin-client-redirects",
			{
				createRedirects(existingPath) {
					// Redirect old /contributing/specs/spec-* paths to /contributing/architecture/*
					if (existingPath.startsWith("/contributing/architecture/")) {
						const filename = existingPath.replace("/contributing/architecture/", "")
						return [
							`/contributing/specs/spec-${filename}`, // spec- prefix
							`/contributing/specs/${filename}`, // without prefix
						]
					}
					return undefined
				},
				redirects: [
					// Files moved from advanced-usage to features
					{
						to: "/features/checkpoints",
						from: ["/advanced-usage/checkpoints"],
					},
					{
						to: "/features/code-actions",
						from: ["/advanced-usage/code-actions"],
					},
					{
						to: "/agent-behavior/custom-instructions",
						from: [
							"/advanced-usage/custom-instructions",
							"/features/custom-instructions",
							"/customization/custom-instructions",
						],
					},
					{
						to: "/agent-behavior/custom-modes",
						from: ["/features/custom-modes", "/advanced-usage/custom-modes", "/customization/custom-modes"],
					},
					{
						to: "/agent-behavior/custom-rules",
						from: ["/advanced-usage/custom-rules", "/customization/custom-rules"],
					},
					{
						to: "/agent-behavior/skills",
						from: ["/features/skills", "/customization/skills"],
					},
					{
						to: "/agent-behavior/workflows",
						from: ["/features/slash-commands/workflows", "/customization/workflows"],
					},
					{
						to: "/basic-usage/settings-management",
						from: ["/features/settings-management", "/customization/settings-management"],
					},
					{
						to: "/agent-behavior/prompt-engineering",
						from: ["/advanced-usage/prompt-engineering"],
					},
					{
						to: "/features/enhance-prompt",
						from: ["/advanced-usage/enhance-prompt"],
					},
					{
						to: "/features/experimental/experimental-features",
						from: ["/advanced-usage/experimental-features"],
					},
					{
						to: "/features/model-temperature",
						from: ["/advanced-usage/model-temperature"],
					},
					{
						to: "/features/auto-approving-actions",
						from: ["/advanced-usage/auto-approving-actions"],
					},
					{
						to: "/features/api-configuration-profiles",
						from: ["/advanced-usage/api-configuration-profiles"],
					},

					{
						to: "/slack",
						from: ["/advanced-usage/slackbot"],
					},

					// MCP related redirects
					{
						to: "/features/mcp/overview",
						from: ["/advanced-usage/mcp", "/mcp/overview"],
					},
					{
						to: "/features/mcp/using-mcp-in-kilo-code",
						from: ["/mcp/using-mcp-in-kilo-code"],
					},
					{
						to: "/features/mcp/what-is-mcp",
						from: ["/mcp/what-is-mcp"],
					},
					{
						to: "/features/mcp/server-transports",
						from: ["/mcp/server-transports"],
					},
					{
						to: "/features/mcp/mcp-vs-api",
						from: ["/mcp/mcp-vs-api"],
					},

					// Kilo credits, not tokens
					{
						to: "/basic-usage/adding-credits",
						from: ["/basic-usage/adding-tokens"],
					},
					// Change to plans language
					{
						to: "/plans/about",
						from: ["/seats/about"],
					},
					{
						to: "/plans/getting-started",
						from: ["/seats/getting-started"],
					},
					{
						to: "/plans/dashboard",
						from: ["/seats/dashboard"],
					},
					{
						to: "/plans/analytics",
						from: ["/seats/analytics"],
					},
					{
						to: "/plans/team-management",
						from: ["/seats/team-management"],
					},
					{
						to: "/plans/custom-modes",
						from: ["/seats/custom-modes"],
					},
					{
						to: "/plans/billing",
						from: ["/seats/billing"],
					},
					{
						to: "/plans/enterprise/SSO",
						from: ["/seats/enterprise/SSO"],
					},
					{
						to: "/plans/enterprise/model-access",
						from: ["/seats/enterprise/model-access"],
					},
					{
						to: "/plans/enterprise/audit-logs",
						from: ["/seats/enterprise/audit-logs"],
					},
					{
						to: "/plans/migration",
						from: ["/seats/migration"],
					},
					// Contributing page relocation
					{
						to: "/contributing",
						from: ["/extending/contributing-to-kilo"],
					},
					{
						to: "/contributing/development-environment",
						from: ["/extending/development-environment"],
					},
				],
			},
		],
	],

	themeConfig: {
		image: "img/kilo-v1.svg",
		navbar: {
			title: "Kilo Code",
			logo: {
				alt: "Kilo Code Logo",
				src: "img/kilo-v1.svg",
				srcDark: "img/kilo-v1-white.svg",
				href: "/",
				target: "_self",
			},
			items: [
				{
					href: GITHUB_MAIN_REPO_URL,
					label: "GitHub",
					position: "right",
				},
				{
					href: VSCODE_MARKETPLACE_URL,
					label: "Install Extension",
					position: "right",
				},
				{
					type: "localeDropdown",
					position: "right",
				},
			],
		},
		footer: {
			style: "dark",
			links: [
				{
					title: "Community",
					items: [
						{
							label: "Discord",
							href: DISCORD_URL,
						},
						{
							label: "Reddit",
							href: REDDIT_URL,
						},
						{
							label: "Twitter",
							href: TWITTER_URL,
						},
					],
				},
				{
					title: "GitHub",
					items: [
						{
							label: "Issues",
							href: GITHUB_ISSUES_MAIN_URL,
						},
						{
							label: "Feature Requests",
							href: GITHUB_FEATURES_URL,
						},
					],
				},
				{
					title: "Download",
					items: [
						{
							label: "VS Code Marketplace",
							href: VSCODE_MARKETPLACE_URL,
						},
						{
							label: "Open VSX Registry",
							href: OPEN_VSX_URL,
						},
					],
				},
				{
					title: "Company",
					items: [
						{
							label: "Contact",
							href: CONTACT_EMAIL,
							target: "_self",
						},
						{
							label: "Careers",
							href: CAREERS_URL,
						},
						{
							label: "Website Privacy Policy",
							href: WEBSITE_PRIVACY_URL,
						},
						{
							label: "Extension Privacy Policy",
							href: EXTENSION_PRIVACY_URL,
						},
					],
				},
			],
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
		},
	} satisfies Preset.ThemeConfig,
}

export default config
