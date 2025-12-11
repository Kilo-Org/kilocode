import { type AgentPageContent } from "@/app/shared/agent-page-content"
import Link from "next/link"

// Workaround for next/image choking on these for some reason
const hero = { src: "hero" } // kilocode_change: import hero from "/public/heroes/agent-pr-fixer.png"

// Re-export for convenience
export type { AgentPageContent }

export const content: AgentPageContent = {
	agentName: "PR Fixer",
	hero: {
		icon: "Wrench",
		heading: "State-of-the-art fixes for the comments on your PRs.",
		paragraphs: [
			"Roo Code's PR Fixer applies high-quality changes to your PRs, right from GitHub. Invoke via a PR comment and it will read the entire comment history to understand context, agreements, and tradeoffs — then implement the right fix.",
			"As always, you bring the model key; we orchestrate smart, efficient workflows.",
		],
		image: {
			url: hero.src,
			width: 800,
			height: 711,
			alt: "Example of a PR Fixer applying changes from review comments",
		},
		crossAgentLink: {
			text: "Works great with",
			links: [
				{
					text: "PR Reviewer Agent",
					href: "/reviewer",
					icon: "GitPullRequest",
				},
			],
		},
		cta: {
			buttonText: "Try now for free",
			disclaimer: "",
			tracking: "&agent=pr-fixer",
		},
	},
	howItWorks: {
		heading: "How It Works",
		steps: [
			{
				title: "1. Connect your GitHub repositories",
				description: "Pick which repos the PR Fixer can work on by pushing to ongoing branches.",
				icon: "GitPullRequest",
			},
			{
				title: "2. Invoke from a comment",
				description:
					'Ask the agent to fix issues directly from GitHub PR comments (e.g. "@roomote: fix these review comments"). It\'s fully aware of the entire comment history and latest diffs and focuses on fixing them – not random changes to your code.',
				icon: "MessageSquareCode",
			},
			{
				title: "3. Get clean scoped commits",
				description: (
					<>
						The agent proposes targeted changes and pushes concise commits or patch suggestions you (or{" "}
						<Link href="/reviewer">PR Reviewer</Link>) can review and merge quickly.
					</>
				),
				icon: "Wrench",
			},
		],
	},
	whyBetter: {
		heading: "Why Roo Code's PR Fixer is different",
		features: [
			{
				title: "Comment-history aware",
				description:
					"Understands the entire conversation on the PR – previous reviews, your replies, follow-ups – and uses that context to produce accurate fixes.",
				icon: "History",
			},
			{
				title: "Bring your own key",
				description:
					"Use your preferred models at full strength. We optimize prompts and execution without capping your model to protect our margins.",
				icon: "Key",
			},
			{
				title: "Repository- and diff-aware",
				description:
					"Analyzes the full repo context and the latest diff to ensure fixes align with project conventions and pass checks.",
				icon: "GitPullRequest",
			},
		],
	},
	cta: {
		heading: "Ship fixes, not follow-ups.",
		description: "Let Roo Code's PR Fixer turn your review feedback into clean, ready-to-merge commits.",
		buttonText: "Try now for free",
	},
}
