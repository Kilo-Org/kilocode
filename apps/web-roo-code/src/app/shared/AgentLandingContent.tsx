"use client"

import {
	ArrowRight,
	Blocks,
	BookMarked,
	ListChecks,
	LucideIcon,
	GitPullRequest,
	Key,
	MessageSquareCode,
	Wrench,
	History,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui"
import { AnimatedBackground } from "@/components/homepage"
import { AgentCarousel } from "@/components/reviewer/agent-carousel"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { trackGoogleAdsConversion } from "@/lib/analytics/google-ads"
import type { AgentPageContent, IconName } from "./agent-page-content"

// Map icon names to Lucide components
const iconMap: Record<IconName, LucideIcon> = {
	GitPullRequest,
	Wrench,
	Key,
	MessageSquareCode,
	Blocks,
	ListChecks,
	BookMarked,
	History,
}

interface AgentLandingContentProps {
	content: AgentPageContent
}

export function AgentLandingContent({ content }: AgentLandingContentProps) {
	const HeroIcon = content.hero.icon ? iconMap[content.hero.icon] : null

	return (
		<>
			{/* Hero Section */}
			<section className="relative flex md:h-[calc(70vh-theme(spacing.12))] items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-4 md:gap-20 lg:grid-cols-2">
						<div className="flex flex-col px-4 justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight mt-8  md:text-left md:text-4xl lg:text-5xl lg:mt-0">
									{HeroIcon && <HeroIcon className="size-12 mb-4" />}
									{content.hero.heading}
								</h1>

								<div className="mt-4 max-w-lg space-y-4 text-base text-muted-foreground md:text-left sm:mt-6">
									{content.hero.paragraphs.map((paragraph, index) => (
										<p key={index}>{paragraph}</p>
									))}
								</div>

								{/* Cross-agent link */}
								<div className="mt-6 flex flex-col md:flex-row md:items-center gap-2">
									{content.hero.crossAgentLink.text}
									{content.hero.crossAgentLink.links.map((link, index) => {
										const LinkIcon = link.icon ? iconMap[link.icon] : null
										return (
											<Link
												key={index}
												href={link.href}
												className="flex p-4 items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-600 backdrop-blur-sm transition-colors hover:bg-blue-500/20 dark:text-blue-400"
												aria-label={link.text}>
												{LinkIcon && <LinkIcon className="size-4 mr-2" />}
												{link.text}
												<ArrowRight className="ml-2 h-4 w-4" />
											</Link>
										)
									})}
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
										{content.hero.cta.buttonText}
										<ArrowRight className="ml-2" />
									</a>
								</Button>
								<span className="text-sm text-center md:text-left text-muted-foreground md:ml-2">
									{content.hero.cta.disclaimer}
								</span>
							</div>
						</div>
						{content.hero.image && (
							<div className="flex items-center justify-end mx-auto h-full mt-8 lg:mt-0">
								<div className="md:w-[800px] md:h-[474px] relative overflow-clip">
									<div className="block">
										<Image
											src={content.hero.image.url}
											alt={content.hero.image.alt || "Hero image"}
											className="max-w-full h-auto"
											width={content.hero.image.width}
											height={content.hero.image.height}
										/>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			</section>

			{/* How It Works Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 md:mb-24 max-w-5xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
								{content.howItWorks.heading}
							</h2>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-3 lg:gap-8">
							{content.howItWorks.steps.map((step, index) => {
								const Icon = step.icon ? iconMap[step.icon] : null
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

			{/* Why Better Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 md:mb-24 max-w-5xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
								{content.whyBetter.heading}
							</h2>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
							{content.whyBetter.features.map((feature, index) => {
								const Icon = feature.icon ? iconMap[feature.icon] : null
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300">
										{Icon && <Icon className="size-6 text-foreground/80" />}
										<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">
											{feature.title}
										</h3>
										<div className="leading-relaxed font-light text-muted-foreground space-y-2">
											{feature.description && <div>{feature.description}</div>}
											{feature.paragraphs &&
												feature.paragraphs.map((paragraph, pIndex) => (
													<p key={pIndex}>{paragraph}</p>
												))}
										</div>
									</li>
								)
							})}
						</ul>
					</div>
				</div>
			</section>

			{/* Agent Carousel Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 max-w-4xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
								The first member of a whole new team
							</h2>

							<p className="mt-6 text-lg text-muted-foreground">
								Architecture, coding, reviewing, testing, debugging, documenting, designing –{" "}
								<em>almost everything</em> we do today is mostly through our agents. Now we&apos;re
								bringing them to you.
							</p>
							<p className="mt-2 text-lg text-muted-foreground">
								Roo&apos;s {content.agentName} isn&apos;t yet another single-purpose tool to add to your
								already complicated stack.
								<br />
								It&apos;s the first member of your AI-powered development team. More agents are shipping
								soon.
							</p>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<AgentCarousel />
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="py-20">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-purple-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-gradient-to-br dark:from-gray-800 dark:via-gray-900 dark:to-black sm:p-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">{content.cta.heading}</h2>
						<p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
							{content.cta.description}
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
									{content.cta.buttonText}
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
