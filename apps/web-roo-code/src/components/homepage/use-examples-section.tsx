"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
	LucideIcon,
	Pointer,
	Slack,
	Github,
	Code,
	GitPullRequest,
	Wrench,
	Map,
	MessageCircleQuestionMark,
	CornerDownRight,
	ChevronDown,
} from "lucide-react"
import Image from "next/image"
import { Button } from "../ui"

interface UseCase {
	role: string
	use: string
	agent: UseCaseAgent
	context: UseCaseSource
}

interface UseCaseSource {
	name: string
	icon: LucideIcon
}

interface UseCaseAgent {
	name: string
	icon: LucideIcon
}

interface PositionedUseCase extends UseCase {
	layer: 1 | 2 | 3 | 4
	position: { x: number; y: number }
	scale: number
	zIndex: number
	avatar: string
}

const SOURCES = {
	slack: {
		name: "Slack",
		icon: Slack,
	},
	web: {
		name: "Web",
		icon: Pointer,
	},
	github: {
		name: "Github",
		icon: Github,
	},
	extension: {
		name: "Extension",
		icon: Code,
	},
}

const AGENTS = {
	explainer: {
		name: "Explainer",
		icon: MessageCircleQuestionMark,
	},
	planner: {
		name: "Planner",
		icon: Map,
	},
	coder: {
		name: "Coder",
		icon: Code,
	},
	reviewer: {
		name: "Reviewer",
		icon: GitPullRequest,
	},
	fixer: {
		name: "Fixer",
		icon: Wrench,
	},
}

const USE_CASES: UseCase[] = [
	{
		role: "Frontend Developer",
		use: "Take Lisa's feedback above and incorporate it into the landing page.",
		agent: AGENTS.coder,
		context: SOURCES.slack,
	},
	{
		role: "Customer Success",
		use: "What could be causing this bug as described by the customer?",
		agent: AGENTS.explainer,
		context: SOURCES.web,
	},
	{
		role: "Backend Engineer",
		use: "Create a migration denormalizing total_cost calculation and backfill the remainder.",
		agent: AGENTS.coder,
		context: SOURCES.extension,
	},
	{
		role: "Security Engineer",
		use: "Do we use any of the libraries mentioned in the thread?",
		agent: AGENTS.explainer,
		context: SOURCES.slack,
	},
	{
		role: "Designer",
		use: "Refactor the button component to use CSS variables",
		agent: AGENTS.coder,
		context: SOURCES.slack,
	},
	{
		role: "Product Manager",
		use: "How big of a change would it be to turn this from a yes/no to have 4 options?",
		agent: AGENTS.coder,
		context: SOURCES.web,
	},
	{
		role: "QA Engineer",
		use: "Write a Playwright test for the login flow failure case, extract existing mocks into shared.",
		agent: AGENTS.coder,
		context: SOURCES.github,
	},
	{
		role: "DevOps Engineer",
		use: "Update the Dockerfile to use Node 20 Alpine.",
		agent: AGENTS.fixer,
		context: SOURCES.slack,
	},
	{
		role: "Mobile Developer",
		use: "Copy what we did in PR #4253 and apply to this component.",
		agent: AGENTS.coder,
		context: SOURCES.slack,
	},
	{
		role: "Technical Writer",
		use: "Generate JSDoc comments for the auth utility functions.",
		agent: AGENTS.coder,
		context: SOURCES.github,
	},
	{
		role: "Junior Developer",
		use: "Review this pull request for potential performance improvements.",
		agent: AGENTS.reviewer,
		context: SOURCES.github,
	},
	{
		role: "Engineering Manager",
		use: "Break down this user profile feature into technical tasks, grouped by skill.",
		agent: AGENTS.planner,
		context: SOURCES.web,
	},
	{
		role: "Support Engineer",
		use: "What's causing this stack trace? The customer is on MacOS 26.1.",
		agent: AGENTS.explainer,
		context: SOURCES.web,
	},
	{
		role: "Frontend Developer",
		use: "Make the navigation menu responsive on mobile devices.",
		agent: AGENTS.coder,
		context: SOURCES.web,
	},
	{
		role: "Backend Engineer",
		use: "Give me two architecture options for the notification system in this PRD.",
		agent: AGENTS.planner,
		context: SOURCES.web,
	},
	{
		role: "Designer",
		use: "Implement the loading spinner animation in CSS.",
		agent: AGENTS.coder,
		context: SOURCES.web,
	},
	{
		role: "Customer Success",
		use: "Write a script to find patterns in these CPU load logs.",
		agent: AGENTS.coder,
		context: SOURCES.slack,
	},
	{
		role: "Full Stack Dev",
		use: "Refactor user_preferences to use named columns instead of a single JSON blob",
		agent: AGENTS.coder,
		context: SOURCES.extension,
	},
	{
		role: "QA Engineer",
		use: "Automate the regression suite for the checkout process.",
		agent: AGENTS.coder,
		context: SOURCES.extension,
	},
	{
		role: "DevOps Engineer",
		use: "Understand why this build error only happens in prod and fix it.",
		agent: AGENTS.coder,
		context: SOURCES.extension,
	},
	{
		role: "Product Marketer",
		use: "What were the 5 most significant PRs merged in the past week?",
		agent: AGENTS.explainer,
		context: SOURCES.slack,
	},
	{
		role: "Junior Developer",
		use: "Explain how useEffect dependency arrays work here.",
		agent: AGENTS.explainer,
		context: SOURCES.extension,
	},
	{
		role: "Senior Engineer",
		use: "Check if this implementation follows the Single Responsibility Principle.",
		agent: AGENTS.reviewer,
		context: SOURCES.github,
	},
]

