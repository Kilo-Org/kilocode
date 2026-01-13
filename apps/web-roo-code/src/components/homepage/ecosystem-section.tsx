import { GitMerge, Terminal, MessageSquare } from "lucide-react"

export function EcosystemSection() {
	return (
		<section className="py-24 bg-background">
			<div className="container px-4 mx-auto sm:px-6 lg:px-8 text-center">
				<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-16">Integrated into your SDLC.</h2>

				<div className="relative max-w-4xl mx-auto">
					{/* Triangle Connection Lines - Absolute positioned */}
					<div className="absolute inset-0 hidden md:block pointer-events-none">
						<svg
							className="w-full h-full"
							viewBox="0 0 800 400"
							fill="none"
							xmlns="http://www.w3.org/2000/svg">
							<path
								d="M400 50 L150 350"
								stroke="currentColor"
								strokeOpacity="0.1"
								strokeWidth="2"
								strokeDasharray="8 8"
							/>
							<path
								d="M400 50 L650 350"
								stroke="currentColor"
								strokeOpacity="0.1"
								strokeWidth="2"
								strokeDasharray="8 8"
							/>
							<path
								d="M150 350 L650 350"
								stroke="currentColor"
								strokeOpacity="0.1"
								strokeWidth="2"
								strokeDasharray="8 8"
							/>
						</svg>
					</div>

					<div className="grid md:grid-cols-3 gap-8 relative z-10">
						{/* Step 1: Dispatch */}
						<div className="flex flex-col items-center">
							<div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 border border-blue-500/20">
								<MessageSquare className="h-8 w-8 text-blue-500" />
							</div>
							<div className="text-sm font-bold text-blue-500 mb-2">01. DISPATCH</div>
							<h3 className="text-xl font-bold mb-3">Trigger Task</h3>
							<p className="text-muted-foreground text-sm max-w-[250px]">
								Trigger a task via @Roo in Slack or the VS Code terminal.
							</p>
						</div>

						{/* Step 2: Execute */}
						<div className="flex flex-col items-center md:-mt-12">
							<div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 border border-purple-500/20">
								<Terminal className="h-8 w-8 text-purple-500" />
							</div>
							<div className="text-sm font-bold text-purple-500 mb-2">02. EXECUTE</div>
							<h3 className="text-xl font-bold mb-3">Run Agents</h3>
							<p className="text-muted-foreground text-sm max-w-[250px]">
								Agents run in isolated, ephemeral docker containers.
							</p>
						</div>

						{/* Step 3: Merge */}
						<div className="flex flex-col items-center">
							<div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mb-6 border border-green-500/20">
								<GitMerge className="h-8 w-8 text-green-500" />
							</div>
							<div className="text-sm font-bold text-green-500 mb-2">03. MERGE</div>
							<h3 className="text-xl font-bold mb-3">Review PR</h3>
							<p className="text-muted-foreground text-sm max-w-[250px]">
								The output is always a standard GitHub Pull Request. You review code, not chat logs.
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
