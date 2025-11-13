"use client"

import { ArrowRight, GitPullRequest, History, Key, MessageSquareCode, Wrench, type LucideIcon } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui"
import { AnimatedBackground } from "@/components/homepage"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { trackGoogleAdsConversion } from "@/lib/analytics/google-ads"

// Workaround for next/image choking on these for some reason
const hero = "hero" // kilocode_change from: import hero from "/public/heroes/agent-pr-fixer.png"

interface Feature {
	icon: LucideIcon
	title: string
	description: string | React.ReactNode
	logos?: string[]
}

const workflowSteps: Feature[] = [
	{
		icon: GitPullRequest,
		title: "1. Connect your GitHub repositories",
		description: "Pick which repos the PR Fixer can work on by pushing to ongoing branches.",
	},
	{
		icon: MessageSquareCode,
		title: "2. Invoke from a comment",
		description:
			'Ask the agent to fix issues directly from GitHub PR comments (e.g. "@roomote: fix these review comments"). It’s fully aware of the entire comment history and latest diffs and focuses on fixing them – not random changes to your code.',
	},
	{
		icon: Wrench,
		title: "3. Get clean scoped commits",
		description: (
			<>
				The agent proposes targeted changes and pushes concise commits or patch suggestions you (or{" "}
				<Link href="/pr-reviewer">PR Reviewer</Link>) can review and merge quickly.
			</>
		),
	},
]

const howItWorks: Feature[] = [
	{
		icon: History,
		title: "Comment-history aware",
		description:
			"Understands the entire conversation on the PR – previous reviews, your replies, follow-ups – and uses that context to produce accurate fixes.",
	},
	{
		icon: Key,
		title: "Bring your own key",
		description:
			"Use your preferred models at full strength. We optimize prompts and execution without capping your model to protect our margins.",
	},
	{
		icon: GitPullRequest,
		title: "Repository- and diff-aware",
		description:
			"Analyzes the full repo context and the latest diff to ensure fixes align with project conventions and pass checks.",
	},
]

export function PrFixerContent() {
	return (
		<>
			<section className="relative flex md:h-[calc(70vh-theme(spacing.12))] items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-4 md:gap-20 lg:grid-cols-2">
						<div className="flex flex-col px-4 justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight mt-8  md:text-left md:text-4xl lg:text-5xl lg:mt-0">
									<Wrench className="size-12 mb-4" />
									State-of-the-art fixes for the comments on your PRs.
								</h1>

								<div className="mt-4 max-w-lg space-y-4 text-base text-muted-foreground md:text-left sm:mt-6">
									<p>
										Roo Code{"'"}s PR Fixer applies high-quality changes to your PRs, right from
										GitHub. Invoke via a PR comment and it will read the entire comment history to
										understand context, agreements, and tradeoffs — then implement the right fix.
									</p>
									<p>
										As always, you bring the model key; we orchestrate smart, efficient workflows.
									</p>
								</div>

								{/* Cross-agent link */}
								<div className="mt-6 flex flex-col md:flex-row md:items-center gap-2">
									Works great with
									<Link
										href="/reviewer"
										className="flex p-4 items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-600 backdrop-blur-sm transition-colors hover:bg-blue-500/20 dark:text-blue-400"
										aria-label="Works great with PR Reviewer">
										<GitPullRequest className="size-4 mr-2" />
										PR Reviewer Agent
										<ArrowRight className="ml-2 h-4 w-4" />
									</Link>
								</div>
							</div>

							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0 md:items-center">
								<Button
									size="lg"
									className="w-full sm:w-auto backdrop-blur-sm border hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300"
									asChild>
									<a
										href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_PRO}
										target="_blank"
										rel="noopener noreferrer"
										onClick={trackGoogleAdsConversion}
										className="flex w-full items-center justify-center">
										Start 14-day Free Trial
										<ArrowRight className="ml-2" />
									</a>
								</Button>
								<span className="text-sm text-center md:text-left text-muted-foreground md:ml-2">
									(cancel anytime)
								</span>
							</div>
						</div>

						<div className="flex items-center justify-end mx-auto h-full mt-8 lg:mt-0">
							<div className="md:w-[670px] md:h-[600px] relative overflow-clip">
								<div className="block">
									<Image
										src={hero}
										alt="Example of a PR Fixer applying changes from review comments"
										className="max-w-full h-auto"
										width={800}
										height={711}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* How It Works Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 md:mb-24 max-w-5xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">How It Works</h2>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-3 lg:gap-8">
							{workflowSteps.map((step, index) => {
								const Icon = step.icon
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300 hover:shadow-lg">
										<Icon className="size-6 text-foreground/80" />
										<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">
											{step.title}
										</h3>
										<div className="leading-relaxed font-light text-muted-foreground">
											{step.description}
										</div>
									</li>
								)
							})}
						</ul>
					</div>
				</div>
			</section>

			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 md:mb-24 max-w-5xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
								Why Roo Code{"'"}s PR Fixer is different
							</h2>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
							{howItWorks.map((feature, index) => {
								const Icon = feature.icon
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300">
										<Icon className="size-6 text-foreground/80" />
										<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">
											{feature.title}
										</h3>
										<div className="leading-relaxed font-light text-muted-foreground space-y-2">
											{feature.description}
										</div>
									</li>
								)
							})}
						</ul>
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="py-20">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-purple-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-gradient-to-br dark:from-gray-800 dark:via-gray-900 dark:to-black sm:p-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
							Ship fixes, not follow-ups.
						</h2>
						<p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
							Let Roo Code{"'"}s PR Fixer turn your review feedback into clean, ready-to-merge commits.
						</p>
						<div className="flex flex-col justify-center space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
							<Button
								size="lg"
								className="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_PRO}
									target="_blank"
									rel="noopener noreferrer"
									onClick={trackGoogleAdsConversion}
									className="flex items-center justify-center">
									Start 14-day Free Trial
									<ArrowRight className="ml-2 h-4 w-4" />
								</a>
							</Button>
						</div>
					</div>
				</div>
			</section>
		</>
	)
}
