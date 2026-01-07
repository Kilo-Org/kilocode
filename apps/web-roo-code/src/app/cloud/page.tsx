import {
	ArrowRight,
	Bot,
	Brain,
	ChartLine,
	Github,
	History,
	LucideIcon,
	Pencil,
	Router,
	Share2,
	Slack,
	Users,
	Users2,
} from "lucide-react"
import type { Metadata } from "next"
// import Image from "next/image"

import { Button } from "@/components/ui"
import { AnimatedBackground, UseExamplesSection } from "@/components/homepage"
import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"
import { EXTERNAL_LINKS } from "@/lib/constants"
// Workaround for next/image choking on these for some reason
// import screenshotDark from "/public/heroes/cloud-screen.png"

const TITLE = "Roo Code Cloud"
const DESCRIPTION =
	"Your AI Software Engineering Team in the Cloud. Delegate tasks to autonomous agents, review PRs, and collaborate with your team."
const OG_DESCRIPTION = "Your AI Team in the Cloud"
const PATH = "/cloud"

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
	keywords: [...SEO.keywords, "cloud", "subscription", "cloud agents", "AI cloud development", "autonomous agents"],
}

const howItWorks = [
	{
		title: "1. Connect your GitHub account",
		description:
			"Pick which repos the agents can work with in their isolated containers and choose what model you want to power each of them. You're in control.",
		icon: Github,
	},
	{
		title: "2. Set up your agent team",
		description:
			"Choose the roles you want filled, like Explainer, Planner, Coder, PR Reviewer and PR Fixer. They know how to act in each situation and stay on-task with no deviations.",
		icon: Users2,
	},
	{
		title: "3. Start giving them tasks",
		description:
			"Describe what you want them to do from the web UI, get the Reviewer automatically reviewing PRs, get the Coder building features from Slack threads and much more. They're now part of your team.",
		icon: Pencil,
	},
]

interface Feature {
	icon: LucideIcon
	title: string
	description: string
}

const features: Feature[] = [
	{
		icon: Bot,
		title: "Autonomous Cloud Agents",
		description:
			"Delegate work to specialized agents like the Planner, Coder, Explainer, Reviewer, and Fixer that run 24/7.",
	},
	{
		icon: Brain,
		title: "Model Agnostic",
		description:
			"Bring your own keys or use the Roo Code Cloud Provider with access to all top models with no markup.",
	},
	{
		icon: Github,
		title: "GitHub PR Reviews",
		description:
			"Agents can automatically review Pull Requests, provide feedback, and even push fixes directly to your repository.",
	},
	{
		icon: Slack,
		title: "Slack Integration",
		description: "Start tasks, get updates, and collaborate with agents directly from your team's Slack channels.",
	},
	{
		icon: Router,
		title: "Roomote Control",
		description:
			"Connect to your local VS Code instance and control the extension remotely from the browser or Slack.",
	},
	{
		icon: Users,
		title: "Team Collaboration",
		description:
			"Manage your team and their access to tasks and resources, with centralized billing and configuration.",
	},
	{
		icon: ChartLine,
		title: "Usage Analytics",
		description: "Detailed token analytics to help you optimize your costs and usage across your team.",
	},
	{
		icon: History,
		title: "Task History",
		description: "Access from anywhere all of your tasks, from the cloud and the extension",
	},
	{
		icon: Share2,
		title: "Task Sharing",
		description: "Share tasks with friends and co-workers and let them follow your work in real-time.",
	},
]

export default function CloudPage() {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex pt-32 pb-20 items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex flex-col items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center max-w-4xl mx-auto mb-12">
						<h1 className="text-4xl font-bold tracking-tight mb-6 md:text-5xl lg:text-6xl">
							Your AI Team <span className="text-violet-500">in the Cloud</span>
						</h1>
						<p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
							Create your agent team in the Cloud, give them access to GitHub, and start delegating tasks
							from Web and Slack.
						</p>
						<div className="flex flex-col sm:flex-row gap-4 justify-center">
							<Button
								size="xl"
								className="bg-violet-600 hover:bg-violet-700 text-white transition-all duration-300 shadow-lg hover:shadow-violet-500/25"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									Try Cloud for Free
									<ArrowRight className="ml-2 size-5" />
								</a>
							</Button>
							<Button variant="outline" size="xl" className="backdrop-blur-sm" asChild>
								<a href="/pricing" className="flex items-center justify-center">
									View Pricing
								</a>
							</Button>
						</div>
					</div>

					{/* Screenshot */}
					<div className="relative mx-auto mt-4 md:max-w-[1000px]"></div>
				</div>
			</section>

			{/* How It Works Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 dark:bg-blue-700/20 blur-[140px]" />
					</div>

					<div className="mx-auto mb-12 md:mb-24 max-w-5xl text-center">
						<div>
							<h2 className="text-3xl font-bold tracking-tight sm:text-5xl mb-4">How it works</h2>
							<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
								It only takes 2 minutes to expand your team by 10x.
							</p>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-3 lg:gap-8">
							{howItWorks.map((step, index) => {
								const Icon = step.icon
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300 hover:shadow-lg">
										{Icon && <Icon className="size-6 text-foreground/80" />}
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

			{/* Use Cases Section */}
			<UseExamplesSection />

			{/* Features Grid */}
			<section className="py-24 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8 relative">
					<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
						<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 dark:bg-violet-700/20 blur-[140px]" />
					</div>
					<div className="text-center mb-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
							Powering the next generation of software development
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
							Everything you need to scale your development capacity with AI.
						</p>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto relative">
						{features.map((feature, index) => {
							const Icon = feature.icon
							return (
								<div
									key={index}
									className="bg-background p-8 rounded-2xl border border-border hover:shadow-lg transition-all duration-300">
									<div className="bg-violet-100 dark:bg-violet-900/20 w-12 h-12 rounded-lg flex items-center justify-center mb-6">
										<Icon className="size-6 text-violet-600 dark:text-violet-400" />
									</div>
									<h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
									<p className="text-muted-foreground leading-relaxed">{feature.description}</p>
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
							Try a completely new way of working.
						</h2>
						<p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">Start for free today.</p>
						<div className="flex flex-col justify-center space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
							<Button
								size="lg"
								className="bg-foreground text-background hover:bg-foreground/90 transition-all duration-300"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									Sign up now
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
