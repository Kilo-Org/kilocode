"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, GitPullRequest, Paperclip, Send } from "lucide-react"

import { cn } from "@/lib/utils"

type ActivityItem = {
	id: string
	kind: "comment" | "event" | "pr-link"
	author?: string
	avatarText?: string
	avatarClassName?: string
	body: ReactNode
	timeLabel: string
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
		<span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden="true">
			<span className="h-1 w-1 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:0ms]" />
			<span className="h-1 w-1 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:180ms]" />
			<span className="h-1 w-1 rounded-full bg-[#8B8D91] animate-pulse [animation-delay:360ms]" />
		</span>
	)
}

function LinearIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 100 100" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
			<path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z" />
		</svg>
	)
}

type ActivityRowProps = {
	item: ActivityItem
	isNew: boolean
	reduceMotion: boolean
}

function ActivityRow({ item, isNew, reduceMotion }: ActivityRowProps): JSX.Element {
	let animation = ""
	if (!reduceMotion && isNew) {
		animation = "animate-in fade-in slide-in-from-bottom-1 duration-300"
	}

	// Event items (status changes, etc.) - compact inline format
	if (item.kind === "event") {
		return (
			<div className={cn("flex items-center gap-2 text-[13px] text-[#8B8D91]", animation)}>
				<div
					className={cn(
						"flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
						item.avatarClassName,
					)}>
					{item.avatarText}
				</div>
				<span className="text-[#F8F8F9]">{item.author}</span>
				<span>{item.body}</span>
				<span className="text-[#5C5F66]">·</span>
				<span>{item.timeLabel}</span>
			</div>
		)
	}

	// PR link events
	if (item.kind === "pr-link") {
		return (
			<div className={cn("flex items-center gap-2 text-[13px] text-[#8B8D91]", animation)}>
				<GitPullRequest className="h-4 w-4 shrink-0 text-emerald-500" />
				<span>{item.body}</span>
				<span className="text-[#5C5F66]">·</span>
				<span>{item.timeLabel}</span>
			</div>
		)
	}

	// Comment items - more substantial with message body
	return (
		<div className={cn("flex gap-2.5", animation)}>
			<div
				className={cn(
					"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
					item.avatarClassName,
				)}>
				{item.avatarText}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 text-[13px]">
					<span className="font-medium text-[#F8F8F9]">{item.author}</span>
					<span className="text-[#5C5F66]">·</span>
					<span className="text-[#8B8D91]">{item.timeLabel}</span>
				</div>
				<div className="mt-1 text-[13px] leading-relaxed text-[#D1D2D3]">{item.body}</div>
			</div>
		</div>
	)
}

export type LinearIssueDemoProps = {
	className?: string
}

