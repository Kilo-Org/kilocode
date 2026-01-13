"use client"

import {
	ArrowRight,
	GitPullRequest,
	Wrench,
	Key,
	MessageSquareCode,
	Blocks,
	ListChecks,
	BookMarked,
	History,
	LucideIcon,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui"
import { AnimatedBackground, UseExamplesSection } from "@/components/homepage"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { type AgentPageContent, type IconName } from "./agent-page-content"

/**
 * Maps icon names to actual Lucide icon components
 */
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

/**
 * Converts an icon name string to a Lucide icon component
 */
function getIcon(iconName?: IconName): LucideIcon | undefined {
	return iconName ? iconMap[iconName] : undefined
}

export function AgentLandingContent({ content }: { content: AgentPageContent }) {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex min-h-screen md:min-h-[calc(70vh-theme(spacing.12))] items-center overflow-hidden py-12 md:py-0">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-8 md:gap-12 lg:gap-20 lg:grid-cols-2">
						<div className="flex flex-col justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight md:text-left md:text-4xl lg:text-5xl">
									{content.hero.icon &&
										(() => {
											const Icon = getIcon(content.hero.icon)
											return Icon ? <Icon className="size-12 mb-4" /> : null
										})()}
									{content.hero.heading}
								</h1>

								<div className="mt-4 max-w-full lg:max-w-lg space-y-4 text-base text-muted-foreground md:text-left sm:mt-6">
									{content.hero.paragraphs.map((paragraph, index) => (
										<p key={index}>{paragraph}</p>
									))}
								</div>

								{/* Cross-agent link */}
								<div className="mt-6 flex flex-col md:flex-row md:items-center gap-2">
									{content.hero.crossAgentLink.text}
									{content.hero.crossAgentLink.links.map((link, index) => {
										const Icon = getIcon(link.icon)
										return (
											<Link
												key={index}
												href={link.href}
												className="flex p-4 items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-600 backdrop-blur-sm transition-colors hover:bg-blue-500/20 dark:text-blue-400"
												aria-label={`Works great with ${link.text}`}>
												{Icon && <Icon className="size-4 mr-2" />}
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
										href={`${EXTERNAL_LINKS.CLOUD_APP_SIGNUP_PRO}${content.hero.cta.tracking}`}
										target="_blank"
										rel="noopener noreferrer"
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
							<div className="flex items-center justify-center lg:justify-end mx-auto h-full w-full">
								<div className="relative w-full max-w-full overflow-hidden rounded-lg">
									<Image
										src={content.hero.image.url}
										alt={content.hero.image.alt || "Hero image"}
										className="w-full h-auto"
										width={content.hero.image.width}
										height={content.hero.image.height}
										priority
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			</section>

			{/* How It Works Section */}
			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
					<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 dark:bg-violet-700/20 blur-[140px]" />
				</div>
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
								const Icon = getIcon(step.icon)
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
				<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
					<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 dark:bg-blue-700/20 blur-[140px]" />
				</div>
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
								const Icon = getIcon(feature.icon)
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300">
										{Icon && <Icon className="size-6 text-foreground/80" />}
										<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">
											{feature.title}
										</h3>
										<div className="leading-relaxed font-light text-muted-foreground space-y-2">
											{feature.description && <p>{feature.description}</p>}
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

			<UseExamplesSection agentTitle={true} />

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
									href={`${EXTERNAL_LINKS.CLOUD_APP_SIGNUP_PRO}${content.hero.cta.tracking}`}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									{content.hero.cta.buttonText}
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
