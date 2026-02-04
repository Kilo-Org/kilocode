"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Paperclip } from "lucide-react"

import { cn } from "@/lib/utils"

type SlackMessage = {
	id: string
	author: string
	timeLabel: string
	body: ReactNode
	avatarText: string
	avatarClassName: string
	kind: "human" | "bot"
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false)

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)")
		const onChange = () => setReduced(media.matches)
		onChange()

		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", onChange)
			return () => media.removeEventListener("change", onChange)
		}

		media.addListener?.(onChange)
		return () => media.removeListener?.(onChange)
	}, [])

	return reduced
}

type TypingDotsProps = {
	className?: string
}

function TypingDots({ className }: TypingDotsProps): JSX.Element {
	return (
		<span className={cn("inline-flex items-center gap-1", className)} aria-hidden="true">
			<span className="h-1.5 w-1.5 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:0ms]" />
			<span className="h-1.5 w-1.5 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:180ms]" />
			<span className="h-1.5 w-1.5 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:360ms]" />
		</span>
	)
}

type FakeLinkProps = {
	children: ReactNode
	className?: string
}

function FakeLink({ children, className }: FakeLinkProps): JSX.Element {
	return (
		<span className={cn("text-violet-300 underline underline-offset-2", "cursor-default", className)}>
			{children}
		</span>
	)
}

type SlackMessageRowProps = {
	message: SlackMessage
	isNew: boolean
	reduceMotion: boolean
}

function SlackMessageRow({ message, isNew, reduceMotion }: SlackMessageRowProps): JSX.Element {
	let animation = ""
	if (!reduceMotion && isNew) {
		animation = "animate-in fade-in slide-in-from-bottom-2 duration-500"
	}

	return (
		<div className={cn("flex gap-3", animation)}>
			<div
				className={cn(
					"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
					message.avatarClassName,
				)}>
				{message.avatarText}
			</div>
			<div className="min-w-0">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<span className="text-[13px] font-semibold text-[#F8F8F9]">{message.author}</span>
					<span className="text-[11px] text-[#8B8D91]">{message.timeLabel}</span>
					{message.kind === "bot" && (
						<span className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-200">
							<CheckCircle2 className="h-3 w-3" />
							App
						</span>
					)}
				</div>
				<div className="mt-1 text-[13px] leading-relaxed text-[#D1D2D3]">{message.body}</div>
			</div>
		</div>
	)
}

export type SlackThreadDemoProps = {
	className?: string
}

