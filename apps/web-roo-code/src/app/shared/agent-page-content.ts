/**
 * Supported icon names that can be used in agent page content.
 * These strings are mapped to actual Lucide components in the client.
 */
export type IconName =
	| "GitPullRequest"
	| "Wrench"
	| "Key"
	| "MessageSquareCode"
	| "Blocks"
	| "ListChecks"
	| "BookMarked"
	| "History"

/**
 * Generic content structure for agent landing pages.
 * This interface can be reused across different agent pages (PR Reviewer, PR Fixer, etc.)
 * to maintain consistency and enable A/B testing capabilities.
 *
 * Note: Icons are referenced by string names (not components) to support
 * serialization from Server Components to Client Components.
 */
export interface AgentPageContent {
	agentName: string
	hero: {
		/** Optional icon name to display in the hero section */
		icon?: IconName
		heading: string
		paragraphs: string[]
		image?: {
			url: string
			width: number
			height: number
			alt?: string
		}
		crossAgentLink: {
			text: string
			links: Array<{
				text: string
				href: string
				icon?: IconName
			}>
		}
		cta: {
			buttonText: string
			disclaimer: string
			tracking: string
		}
	}
	howItWorks: {
		heading: string
		steps: Array<{
			title: string
			/** Supports rich text content including React components */
			description: string | React.ReactNode
			icon?: IconName
		}>
	}
	whyBetter: {
		heading: string
		features: Array<{
			title: string
			/** Supports rich text content including React components */
			description?: string | React.ReactNode
			/** Supports rich text content including React components */
			paragraphs?: Array<string | React.ReactNode>
			icon?: IconName
		}>
	}
	cta: {
		heading: string
		description: string
		buttonText: string
	}
}
