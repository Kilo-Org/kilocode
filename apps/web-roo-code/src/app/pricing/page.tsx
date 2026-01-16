import { Users, ArrowRight, LucideIcon, Check, SquareTerminal, CornerRightDown, Cloud } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui"
import { AnimatedBackground } from "@/components/homepage"
import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"
import { EXTERNAL_LINKS } from "@/lib/constants"

const TITLE = "Roo Code Pricing"
const DESCRIPTION =
	"Simple, transparent pricing for all Roo Code products. The VS Code extension is free forever. Choose the cloud plan that fits your needs."
const OG_DESCRIPTION = ""
const PATH = "/pricing"

const PRICE_CREDITS = 5

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
		"pricing",
		"plans",
		"subscription",
		"cloud pricing",
		"AI development pricing",
		"team pricing",
		"enterprise pricing",
	],
}

interface PricingTier {
	name: string
	icon: LucideIcon
	price: string
	priceSuffix: string
	period?: string
	creditPrice?: string
	trial?: string
	description: string
	featuresIntro?: string
	features: string[]
	cta: {
		text: string
		href?: string
	}
	learnMoreLink?: string
}

const pricingTiers: PricingTier[] = [
	{
		name: "VS Code Extension",
		icon: SquareTerminal,
		price: "Free",
		priceSuffix: "inference",
		description: "The best local coding agent",
		features: ["Unlimited local use", "Bring your own model", "Powerful, extensible modes", "Community support"],
		cta: {
			text: "Install Now",
			href: EXTERNAL_LINKS.MARKETPLACE,
		},
	},
	{
		name: "Cloud Free",
		icon: Cloud,
		price: "$0",
		period: "/mo",
		priceSuffix: "credits",
		creditPrice: `$${PRICE_CREDITS}`,
		description: "For AI-forward engineers",
		featuresIntro: "Go beyond the extension with",
		features: [
			"Access to Cloud Agents: fully autonomous development you can call from Slack, Github and the web",
			"Access to the Roo Code Cloud Provider",
			"Follow your tasks from anywhere",
			"Share tasks with friends and co-workers",
			"Token usage analytics",
			"Professional support",
		],
		cta: {
			text: "Sign up",
			href: EXTERNAL_LINKS.CLOUD_APP_SIGNUP,
		},
	},
	{
		name: "Cloud Team",
		icon: Users,
		price: "$99",
		priceSuffix: "credits",
		period: "/mo",
		creditPrice: `$${PRICE_CREDITS}`,
		trial: "Free for 14 days, then",
		description: "For AI-forward teams",
		featuresIntro: "Everything in Free +",
		features: ["Unlimited users (no per-seat cost)", "Shared configuration & policies", "Centralized billing"],
		cta: {
			text: "Sign up",
			href: EXTERNAL_LINKS.CLOUD_APP_SIGNUP + "?redirect_url=/billing",
		},
		learnMoreLink: "/cloud/team",
	},
]

