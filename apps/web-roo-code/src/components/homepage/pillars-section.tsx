import { Brain, Keyboard, Shield, Users2, Map, Code, MessageCircleQuestion, Bug, TestTube } from "lucide-react"
import Image from "next/image"
import { Link } from "../ui"

const MODEL_LOGOS = [
	"OpenRouter",
	"Anthropic",
	"OpenAI",
	"Gemini",
	"Grok",
	"Bedrock",
	"Moonshot",
	"Qwen",
	"Kimi",
	"Mistral",
	"Ollama",
]
const MODE_EXAMPLES = [
	{
		name: "Architect",
		description: "Plans complex changes without making changes.",
		icon: Map,
	},
	{
		name: "Code",
		description: "Implements, refactors and optimizes code.",
		icon: Code,
	},
	{
		name: "Ask",
		description: "Explains functionality and program behavior.",
		icon: MessageCircleQuestion,
	},
	{
		name: "Debug",
		description: "Diagnoses issues, traces failures, and proposes targeted, reliable fixes.",
		icon: Bug,
	},
	{
		name: "Test",
		description: "Creates and improves performant tests without changing the actual functionality.",
		icon: TestTube,
	},
]

export function PillarsSection() {
	return (
		<section className="py-24 bg-muted/30 relative">
			<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2">
				<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 dark:bg-blue-700/20 blur-[140px]" />
			</div>
			<div className="container px-4 mx-auto sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
						To trust an agent, you have to do it on your own terms.
					</h2>
					<p className="text-xl text-muted-foreground max-w-xl mx-auto">
						Roo is designed from the ground up to give you the confidence to do ever more with AI.
					</p>
				</div>

				<div className="flex flex-col md:grid md:grid-cols-8 gap-8">
					<div className="relative md:col-span-3 h-full">
						<div className="rounded-2xl bg-card outline outline-border/50 hover:outline-8 shadow-lg p-8 h-full group transition-all hover:shadow-2xl">
							<div className="absolute -right-3 -top-5 bg-card border shadow-md rounded-full p-3 transition-all  group-hover:-top-4  group-hover:-right-2 group-hover:scale-110 group-hover:shadow-xl">
								<Brain className="size-8 text-violet-600 shrink-0 mt-1" strokeWidth={1.5} />
							</div>
							<div>
								<h3 className="text-2xl font-bold mb-1">Model-agnostic by design</h3>
								<h4 className="font-semibold text-lg">Flexible and future-proof.</h4>
								<div className="text-muted-foreground my-4 space-y-1">
									<p>
										&quot;The best model in the world&quot; changes every other week. Providers
										throttle models with no warning. 1st-party coding agents only work with their
										own models.
									</p>
									<p>Roo doesn&apos;t care.</p>
									<p>
										It works great with 10s of models, from frontier to open weight. Choose from{" "}
										<Link href="/provider">the curated selection we offer at-cost</Link> or bring
										your own key.
									</p>
								</div>
								<div className="mt-6">
									<span className="text-muted-foreground text-sm">
										Compatible with dozens of providers
									</span>
									<div className="mt-4 flex flex-wrap items-center gap-4">
										{MODEL_LOGOS.map((logo, index) => (
											<Image
												key={logo}
												width={20}
												height={20}
												className="size-6 overflow-clip dark:invert"
												style={{ opacity: 1.1 - index / MODEL_LOGOS.length }}
												src={`/logos/${logo.toLowerCase()}.svg`}
												alt={`${logo} Logo`}
											/>
										))}
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="relative col-span-5 h-full">
						<div className="rounded-2xl bg-card outline outline-border/50 hover:outline-8 shadow-lg p-8 h-full group transition-all hover:shadow-2xl">
							<div className="absolute -right-3 -top-5 bg-card border shadow-lg rounded-full p-3 transition-all  group-hover:-top-4  group-hover:-right-2 group-hover:scale-110 group-hover:shadow-xl">
								<Users2 className="size-8 text-violet-600 shrink-0 mt-1" strokeWidth={1.5} />
							</div>
							<div>
								<h3 className="text-2xl font-bold mb-1">Role-specific Modes</h3>
								<h4 className="font-semibold text-lg">On-task and under control.</h4>
								<div className="text-muted-foreground my-4 space-y-1">
									<p>
										As capable as they are, when let loose, LLMs hallucinate, cheat and can cause
										real damage.
									</p>
									<p>
										Roo&apos;s Modes keep models focused on a given task and limit their access to
										tools which are relevant to their role, keeping the context window clearer and
										avoiding surprises.
									</p>
									<p>
										Modes are even smart enough to ask to switch to another when stepping outside
										their responsibilities.
									</p>
								</div>
								<div className="mt-6">
									<span className="text-muted-foreground text-sm">Some examples</span>
									<ul className="flex gap-2 flex-wrap mt-2">
										{MODE_EXAMPLES.map((mode) => {
											const Icon = mode.icon
											return (
												<li
													key={mode.name}
													className="rounded-lg border bg-border/40 w-full md:w-[30%] min-w-[200px] text-sm px-3 py-2 flex gap-1">
													<Icon className="text-muted-foreground size-4 shrink-0 mt-0.5" />
													<div>
														<p className="font-semibold">{mode.name}</p>
														<p className="text-muted-foreground text-xs">
															{mode.description}
														</p>
													</div>
												</li>
											)
										})}
									</ul>
								</div>
							</div>
						</div>
					</div>

					<div className="relative col-span-4 h-full">
						<div className="rounded-2xl bg-card outline outline-border/50 hover:outline-8 shadow-lg p-8 h-full group transition-all hover:shadow-2xl">
							<div className="absolute -right-3 -top-5 bg-card border shadow-lg rounded-full p-3 transition-all  group-hover:-top-4  group-hover:-right-2 group-hover:scale-110 group-hover:shadow-xl">
								<Keyboard className="size-8 text-violet-600 shrink-0 mt-1" strokeWidth={1.5} />
							</div>
							<div>
								<h3 className="text-2xl font-bold mb-1">Highly configurable</h3>
								<h4 className="font-semibold text-lg">Make it fit your workflow.</h4>
								<div className="text-muted-foreground my-4 space-y-1">
									<p>
										Developer tools need to fit like gloves. Highly tweakable,
										keyboard-shortcut-heavy gloves.
									</p>
									<p>We made Roo thoughtfully configurable to fit your workflow as best it can.</p>
								</div>
							</div>
						</div>
					</div>

					<div className="relative col-span-4 h-full">
						<div className="rounded-2xl bg-card outline outline-border/50 hover:outline-8 shadow-lg p-8 h-full group transition-all hover:shadow-2xl">
							<div className="absolute -right-3 -top-5 bg-card border shadow-lg rounded-full p-3 transition-all  group-hover:-top-4  group-hover:-right-2 group-hover:scale-110 group-hover:shadow-xl">
								<Shield className="size-8 text-violet-600 shrink-0 mt-1" strokeWidth={1.5} />
							</div>
							<div>
								<h3 className="text-2xl font-bold mb-1">Secure and transparent</h3>
								<h4 className="font-semibold text-lg">Open source from the get go.</h4>
								<div className="text-muted-foreground my-4 space-y-1">
									<p>
										The Roo Code Extension is{" "}
										<Link target="_blank" href="https://github.com/Roo-Code-Inc/Roo-Code">
											open source
										</Link>{" "}
										so you can see for yourself exactly what it&apos;s doing and we don&apos;t use
										your data for training.
									</p>
									<p>
										Plus we&apos;re fully SOC2 Type 2 compliant and follow industry-standard
										security practices.
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
