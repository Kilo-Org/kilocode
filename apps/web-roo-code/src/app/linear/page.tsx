import {
	ArrowRight,
	CheckCircle,
	CreditCard,
	Eye,
	GitBranch,
	GitPullRequest,
	Link2,
	MessageSquare,
	Settings,
	Shield,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Metadata } from "next"

import { AnimatedBackground } from "@/components/homepage"
import { LinearIssueDemo } from "@/components/linear/linear-issue-demo"
import { Button } from "@/components/ui"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"

const TITLE = "Roo Code for Linear"
const DESCRIPTION = "Assign development work to @Roo Code directly from Linear. Get PRs back without switching tools."
const OG_DESCRIPTION = "Turn Linear Issues into Pull Requests"
const PATH = "/linear"

// Featured Workflow section is temporarily commented out until video is ready
// const LINEAR_DEMO_YOUTUBE_ID = ""

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
		"linear integration",
		"issue to PR",
		"AI in Linear",
		"engineering workflow automation",
		"Roo Code Cloud",
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
		title: "Work where you already work.",
		description:
			"Assign development work to @Roo Code directly from Linear. No new tools to learn, no context switching required.",
	},
	{
		icon: Eye,
		title: "Progress is visible.",
		description:
			"Watch progress unfold in real-time. Roo Code posts updates as comments, so your whole team stays in the loop.",
	},
	{
		icon: MessageSquare,
		title: "Mention for refinement.",
		description:
			'Need changes? Just comment "@Roo Code also add dark mode support" and the agent picks up where it left off.',
	},
	{
		icon: Link2,
		title: "Full traceability.",
		description:
			"Every PR links back to the originating issue. Every issue shows its linked PR. Your audit trail stays clean.",
	},
	{
		icon: Settings,
		title: "Organization-level setup.",
		description:
			"Connect once, use everywhere. Your team members can assign issues to @Roo Code without individual configuration.",
	},
	{
		icon: Shield,
		title: "Safe by design.",
		description:
			"Agents never touch main/master directly. They produce branches and PRs. You review and approve before merge.",
	},
]

// type WorkflowStep = {
// 	step: number
// 	title: string
// 	description: string
// }

// const WORKFLOW_STEPS: WorkflowStep[] = [
// 	{
// 		step: 1,
// 		title: "Create an issue",
// 		description: "Write your issue with acceptance criteria. Be as detailed as you like.",
// 	},
// 	{
// 		step: 2,
// 		title: "Call @Roo Code",
// 		description: "Mention @Roo Code in a comment to start. The agent begins working immediately.",
// 	},
// 	{
// 		step: 3,
// 		title: "Watch progress",
// 		description: "Roo Code posts status updates as comments. Refine with @-mentions if needed.",
// 	},
// 	{
// 		step: 4,
// 		title: "Review the PR",
// 		description: "When ready, the PR link appears in the issue. Review, iterate, and ship.",
// 	},
// ]

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
		description: "Linear integration requires a Team plan.",
		link: {
			href: EXTERNAL_LINKS.CLOUD_APP_TEAM_TRIAL,
			text: "Start a free trial",
		},
	},
	{
		icon: GitPullRequest,
		title: "2. Connect GitHub",
		description: "Link your repositories so Roo Code can open PRs on your behalf.",
	},
	{
		icon: Settings,
		title: "3. Connect Linear",
		description: "Authorize via OAuth. No API keys to manage or rotate.",
	},
	{
		icon: CheckCircle,
		title: "4. Link & Start",
		description: "Map your Linear project to a repo, then assign or mention @Roo Code.",
	},
]

function LinearIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
		</svg>
	)
}