export default function PricingPage() {
	return (
		<>
			<AnimatedBackground />

			{/* Hero Section */}
			<section className="relative overflow-hidden pt-12 pb-10">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center">
						<h1 className="text-5xl font-bold tracking-tight">Roo Code Pricing</h1>
						<p className="mt-4 text-lg text-muted-foreground">
							For all of our products: the Roo Code VS Code Extension, Roo Code Cloud and the Roo Code
							Cloud inference Provider.
						</p>
					</div>
				</div>
			</section>

			{/* Pricing Tiers */}
			<section className="">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3 md:px-4">
						{pricingTiers.map((tier) => {
							const Icon = tier.icon
							return (
								<div
									key={tier.name}
									className="relative group p-6 flex flex-col justify-start bg-background rounded-2xl outline outline-2 outline-border/50 hover:outline-8 transition-all shadow-xl hover:shadow-2xl hover:outline-6">
									<div className="mb-6">
										<div className="flex items-center justify-between">
											<h3 className="text-2xl font-bold tracking-tight">{tier.name}</h3>
										</div>
										<p className="text-sm font-medium">{tier.description}</p>
									</div>
									<div className="absolute -right-2 -top-4 rounded-full bg-card shadow-md p-4 outline outline-2 outline-border/50 group-hover:scale-105 group-hover:outline-8 transition-all">
										<Icon className="size-6" strokeWidth={1.5} />
									</div>

									<div className="grow mb-8 md:h-[214px]">
										<p className="text-sm text-muted-foreground font-light mb-2">
											{tier.featuresIntro}&nbsp;
										</p>
										<ul className="space-y-3 my-0">
											{tier.features.map((feature) => (
												<li key={feature} className="flex items-start gap-2">
													<Check className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
													<span className="text-sm">{feature}</span>
												</li>
											))}
										</ul>
										{tier.learnMoreLink && (
											<div className="mt-2">
												<Link
													href={tier.learnMoreLink}
													className="text-sm text-violet-600 dark:text-violet-400 hover:underline">
													Learn more →
												</Link>
											</div>
										)}
									</div>

									<p className="text-base font-light">{tier.trial}</p>

									<p className="text-xl mb-1 tracking-tight font-light">
										<strong className="font-bold">{tier.price}</strong>
										{tier.period} + {tier.priceSuffix}
										<CornerRightDown className="inline size-4 ml-1 relative top-0.5" />
									</p>

									<p className="text-sm text-muted-foreground mb-5">
										{tier.creditPrice && (
											<>
												Cloud Agents: {tier.creditPrice}/hour in credits
												<br />
											</>
										)}
										Inference:{" "}
										<Link href="/provider" className="underline hover:no-underline">
											Roo Provider pricing
										</Link>{" "}
										credits or{" "}
										<abbr title="Bring Your Own Model" className="cursor-help">
											BYOM
										</abbr>
									</p>

									<Button size="lg" className="w-full transition-all duration-300" asChild>
										<Link href={tier.cta.href!} className="flex items-center justify-center">
											{tier.cta.text}
											<ArrowRight />
										</Link>
									</Button>

									{/* <div className="bg-foreground/20 h-8 absolute -bottom-8 left-1/2 w-[1px]" /> */}
									<div className="h-[28px] absolute bottom-[-31px] left-1/2 w-[4px] transition-colors bg-gradient-to-b from-transparent to-violet-700/20 group-hover:from-violet-500/50 group-hover:to-violet-500/20" />
								</div>
							)
						})}
					</div>

					<div className="max-w-6xl mx-auto mt-8 p-7 flex flex-col md:flex-row gap-8 md:gap-4 bg-violet-200/20 outline-violet-700/20 outline outline-1 rounded-2xl transition-all shadow-none">
						<div className="md:border-r md:pr-4">
							<h3 className="text-lg font-medium mb-1">Roo Code Provider</h3>
							<div className="text-sm text-muted-foreground">
								<p className="">
									On any plan, you can use your own LLM provider API key or use the built-in Roo Code
									Cloud provider – curated models to work with Roo with no markup, including the
									latest Gemini, GPT and Claude. Paid with credits.
									<Link href="/provider" className="underline hover:no-underline ml-1">
										See per model pricing.
									</Link>
								</p>
							</div>
						</div>
						<div className="">
							<h3 className="text-lg font-medium mb-1">Credits</h3>
							<p className="text-sm text-muted-foreground">
								Credits are pre-paid, in dollars, and are deducted with usage for inference and Cloud
								Agent runs. You&apos;re always in control of your spend, no surprises.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* Additional Information */}
			<section className="bg-background py-16 my-16 border-t border-b relative z-50">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl text-center">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently Asked Questions</h2>
					</div>
					<div className="mx-auto mt-12 grid max-w-5xl gap-8 md:grid-cols-2">
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">Wait, is Roo Code free or not?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes! The Roo Code VS Code extension is open source and free forever. The extension acts
								as a powerful AI coding assistant right in your editor. These are the prices for Roo
								Code Cloud.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">Is there a free trial?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, all paid plans come with a 14-day free trial to try out functionality.
							</p>
							<p className="mt-2 text-sm text-muted-foreground">
								To use Cloud Agents, you can buy credits.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">How do credits work?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Roo Code Cloud credits can be used in two ways:
							</p>
							<ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
								<li>To pay for Cloud Agents running time (${PRICE_CREDITS}/hour)</li>
								<li>
									To pay for AI model inference costs (
									<a
										href="https://app.roocode.com/provider/pricing"
										target="_blank"
										rel="noopener noreferrer"
										className="underline">
										varies by model
									</a>
									)
								</li>
							</ul>
							<p className="mt-2 text-sm text-muted-foreground">
								To cover our infrastructure costs, we charge ${PRICE_CREDITS}/hour while the agent is
								running (independent of inference costs).
							</p>
							<p className="mt-2 text-sm text-muted-foreground">
								There are no markups, no tiers, no dumbing-down of models to increase our profit.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">Do I need a credit card for the free trial?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, but you won&apos;t be charged until your trial ends, except for credit purchases.
							</p>
							<p className="mt-2 text-sm text-muted-foreground">You can cancel anytime with one click.</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">What payment methods do you accept?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								We accept all major credit cards, debit cards, and can arrange invoice billing for
								Enterprise customers.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<h3 className="font-semibold">Can I cancel or change plans?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, you can upgrade, downgrade or cancel your plan at any time. Changes will be
								reflected in your next billing cycle.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6 md:col-span-2">
							<h3 className="font-semibold">
								What if I have enterprise-level needs like SAML/SCIM, large-scale deployments, specific
								integrations and custom terms?
							</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								We have an Enterprise plan which can be a fit. Please{" "}
								<Link href="/enterprise#contact" className="underline hover:no-underline">
									reach out to our sales team
								</Link>{" "}
								to discuss it.
							</p>
						</div>
					</div>

					<div className="mt-12 text-center">
						<p className="text-muted-foreground">
							Still have questions?{" "}
							<a
								href={EXTERNAL_LINKS.DISCORD}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
								Join our Discord
							</a>{" "}
							or{" "}
							<Link
								href="/enterprise#contact"
								className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
								contact our sales team
							</Link>
						</p>
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section className="py-20">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-purple-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-gradient-to-br dark:from-gray-800 dark:via-gray-900 dark:to-black sm:p-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Try Roo Code Cloud now</h2>
						<p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">Code from anywhere.</p>
						<div className="flex flex-col justify-center space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
							<Button
								size="lg"
								className="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									Create a free Cloud account
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
