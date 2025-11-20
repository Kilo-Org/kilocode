"use client"

import { useEffect } from "react"
import { motion } from "framer-motion"
import useEmblaCarousel from "embla-carousel-react"
import AutoPlay from "embla-carousel-autoplay"
import { Bug, FileText, Gauge, Languages, Microscope, PocketKnife, TestTube, type LucideIcon } from "lucide-react"

// AI Agent types for the carousel
interface AIAgent {
	icon: LucideIcon
	name: string
}

const aiAgents: AIAgent[] = [
	{ icon: PocketKnife, name: "Generalist" },
	{ icon: Bug, name: "Bug Fixer" },
	{ icon: TestTube, name: "Test Engineer" },
	{ icon: Microscope, name: "Security Auditor" },
	{ icon: Gauge, name: "Performance Optimizer" },
	{ icon: FileText, name: "Documentation Writer" },
	{ icon: Languages, name: "String Translator" },
]

export function AgentCarousel() {
	const [emblaRef, emblaApi] = useEmblaCarousel(
		{
			loop: true,
			align: "start",
			watchDrag: true,
			dragFree: false,
			containScroll: false,
			duration: 10000,
		},
		[
			AutoPlay({
				playOnInit: true,
				delay: 0,
				stopOnInteraction: false,
				stopOnMouseEnter: false,
				stopOnFocusIn: false,
			}),
		],
	)

	// Continuous scrolling effect
	useEffect(() => {
		if (!emblaApi) return

		const autoPlay = emblaApi?.plugins()?.autoPlay as
			| {
					play?: () => void
			  }
			| undefined

		if (autoPlay?.play) {
			autoPlay.play()
		}

		// Set up continuous scrolling
		const interval = setInterval(() => {
			if (emblaApi) {
				emblaApi.scrollNext()
			}
		}, 30) // Smooth continuous scroll

		return () => clearInterval(interval)
	}, [emblaApi])

	const containerVariants = {
		hidden: { opacity: 0 },
		visible: {
			opacity: 1,
			transition: {
				duration: 0.6,
				ease: [0.21, 0.45, 0.27, 0.9],
			},
		},
	}

	// Duplicate the agents array for seamless infinite scroll
	const displayAgents = [...aiAgents, ...aiAgents]

	return (
		<motion.div
			className="relative -mx-4 md:mx-auto max-w-[1400px]"
			variants={containerVariants}
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true }}>
			{/* Gradient Overlays */}
			<div className="absolute inset-y-0 left-0 z-10 w-[10%] bg-gradient-to-r from-background to-transparent pointer-events-none md:w-[15%]" />
			<div className="absolute inset-y-0 right-0 z-10 w-[10%] bg-gradient-to-l from-background to-transparent pointer-events-none md:w-[15%]" />

			{/* Embla Carousel Container */}
			<div className="overflow-hidden" ref={emblaRef}>
				<div className="flex pb-4">
					{displayAgents.map((agent, index) => {
						const Icon = agent.icon
						return (
							<div
								key={`${agent.name}-${index}`}
								className="relative min-w-0 flex-[0_0_45%] px-2 md:flex-[0_0_30%] md:px-4 lg:flex-[0_0_15%]">
								<div className="group relative py-6 cursor-default">
									<div
										className="relative flex flex-col items-center justify-center rounded-full w-[150px] h-[150px] border border-border bg-background p-6 transition-all duration-500 ease-out shadow-xl
                                    hover:scale-110 hover:-translate-y-2
                                    hover:shadow-[0_20px_50px_rgba(39,110,226,0.25)] dark:hover:shadow-[0_20px_50px_rgba(59,130,246,0.25)]">
										<Icon
											strokeWidth={1}
											className="size-9 mb-2 text-foreground transition-colors duration-300"
										/>
										<h3 className="text-center leading-tight tracking-tight font-medium text-foreground/90 transition-colors duration-300 dark:text-foreground">
											{agent.name}
										</h3>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</motion.div>
	)
}