export function SlackThreadDemo({ className }: SlackThreadDemoProps): JSX.Element {
	const reduceMotion = usePrefersReducedMotion()
	const [stepIndex, setStepIndex] = useState(0)
	const scrollViewportRef = useRef<HTMLDivElement>(null)

	const messages: SlackMessage[] = useMemo(
		() => [
			{
				id: "m1",
				author: "Avery Lee",
				timeLabel: "Monday at 2:56 PM",
				avatarText: "AL",
				avatarClassName: "bg-[#2B2D31] text-[#F8F8F9] ring-1 ring-white/10",
				kind: "human",
				body: (
					<span>We need to add a page to our Marketing site that highlights using Roo Code from Slack.</span>
				),
			},
			{
				id: "m2",
				author: "Avery Lee",
				timeLabel: "Monday at 2:58 PM",
				avatarText: "AL",
				avatarClassName: "bg-[#2B2D31] text-[#F8F8F9] ring-1 ring-white/10",
				kind: "human",
				body: (
					<div className="space-y-2">
						<div>
							The documentation for using Roo Code from Slack is here:{" "}
							<FakeLink className="hover:text-violet-200">
								https://docs.roocode.com/roo-code-cloud/slack-integration
							</FakeLink>
						</div>
						<div className="text-[#B8BBC0]">Here are some pages from our site we can use for guidance:</div>
						<ol className="list-decimal pl-5 text-[#D1D2D3]">
							<li>
								<FakeLink className="hover:text-violet-200">https://roocode.com</FakeLink>
							</li>
							<li>
								<FakeLink className="hover:text-violet-200">https://roocode.com/extension</FakeLink>
							</li>
							<li>
								<FakeLink className="hover:text-violet-200">https://roocode.com/cloud</FakeLink>
							</li>
						</ol>
					</div>
				),
			},
			{
				id: "m3",
				author: "Avery Lee",
				timeLabel: "Monday at 3:08 PM",
				avatarText: "AL",
				avatarClassName: "bg-[#2B2D31] text-[#F8F8F9] ring-1 ring-white/10",
				kind: "human",
				body: (
					<div className="space-y-3">
						<div>This is the start of a wireframe I have in mind for this page</div>
						<div className="w-full max-w-[420px] rounded-lg border border-white/10 bg-black/20 p-3">
							<div className="flex items-center gap-2 text-[12px] text-[#B8BBC0]">
								<Paperclip className="h-4 w-4" />
								IMG_9721.heic
							</div>
							<div className="mt-3 h-24 w-full rounded-md bg-gradient-to-br from-white/10 via-white/5 to-white/0" />
						</div>
					</div>
				),
			},
			{
				id: "m4",
				author: "Avery Lee",
				timeLabel: "Monday at 3:09 PM",
				avatarText: "AL",
				avatarClassName: "bg-[#2B2D31] text-[#F8F8F9] ring-1 ring-white/10",
				kind: "human",
				body: (
					<span>
						<FakeLink className="no-underline hover:text-violet-200">@Roomote</FakeLink> let&apos;s create
						the plan to deliver this
					</span>
				),
			},
			{
				id: "m5",
				author: "Roomote",
				timeLabel: "Monday at 3:09 PM",
				avatarText: "R",
				avatarClassName: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
				kind: "bot",
				body: (
					<div className="space-y-3">
						<div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[#D1D2D3]">
							Calling <span className="font-semibold text-[#F8F8F9]">Planneroo</span> to get started on
							your task on{" "}
							<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
								RooCodeInc/Roo-Code
							</code>
						</div>
						<div>
							<button
								type="button"
								className="inline-flex items-center rounded-md border border-white/10 bg-transparent px-2 py-1 text-[12px] font-medium text-[#D1D2D3] hover:bg-white/5">
								Cancel ✕
							</button>
						</div>
					</div>
				),
			},
			{
				id: "m6",
				author: "Roomote",
				timeLabel: "Monday at 3:10 PM",
				avatarText: "R",
				avatarClassName: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
				kind: "bot",
				body: (
					<div className="space-x-2">
						<span>Cool, I&apos;ll knock this out real quick.</span>
						<FakeLink className="hover:text-violet-200">Follow along</FakeLink>
					</div>
				),
			},
			{
				id: "m7",
				author: "Roomote",
				timeLabel: "Monday at 3:12 PM",
				avatarText: "R",
				avatarClassName: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
				kind: "bot",
				body: (
					<div className="space-y-2">
						<div className="font-semibold text-[#F8F8F9]">Todo List:</div>
						<div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
							<ul className="space-y-1">
								{[
									"Analyze existing page structures and component patterns",
									"Review marketing content requirements and wireframe details",
									"Create detailed component architecture plan",
									"Design page structure and section breakdown",
									"Plan navigation updates and integration points",
									"Test the page and verify all sections work",
								].map((item) => (
									<li key={item} className="text-[#D1D2D3]">
										<span className="mr-2">•</span>
										<span className="line-through opacity-80">{item}</span>
									</li>
								))}
							</ul>
						</div>
						<div className="text-[12px] text-[#8B8D91]">(edited)</div>
					</div>
				),
			},
			{
				id: "m8",
				author: "Roomote",
				timeLabel: "Monday at 3:16 PM",
				avatarText: "R",
				avatarClassName: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
				kind: "bot",
				body: (
					<div className="space-y-3">
						<p>
							I&apos;ve created a comprehensive implementation plan for the Roo Code Slack integration
							marketing page at{" "}
							<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
								plans/slack-marketing-page-plan.md
							</code>
							.
						</p>
						<div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
							<div className="text-[12px] font-semibold text-[#F8F8F9]">Plan Overview</div>
							<ul className="mt-2 space-y-1 text-[#D1D2D3]">
								<li>
									<span className="mr-2">•</span>Hero + dual CTAs
								</li>
								<li>
									<span className="mr-2">•</span>Value props grid
								</li>
								<li>
									<span className="mr-2">•</span>“Thread to Shipped Feature” workflow
								</li>
								<li>
									<span className="mr-2">•</span>Onboarding steps + CTA
								</li>
							</ul>
						</div>
						<div className="space-x-2">
							<span className="text-[#B8BBC0]">Full document:</span>
							<FakeLink className="hover:text-violet-200">View artifact</FakeLink>
						</div>
						<div className="text-[12px] italic text-[#8B8D91]">
							Want to follow up? Just @-mention me in your response.
						</div>
					</div>
				),
			},
			{
				id: "m9",
				author: "Avery Lee",
				timeLabel: "Monday at 3:17 PM",
				avatarText: "AL",
				avatarClassName: "bg-[#2B2D31] text-[#F8F8F9] ring-1 ring-white/10",
				kind: "human",
				body: (
					<div className="space-x-2">
						<FakeLink className="no-underline hover:text-violet-200">@Roomote</FakeLink>
						<span>this looks great, let&apos;s use Coderoo to build this</span>
					</div>
				),
			},
			{
				id: "m10",
				author: "Roomote",
				timeLabel: "Monday at 3:23 PM",
				avatarText: "R",
				avatarClassName: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/30",
				kind: "bot",
				body: (
					<div className="space-y-3">
						<p>
							I&apos;ve built the Roo Code Slack integration marketing page. Here&apos;s what was
							implemented:
						</p>

						<div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
							<div className="text-[12px] font-semibold text-[#F8F8F9]">Files</div>
							<ul className="mt-2 space-y-1 text-[#D1D2D3]">
								<li>
									<span className="mr-2">•</span>
									<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
										apps/web-roo-code/src/app/slack/page.tsx
									</code>{" "}
									— Slack marketing page
								</li>
								<li>
									<span className="mr-2">•</span>
									<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
										apps/web-roo-code/src/lib/constants.ts
									</code>{" "}
									— added{" "}
									<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
										SLACK_DOCS
									</code>
								</li>
								<li>
									<span className="mr-2">•</span>
									<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">
										apps/web-roo-code/src/components/chromes/nav-bar.tsx
									</code>{" "}
									— added Slack to Product dropdown
								</li>
							</ul>
						</div>

						<div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
							<div className="text-[12px] font-semibold text-[#F8F8F9]">Pull Request</div>
							<div className="mt-2">
								<span className="font-semibold text-[#F8F8F9]">PR #10853</span>:{" "}
								<FakeLink className="hover:text-violet-200">
									https://github.com/RooCodeInc/Roo-Code/pull/10853
								</FakeLink>
							</div>
						</div>

						<p className="text-[#B8BBC0]">
							The page is accessible at{" "}
							<code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-[#F8F8F9]">/slack</code>{" "}
							and includes navigation links in desktop and mobile.
						</p>
					</div>
				),
			},
		],
		[],
	)

	type DemoPhase =
		| { kind: "show"; messageIndex: number }
		| { kind: "typing"; messageIndex: number }
		| { kind: "reset" }

	const phases: DemoPhase[] = useMemo(() => {
		const next: DemoPhase[] = []
		if (messages.length === 0) return [{ kind: "reset" }]

		next.push({ kind: "typing", messageIndex: 0 })
		next.push({ kind: "show", messageIndex: 0 })
		for (let messageIndex = 1; messageIndex < messages.length; messageIndex += 1) {
			next.push({ kind: "typing", messageIndex })
			next.push({ kind: "show", messageIndex })
		}
		next.push({ kind: "reset" })
		return next
	}, [messages])

	const lastShowPhaseIndex = useMemo(() => {
		let lastIndex = -1
		for (let idx = 0; idx < phases.length; idx += 1) {
			if (phases[idx]?.kind === "show") lastIndex = idx
		}
		return lastIndex
	}, [phases])

	useEffect(() => {
		if (reduceMotion) {
			setStepIndex(lastShowPhaseIndex >= 0 ? lastShowPhaseIndex : 0)
			return
		}

		const active = phases[stepIndex] ?? phases.at(0)
		const isLastMessageShow = active?.kind === "show" && stepIndex === lastShowPhaseIndex
		const durationMs = (() => {
			const base = 2200
			if (active?.kind === "reset") return 500
			if (active?.kind === "typing") return 900
			return isLastMessageShow ? base * 2 : base
		})()

		const timer = window.setTimeout(() => {
			setStepIndex((prev) => (prev + 1) % phases.length)
		}, durationMs)

		return () => window.clearTimeout(timer)
	}, [lastShowPhaseIndex, phases, reduceMotion, stepIndex])

	const activePhase = phases[stepIndex] ?? phases.at(0) ?? { kind: "reset" }

	function getVisibleCount(phase: DemoPhase): number {
		if (phase.kind === "reset") return 0
		if (phase.kind === "typing") return phase.messageIndex
		return phase.messageIndex + 1
	}

	const visibleCount = getVisibleCount(activePhase)
	const visibleMessages = messages.slice(0, visibleCount)
	const typingTarget = activePhase.kind === "typing" ? messages[activePhase.messageIndex] : undefined

	useEffect(() => {
		const viewport = scrollViewportRef.current
		if (!viewport) return

		if (activePhase.kind === "reset" || visibleCount <= 1) {
			viewport.scrollTo({ top: 0, behavior: "auto" })
			return
		}

		viewport.scrollTo({
			top: viewport.scrollHeight,
			behavior: reduceMotion ? "auto" : "smooth",
		})
	}, [activePhase.kind, reduceMotion, visibleCount])

	return (
		<div
			className={cn("w-full max-w-[620px] h-[520px] sm:h-[560px]", className)}
			role="img"
			aria-label="Animated Slack thread showing Roo Code responding as @Roomote">
			<div
				aria-hidden="true"
				className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1A1D21] shadow-2xl shadow-black/30">
				<div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
					<div className="flex items-center gap-2">
						<div className="h-2.5 w-2.5 rounded-full bg-[#F24A4A]" />
						<div className="h-2.5 w-2.5 rounded-full bg-[#F2C94C]" />
						<div className="h-2.5 w-2.5 rounded-full bg-[#27AE60]" />
						<div className="ml-3 text-sm font-semibold text-[#F8F8F9]">Thread</div>
					</div>
					<div className="flex items-center gap-2 text-[11px] text-[#8B8D91]">
						<span className="h-2 w-2 rounded-full bg-[#27AE60]" />
						Live demo
					</div>
				</div>

				<div
					ref={scrollViewportRef}
					className="flex-1 overflow-y-auto px-4 py-5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.18)_transparent]">
					<div
						className={cn(
							"space-y-5 transition-opacity duration-300 will-change-opacity",
							activePhase.kind === "reset" ? "opacity-0" : "opacity-100",
						)}>
						{visibleMessages.map((message) => (
							<SlackMessageRow
								key={message.id}
								message={message}
								reduceMotion={reduceMotion}
								isNew={
									activePhase.kind === "show" && messages[activePhase.messageIndex]?.id === message.id
								}
							/>
						))}

						{typingTarget && (
							<div className={cn(reduceMotion ? "" : "animate-in fade-in duration-300", "flex gap-3")}>
								<div
									className={cn(
										"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
										typingTarget.avatarClassName,
									)}>
									{typingTarget.avatarText}
								</div>
								<div className="min-w-0">
									<div className="flex items-baseline gap-x-2">
										<span className="text-[13px] font-semibold text-[#F8F8F9]">
											{typingTarget.author}
										</span>
										{typingTarget.kind === "bot" && (
											<span className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-200">
												<CheckCircle2 className="h-3 w-3" />
												App
											</span>
										)}
										<span className="text-[11px] text-[#8B8D91]">typing…</span>
									</div>
									<div className="mt-2">
										<TypingDots />
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				<div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
					<div className="flex items-center gap-1.5">
						{messages.map((message, idx) => (
							<span
								key={message.id}
								className={cn(
									"h-1.5 w-5 rounded-full transition-colors duration-300",
									Math.max(0, visibleCount - 1) === idx ? "bg-violet-300" : "bg-white/10",
								)}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
