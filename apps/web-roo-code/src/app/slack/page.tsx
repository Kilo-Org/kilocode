import {
	ArrowRight,
	Brain,
	CreditCard,
	GitBranch,
	GraduationCap,
	Link2,
	MessageSquare,
	Settings,
	Shield,
	Slack,
	Users,
	Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Metadata } from "next"

import { AnimatedBackground } from "@/components/homepage"
import { SlackThreadDemo } from "@/components/slack/slack-thread-demo"
import { Button } from "@/components/ui"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"

const TITLE = "Roo Code for Slack"
const DESCRIPTION =
	"Mention @Roomote in any channel to explain code, plan features, or ship a PR, all without leaving the conversation."
const OG_DESCRIPTION = "Your AI Team in Slack"
const PATH = "/slack"

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: {
		canonical: `${SEO.url}${PATH}`,
	},
	openGraph: {
		title: TITLE,
		description: DESCRIPTION,
		url: `${SEO.url}${PATH}`,
		siteName: SEO.name,
		images: [
			{
				url: ogImageUrl(TITLE, OG_DESCRIPTION),
				width: 1200,
				height: 630,
				alt: TITLE,
			},
		],
		locale: SEO.locale,
		type: "website",
	},
	twitter: {
		card: SEO.twitterCard,
		title: TITLE,
		description: DESCRIPTION,
		images: [ogImageUrl(TITLE, OG_DESCRIPTION)],
	},
	keywords: [
		...SEO.keywords,
		"slack integration",
		"slack bot",
		"AI in slack",
		"code assistant slack",
		"@Roomote",
		"team collaboration",
	],
}

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

type ValueProp = {
	icon: LucideIcon
	title: string
	description: string
}

const VALUE_PROPS: ValueProp[] = [
	{
		icon: GitBranch,
		title: "Discussion to PR.",
		description:
			"Your team discusses a feature in Slack. @Roomote turns the discussion into a plan. Then builds it. All without leaving the conversation.",
	},
	{
		icon: Brain,
		title: "Thread-aware.",
		description:
			'@Roomote reads the full thread before responding. Ask "Can we add caching here?" and it knows exactly what code you mean.',
	},
	{
		icon: Link2,
		title: "Chain agents.",
		description:
			"Start with a Planner to spec it out. Then call the Coder to build it. Multi-step workflows, one Slack thread.",
	},
	{
		icon: Users,
		title: "Open to all.",
		description:
			"Anyone on your team can ask @Roomote to fix bugs, build features, or investigate issues. Engineering gets looped in only when needed.",
	},
	{
		icon: GraduationCap,
		title: "Built-in learning.",
		description: "Public channel mentions show everyone how to leverage agents. Learn by watching.",
	},
	{
		icon: Shield,
		title: "Safe by design.",
		description: "Agents never touch main/master directly. They produce branches and PRs. You approve.",
	},
]

type WorkflowStep = {
	step: number
	title: string
	description: string
}

const WORKFLOW_STEPS: WorkflowStep[] = [
	{
		step: 1,
		title: "Turn the discussion into a plan",
		description: "Your team discusses a feature. When it gets complex, summon the Planner agent.",
	},
	{
		step: 2,
		title: "Refine the plan in the thread",
		description:
			"The team reviews the spec in the thread, suggests changes, asks questions. Mention @Roomote again to refine.",
	},
	{
		step: 3,
		title: "Build the plan",
		description: "Once the plan looks good, hand it off to the Coder agent to implement.",
	},
	{
		step: 4,
		title: "Review and ship",
		description: "The Coder creates a branch and opens a PR. The team reviews, and the feature ships.",
	},
]

type OnboardingStep = {
	icon: LucideIcon
	title: string
	description: string
	link?: {
		href: string
		text: string
	}
}

const ONBOARDING_STEPS: OnboardingStep[] = [
	{
		icon: CreditCard,
		title: "1. Team Plan",
		description: "Slack requires a Team plan.",
		link: {
			href: EXTERNAL_LINKS.CLOUD_APP_TEAM_TRIAL,
			text: "Start a free trial",
		},
	},
	{
		icon: Settings,
		title: "2. Connect",
		description: 'Sign in to Roo Code Cloud and go to Settings. Click "Connect" next to Slack.',
	},
	{
		icon: Slack,
		title: "3. Authorize",
		description: "Authorize the Roo Code app to access your Slack workspace.",
	},
	{
		icon: MessageSquare,
		title: "4. Add to channels",
		description: "Add @Roomote to the channels where you want it available.",
	},
]