// Seeded random number generator for consistent layout
function seededRandom(seed: number) {
	let value = seed
	return () => {
		value = (value * 9301 + 49297) % 233280
		return value / 233280
	}
}

const LAYER_SCALES = {
	1: 0.7,
	2: 0.85,
	3: 1.0,
	4: 1.15,
}

function distributeItems(items: UseCase[]): PositionedUseCase[] {
	const rng = seededRandom(Math.random() * 12345)
	const zones = { rows: 7, cols: 4 }
	const zoneWidth = 100 / zones.cols
	const zoneHeight = 100 / zones.rows

	// Create array of zone indices [0...19] and shuffle them
	const zoneIndices = Array.from({ length: items.length }, (_, i) => i)
	for (let i = zoneIndices.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		const temp = zoneIndices[i]!
		zoneIndices[i] = zoneIndices[j]!
		zoneIndices[j] = temp
	}

	return items.map((item, index) => {
		// Assign to a random unique zone
		const zoneIndex = zoneIndices[index]!
		const row = Math.floor(zoneIndex / zones.cols)
		const col = zoneIndex % zones.cols

		// Distribute layers evenly
		const layer = ((index % 4) + 1) as 1 | 2 | 3 | 4

		// Calculate base position (center of zone)
		const baseX = col * zoneWidth + zoneWidth / 2
		const baseY = row * zoneHeight + zoneHeight / 2

		// Add jitter (±35% of zone size to keep somewhat contained but messy)
		const jitterX = (rng() - 0.5) * zoneWidth * 0.7
		const jitterY = (rng() - 0.5) * zoneHeight * 0.7

		return {
			...item,
			avatar: `/illustrations/user-faces/${index + 1}.jpg`,
			layer,
			position: {
				x: baseX + jitterX,
				y: baseY + jitterY,
			},
			scale: LAYER_SCALES[layer],
			zIndex: layer,
		}
	})
}