export default function LinearPage(): JSX.Element {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex pt-32 pb-20 items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex flex-col items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid w-full max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-12">
						<div className="text-center lg:text-left">
							<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium mb-6">
								<LinearIcon className="size-4" />
								Powered by Roo Code Cloud
							</div>
							<h1 className="text-4xl font-bold tracking-tight mb-6 md:text-5xl lg:text-6xl">
								Turn Linear Issues into <span className="text-indigo-500">Pull&nbsp;Requests</span>
							</h1>
							<p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto lg:mx-0">
								Assign development work to @Roo Code directly from Linear. Get PRs back without
								switching tools.
							</p>
							<div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
								<Button
									size="xl"
									className="bg-indigo-600 hover:bg-indigo-700 text-white transition-all duration-300 shadow-lg hover:shadow-indigo-500/25"
									asChild>
									<a
										href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_HOME}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center justify-center">
										Get Started
										<ArrowRight className="ml-2 size-5" />
									</a>
								</Button>
							</div>
						</div>

						<div className="flex justify-center lg:justify-end">
							<LinearIssueDemo />
						</div>
					</div>
				</div>
			</section>

			{/* Value Props Section */}
			<section className="py-24 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/10 dark:bg-indigo-700/20 blur-[140px]" />
					</div>
					<div className="text-center mb-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
							Why your team will love using Roo Code in&nbsp;Linear
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							AI agents that understand context, keep your team in the loop, and deliver PRs you can
							review.
						</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto relative">
						{VALUE_PROPS.map((prop, index) => {
							const Icon = prop.icon
							return (
								<div
									key={index}
									className="bg-background p-8 rounded-2xl border border-border hover:shadow-lg transition-all duration-300">
									<div className="bg-indigo-100 dark:bg-indigo-900/20 w-12 h-12 rounded-lg flex items-center justify-center mb-6">
										<Icon className="size-6 text-indigo-600 dark:text-indigo-400" />
									</div>
									<h3 className="text-xl font-semibold mb-3">{prop.title}</h3>
									<p className="text-muted-foreground leading-relaxed">{prop.description}</p>
								</div>
							)
						})}
					</div>
				</div>
			</section>

			{/* Featured Workflow Section - temporarily commented out until video is ready
			<section id="demo" className="relative overflow-hidden border-t border-border py-24 lg:py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 dark:bg-blue-700/20 blur-[140px]" />
					</div>

					<div className="mx-auto mb-12 max-w-5xl text-center">
						<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium mb-6">
							<Zap className="size-4" />
							Featured Workflow
						</div>
						<h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-4">Issue to Shipped Feature</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							Stay in Linear from assignment to review. Roo Code keeps the issue updated and links the PR
							when it&apos;s ready.
						</p>
					</div>

					<div className="relative mx-auto max-w-6xl">
						<div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-center">
							{/* YouTube Video Embed or Placeholder */}
			{/*<div className="lg:col-span-3 overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
								{LINEAR_DEMO_YOUTUBE_ID ? (
									<iframe
										className="aspect-video w-full"
										src={`https://www.youtube-nocookie.com/embed/${LINEAR_DEMO_YOUTUBE_ID}?rel=0`}
										title="Roo Code Linear Integration Demo"
										allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
										referrerPolicy="strict-origin-when-cross-origin"
										allowFullScreen
									/>
								) : (
									<div className="aspect-video w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-500/10 via-blue-500/5 to-purple-500/10 text-center p-8">
										<LinearIcon className="size-16 text-indigo-500/50 mb-4" />
										<p className="text-lg font-semibold text-foreground mb-2">
											Demo Video Coming Soon
										</p>
										<p className="text-sm text-muted-foreground max-w-md">
											See the workflow in action: assign an issue to @Roo Code and watch as it
											analyzes requirements, writes code, and opens a PR.
										</p>
									</div>
								)}
							</div>

							{/* Workflow Steps */}
			{/*<div className="lg:col-span-2 space-y-3">
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
			*/}

			{/* Onboarding Section */}
			<section className="py-24 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Get started in minutes</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							Connect Linear and start assigning issues to AI.
						</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-5xl mx-auto">
						{ONBOARDING_STEPS.map((step, index) => {
							const Icon = step.icon
							return (
								<div key={index} className="text-center">
									<div className="bg-indigo-100 dark:bg-indigo-900/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
										<Icon className="size-8 text-indigo-600 dark:text-indigo-400" />
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
													className="text-indigo-600 dark:text-indigo-400 hover:underline">
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
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-blue-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/10 sm:p-16">
						<h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
							Start using Roo Code in Linear
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