export function LinearIssueDemo({ className }: LinearIssueDemoProps): JSX.Element {
	const reduceMotion = usePrefersReducedMotion()
	const [stepIndex, setStepIndex] = useState(0)
	const scrollViewportRef = useRef<HTMLDivElement>(null)

	const activityItems: ActivityItem[] = useMemo(
		() => [
			{
				id: "a1",
				kind: "comment",
				author: "Jordan",
				avatarText: "J",
				avatarClassName: "bg-amber-600 text-white",
				body: (
					<span>
						<span className="text-indigo-400">@Roo Code</span> Can you implement this feature?
					</span>
				),
				timeLabel: "2m ago",
			},
			{
				id: "a2",
				kind: "comment",
				author: "Roo Code",
				avatarText: "R",
				avatarClassName: "bg-indigo-600 text-white",
				body: <span>Analyzing issue requirements and codebase...</span>,
				timeLabel: "2m ago",
			},
			{
				id: "a3",
				kind: "event",
				author: "Roo Code",
				avatarText: "R",
				avatarClassName: "bg-indigo-600 text-white",
				body: <span>moved to In Progress</span>,
				timeLabel: "2m ago",
			},
			{
				id: "a4",
				kind: "comment",
				author: "Roo Code",
				avatarText: "R",
				avatarClassName: "bg-indigo-600 text-white",
				body: <span>Planning implementation: Settings component with light/dark toggle.</span>,
				timeLabel: "1m ago",
			},
			{
				id: "a5",
				kind: "comment",
				author: "Jordan",
				avatarText: "J",
				avatarClassName: "bg-amber-600 text-white",
				body: (
					<span>
						<span className="text-indigo-400">@Roo Code</span> Please also add a &quot;system&quot; option
						that follows OS preference.
					</span>
				),
				timeLabel: "1m ago",
			},
			{
				id: "a6",
				kind: "comment",
				author: "Roo Code",
				avatarText: "R",
				avatarClassName: "bg-indigo-600 text-white",
				body: (
					<span>
						Got it! Adding system preference detection using{" "}
						<code className="rounded bg-white/10 px-1 py-0.5 text-[12px] text-[#F8F8F9]">
							prefers-color-scheme
						</code>
					</span>
				),
				timeLabel: "30s ago",
			},
			{
				id: "a7",
				kind: "pr-link",
				body: (
					<span>
						<span className="text-[#F8F8F9]">Roo Code</span> linked{" "}
						<span className="text-emerald-400">PR #847</span>
					</span>
				),
				timeLabel: "just now",
			},
			{
				id: "a8",
				kind: "comment",
				author: "Roo Code",
				avatarText: "R",
				avatarClassName: "bg-indigo-600 text-white",
				body: (
					<div className="space-y-2">
						<div>
							PR ready for review:{" "}
							<span className="text-indigo-400 hover:underline cursor-default">#847</span>
						</div>
						<div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px]">
							<div className="flex items-center gap-2 text-emerald-400">
								<GitPullRequest className="h-3.5 w-3.5" />
								<span className="font-medium">feat: add theme toggle with system preference</span>
							</div>
							<div className="mt-1 text-[#8B8D91]">+142 -12 · 3 files changed</div>
						</div>
					</div>
				),
				timeLabel: "just now",
			},
		],
		[],
	)

	type DemoPhase =
		| { kind: "issue" }
		| { kind: "show"; activityIndex: number }
		| { kind: "typing"; activityIndex: number }
		| { kind: "reset" }

	const phases: DemoPhase[] = useMemo(() => {
		const next: DemoPhase[] = []

		next.push({ kind: "issue" })

		for (let activityIndex = 0; activityIndex < activityItems.length; activityIndex += 1) {
			const item = activityItems[activityIndex]
			if (item?.kind === "comment") {
				next.push({ kind: "typing", activityIndex })
			}
			next.push({ kind: "show", activityIndex })
		}
		next.push({ kind: "reset" })
		return next
	}, [activityItems])

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
			const base = 2000
			if (active?.kind === "reset") return 500
			if (active?.kind === "issue") return 1500
			if (active?.kind === "typing") return 800
			return isLastMessageShow ? base * 2.5 : base
		})()

		const timer = window.setTimeout(() => {
			const nextIndex = (stepIndex + 1) % phases.length
			setStepIndex(nextIndex)
		}, durationMs)

		return () => window.clearTimeout(timer)
	}, [lastShowPhaseIndex, phases, reduceMotion, stepIndex])

	const activePhase = phases[stepIndex] ?? phases.at(0) ?? { kind: "issue" }

	function getVisibleCount(phase: DemoPhase): number {
		if (phase.kind === "reset" || phase.kind === "issue") return 0
		if (phase.kind === "typing") return phase.activityIndex
		return phase.activityIndex + 1
	}

	const visibleCount = getVisibleCount(activePhase)
	const visibleActivities = activityItems.slice(0, visibleCount)
	const typingTarget = activePhase.kind === "typing" ? activityItems[activePhase.activityIndex] : undefined

	useEffect(() => {
		const viewport = scrollViewportRef.current
		if (!viewport) return

		if (activePhase.kind === "reset" || activePhase.kind === "issue" || visibleCount <= 1) {
			viewport.scrollTo({ top: 0, behavior: "auto" })
			return
		}

		viewport.scrollTo({
			top: viewport.scrollHeight,
			behavior: reduceMotion ? "auto" : "smooth",
		})
	}, [activePhase.kind, reduceMotion, visibleCount])

	const issueVisible = activePhase.kind !== "reset"

	return (
		<div
			className={cn("w-full max-w-[540px] h-[520px] sm:h-[560px]", className)}
			role="img"
			aria-label="Animated Linear issue showing Roo Code responding to a comment">
			<div
				aria-hidden="true"
				className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1F2023] shadow-2xl shadow-black/40">
				{/* Linear-style Header with breadcrumb */}
				<div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[13px]">
					<LinearIcon className="h-4 w-4 text-[#8B8D91]" />
					<span className="text-[#8B8D91]">Frontend</span>
					<ChevronRight className="h-3 w-3 text-[#5C5F66]" />
					<span className="text-[#F8F8F9]">FE-312</span>
					<div className="ml-auto flex items-center gap-2 text-[11px] text-[#8B8D91]">
						<span className="h-2 w-2 rounded-full bg-[#27AE60]" />
						Live demo
					</div>
				</div>

				{/* Issue Content */}
				<div
					className={cn(
						"flex flex-col flex-1 overflow-hidden transition-opacity duration-300 will-change-opacity",
						issueVisible ? "opacity-100" : "opacity-0",
					)}>
					{/* Issue Title */}
					<div className="px-4 pt-4 pb-3">
						<h3 className="text-lg font-semibold text-[#F8F8F9] leading-tight">
							Add dark mode toggle to settings
						</h3>
						<p className="mt-2 text-[13px] text-[#8B8D91] leading-relaxed">
							Users should be able to switch between light and dark themes from the settings page. Persist
							preference to localStorage and apply immediately.
						</p>
					</div>

					{/* Activity Section */}
					<div className="flex-1 overflow-hidden flex flex-col border-t border-white/10">
						<div className="px-4 py-2.5 flex items-center justify-between">
							<span className="text-[13px] font-medium text-[#F8F8F9]">Activity</span>
							<span className="text-[12px] text-[#5C5F66]">Unsubscribe</span>
						</div>
						<div
							ref={scrollViewportRef}
							className="flex-1 overflow-y-auto px-4 pb-3 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]">
							<div className="space-y-3">
								{visibleActivities.map((item) => (
									<ActivityRow
										key={item.id}
										item={item}
										reduceMotion={reduceMotion}
										isNew={
											activePhase.kind === "show" &&
											activityItems[activePhase.activityIndex]?.id === item.id
										}
									/>
								))}

								{typingTarget && typingTarget.kind === "comment" && (
									<div
										className={cn(
											reduceMotion ? "" : "animate-in fade-in duration-300",
											"flex gap-2.5",
										)}>
										<div
											className={cn(
												"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
												typingTarget.avatarClassName,
											)}>
											{typingTarget.avatarText}
										</div>
										<div className="min-w-0">
											<div className="flex items-center gap-2 text-[13px]">
												<span className="font-medium text-[#F8F8F9]">
													{typingTarget.author}
												</span>
												<span className="text-[#8B8D91]">typing</span>
												<TypingDots />
											</div>
										</div>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Comment Input */}
					<div className="border-t border-white/10 px-4 py-3">
						<div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
							<span className="flex-1 text-[13px] text-[#5C5F66]">Leave a comment...</span>
							<Paperclip className="h-4 w-4 text-[#5C5F66]" />
							<Send className="h-4 w-4 text-[#5C5F66]" />
						</div>
					</div>
				</div>

				{/* Progress indicator */}
				<div className="flex items-center justify-center border-t border-white/10 px-4 py-2">
					<div className="flex items-center gap-1">
						{activityItems.map((item, idx) => (
							<span
								key={item.id}
								className={cn(
									"h-1 w-3 rounded-full transition-colors duration-300",
									Math.max(0, visibleCount - 1) === idx ? "bg-indigo-400" : "bg-white/10",
								)}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