function UseCaseCardContent({
	item,
	opacity = 1,
	className = "",
}: {
	item: UseCase & { avatar: string }
	opacity?: number
	className?: string
}) {
	const ContextIcon: LucideIcon = item.context.icon
	return (
		<div
			className={`rounded-xl outline outline-border/50 bg-card/80 backdrop-blur-sm p-3 md:p-4 shadow-xl transition-all hover:shadow-xl hover:outline-8 ${className}`}>
			<div
				className="text-sm flex items-center gap-2 font-medium text-violet-600 mb-1"
				style={{ opacity: opacity }}>
				<Image
					src={item.avatar}
					className="size-6 rounded-full outline-1 outline-border"
					alt=""
					width={18}
					height={18}
					unoptimized
				/>
				<span className="text-nowrap">{item.role}</span>
			</div>

			<div
				className="text-[0.7em] flex flex-wrap items-center gap-1 text-muted-foreground mb-1"
				style={{ opacity: opacity }}>
				<CornerDownRight className="size-4 shrink-0 ml-3 -mt-1" />
				<span className="text-nowrap font-mono">To {item.agent.name} Agent</span>
			</div>

			<div className="text-base font-light leading-tight my-1 ml-8" style={{ opacity: opacity }}>
				{item.use}
			</div>

			<div
				className="text-[0.7em] font-light text-muted-foreground leading-tight mt-2 ml-8"
				style={{ opacity: opacity }}>
				via <ContextIcon strokeWidth={1.5} className="size-3.5 inline ml-1" /> {item.context.name}
			</div>
		</div>
	)
}

function DesktopUseCaseCard({ item }: { item: PositionedUseCase }) {
	const opacity = Math.min(1, 0.5 + item.layer / 3)

	return (
		<motion.div
			className="absolute w-[200px] cursor-default group"
			style={{
				left: `${item.position.x}%`,
				top: `${item.position.y}%`,
				zIndex: item.zIndex,
				width: Math.round(300 + Math.random() * 100),
			}}
			initial={{ opacity: 0, scale: 0 }}
			whileInView={{
				opacity: 1,
				scale: item.scale,
				transition: {
					duration: 0.1,
					delay: 0, // Stagger by layer
				},
			}}
			whileHover={{
				scale: 1.3,
				zIndex: 30,
			}}
			viewport={{ once: true }}
			// Use standard CSS transform for the positioning to avoid conflicts with Framer Motion's scale
			transformTemplate={({ scale }) => `translate(-50%, -50%) scale(${scale})`}>
			<UseCaseCardContent
				item={item}
				opacity={opacity}
				className={item.layer === 4 ? "shadow-lg border-border" : ""}
			/>
		</motion.div>
	)
}

export function UseExamplesSection({ agentTitle = false }: { agentTitle?: boolean }) {
	const positionedItems = useMemo(() => distributeItems(USE_CASES), [])
	const [showAllMobile, setShowAllMobile] = useState(false)

	return (
		<section className="pt-24 bg-background overflow-hidden relative">
			<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2">
				<div className="absolute left-1/2 top-1/2 h-[700px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/10 blur-[140px]" />
			</div>
			<div className="container px-4 mx-auto sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-4xl font-bold tracking-tight mb-4">
						{agentTitle ? (
							<>
								Part of the AI team to help your <em>entire</em> human team
							</>
						) : (
							<>
								The AI team to help your <em>entire</em> human team
							</>
						)}
					</h2>
					<p className="text-xl font-light text-muted-foreground max-w-2xl mx-auto">
						Developers, PMs, Designers, Customer Success: everyone moves faster and more independently with
						Roo.
					</p>
				</div>

				{/* Mobile: Vertical Staggered List */}
				<div className="md:hidden flex flex-col gap-2 px-2 pb-12 max-w-md mx-auto">
					<AnimatePresence mode="popLayout">
						{positionedItems.slice(0, showAllMobile ? undefined : 8).map((item, index) => (
							<motion.div
								key={item.use} // Use a unique key for proper animation tracking
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								transition={{ delay: (index % 8) * 0.1, duration: 0.4 }}
								viewport={{ once: true, margin: "-50px" }}
								className={`w-[90%] ${index % 2 === 0 ? "self-start" : "self-end"}`}>
								<UseCaseCardContent item={item} />
							</motion.div>
						))}
					</AnimatePresence>

					{!showAllMobile && (
						<div className="text-center mt-8 z-10">
							<Button variant="outline" onClick={() => setShowAllMobile(true)}>
								More
								<ChevronDown />
							</Button>
						</div>
					)}
				</div>

				{/* Desktop: Positioned Items Container */}
				<div className="hidden md:block relative h-[800px] md:min-h-[800px] w-full max-w-6xl mx-auto">
					{positionedItems.map((item, index) => (
						<DesktopUseCaseCard key={index} item={item} />
					))}
				</div>
			</div>
		</section>
	)
}