export default function SlackPage(): JSX.Element {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex pt-32 pb-20 items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex flex-col items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid w-full max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-12">
						<div className="text-center lg:text-left">
							<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium mb-6">
								<Slack className="size-4" />
								Powered by Roo Code Cloud
							</div>
							<h1 className="text-4xl font-bold tracking-tight mb-6 md:text-5xl lg:text-6xl">
								<span className="text-violet-500">@Roomote:</span> Your AI Team in&nbsp;Slack
							</h1>
							<p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto lg:mx-0">
								Mention @Roomote in any channel to explain code, plan features, or ship a PR, all
								without leaving the conversation.
							</p>
							<div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
								<Button
									size="xl"
									className="bg-violet-600 hover:bg-violet-700 text-white transition-all duration-300 shadow-lg hover:shadow-violet-500/25"
									asChild>
									<a
										href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center justify-center">
										Get Started
										<ArrowRight className="ml-2 size-5" />
									</a>
								</Button>
								<Button variant="outline" size="xl" className="backdrop-blur-sm" asChild>
									<a
										href={EXTERNAL_LINKS.SLACK_DOCS}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center justify-center">
										Read the Docs
									</a>
								</Button>
							</div>
						</div>

						<div className="flex justify-center lg:justify-end">
							<SlackThreadDemo />
						</div>
					</div>
				</div>
			</section>

			{/* Value Props Section */}
			<section className="py-24 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 dark:bg-violet-700/20 blur-[140px]" />
					</div>
					<div className="text-center mb-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
							Why your team will love using Roo Code in&nbsp;Slack
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							AI agents that understand context, chain together for complex work, and keep your team in
							control.
						</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto relative">
						{VALUE_PROPS.map((prop, index) => {
							const Icon = prop.icon
							return (
								<div
									key={index}
									className="bg-background p-8 rounded-2xl border border-border hover:shadow-lg transition-all duration-300">
									<div className="bg-violet-100 dark:bg-violet-900/20 w-12 h-12 rounded-lg flex items-center justify-center mb-6">
										<Icon className="size-6 text-violet-600 dark:text-violet-400" />
									</div>
									<h3 className="text-xl font-semibold mb-3">{prop.title}</h3>
									<p className="text-muted-foreground leading-relaxed">{prop.description}</p>
								</div>
							)
						})}
					</div>
				</div>
			</section>

			{/* Featured Workflow Section */}
			<section className="relative overflow-hidden border-t border-border py-24 lg:py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 dark:bg-blue-700/20 blur-[140px]" />
					</div>

					<div className="mx-auto mb-12 max-w-5xl text-center">
						<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
							<Zap className="size-4" />
							Featured Workflow
						</div>
						<h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-4">
							Thread to Shipped Feature
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							Turn Slack discussions into working code. No context lost, no meetings needed.
						</p>
					</div>

					<div className="relative mx-auto max-w-6xl">
						<div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-center">
							{/* YouTube Video Embed */}
							<div className="lg:col-span-3 overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
								<iframe
									className="aspect-video w-full"
									src="https://www.youtube-nocookie.com/embed/dJM_8HHGe1E?rel=0"
									title="Roo Code Slack Integration Demo"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
									referrerPolicy="strict-origin-when-cross-origin"
									allowFullScreen
								/>
							</div>

							{/* Workflow Steps */}
							<div className="lg:col-span-2 space-y-3">
								{WORKFLOW_STEPS.map((step) => (
									<div
										key={step.step}
										className="relative border border-border rounded-xl bg-background p-4 transition-all duration-300 hover:shadow-md hover:border-blue-500/30">
										<div className="flex items-start gap-3">
											<div className="bg-blue-100 dark:bg-blue-900/30 w-7 h-7 rounded-full flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-xs shrink-0 mt-0.5">
												{step.step}
											</div>
											<div className="min-w-0">
												<h3 className="text-base font-semibold text-foreground mb-0.5">
													{step.title}
												</h3>
												<p className="text-sm leading-snug text-muted-foreground">
													{step.description}
												</p>
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Onboarding Section */}
			<section className="py-24 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Get started in minutes</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							Connect your Slack workspace and start working with AI agents.
						</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-5xl mx-auto">
						{ONBOARDING_STEPS.map((step, index) => {
							const Icon = step.icon
							return (
								<div key={index} className="text-center">
									<div className="bg-violet-100 dark:bg-violet-900/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
										<Icon className="size-8 text-violet-600 dark:text-violet-400" />
									</div>
									<h3 className="text-lg font-semibold mb-2">{step.title}</h3>
									<p className="text-muted-foreground">
										{step.description}
										{step.link && (
											<>
												{" "}
												<a
													href={step.link.href}
													target="_blank"
													rel="noopener noreferrer"
													className="text-violet-600 dark:text-violet-400 hover:underline">
													{step.link.text} →
												</a>
											</>
										)}
									</p>
								</div>
							)
						})}
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="py-24">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-blue-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/10 sm:p-16">
						<h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
							Start using Roo Code in Slack
						</h2>
						<p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
							Start a free 14 day Team trial.
						</p>
						<div className="flex flex-col justify-center space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
							<Button
								size="lg"
								className="bg-foreground text-background hover:bg-foreground/90 transition-all duration-300"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_TEAM_TRIAL}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									Start free trial
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
