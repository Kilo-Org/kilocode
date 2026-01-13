import { Bot, Settings2, ShieldCheck } from "lucide-react"

export function CloudSection() {
	return (
		<section className="py-24 bg-muted/30">
			<div className="container px-4 mx-auto sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">Asynchronous Engineering.</h2>
					<p className="text-xl text-muted-foreground max-w-2xl mx-auto">
						Stop watching the cursor. Deploy specialized agents to work while you sleep.
					</p>
				</div>

				{/* Pipeline Diagram Visual */}
				<div className="flex flex-wrap items-center justify-center gap-4 mb-20 text-sm font-medium">
					<div className="px-4 py-2 bg-background border border-border rounded-lg">Ticket</div>
					<div className="w-8 h-[1px] bg-border" />
					<div className="px-4 py-2 bg-purple-500/10 border border-purple-500/20 text-purple-500 rounded-lg">
						Planner Agent
					</div>
					<div className="w-8 h-[1px] bg-border" />
					<div className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-500 rounded-lg">
						Coder Agent
					</div>
					<div className="w-8 h-[1px] bg-border" />
					<div className="px-4 py-2 bg-green-500/10 border border-green-500/20 text-green-500 rounded-lg">
						GitHub PR
					</div>
				</div>

				<div className="grid md:grid-cols-2 gap-12">
					<div className="bg-background p-8 rounded-2xl border border-border shadow-sm">
						<div className="flex items-center gap-3 mb-6">
							<div className="p-2 bg-blue-500/10 rounded-lg">
								<ShieldCheck className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="text-xl font-bold">Purpose-Built Agents (Safety)</h3>
						</div>
						<h4 className="text-lg font-semibold mb-2">Zero Drift via Role Constraints</h4>
						<p className="text-muted-foreground mb-6">
							Fear of agents going haywire is solved by architecture, not prompt engineering. Cloud Agents
							enforce the strict Modes you use locally.
						</p>
						<ul className="space-y-4">
							<li className="flex gap-3 items-start">
								<Bot className="h-5 w-5 text-purple-500 mt-0.5" />
								<div>
									<span className="font-bold">The Planner:</span>
									<span className="text-muted-foreground ml-2">
										Maps dependencies. Read-Only access.
									</span>
								</div>
							</li>
							<li className="flex gap-3 items-start">
								<Bot className="h-5 w-5 text-blue-500 mt-0.5" />
								<div>
									<span className="font-bold">The Builder:</span>
									<span className="text-muted-foreground ml-2">
										Writes code based on the plan. Scoped file access.
									</span>
								</div>
							</li>
							<li className="flex gap-3 items-start">
								<Bot className="h-5 w-5 text-green-500 mt-0.5" />
								<div>
									<span className="font-bold">The Reviewer:</span>
									<span className="text-muted-foreground ml-2">
										Analyzes diffs. Cannot push to main.
									</span>
								</div>
							</li>
						</ul>
					</div>

					<div className="bg-background p-8 rounded-2xl border border-border shadow-sm">
						<div className="flex items-center gap-3 mb-6">
							<div className="p-2 bg-purple-500/10 rounded-lg">
								<Settings2 className="h-6 w-6 text-purple-500" />
							</div>
							<h3 className="text-xl font-bold">Orchestrated Configuration</h3>
						</div>
						<h4 className="text-lg font-semibold mb-2">Optimize Your AI Workforce</h4>
						<p className="text-muted-foreground mb-6">
							Just as you choose models locally, you configure them for the cloud to balance performance
							vs. cost.
						</p>
						<div className="p-4 bg-muted/50 rounded-lg border border-border">
							<div className="text-sm font-mono text-muted-foreground mb-2">Config Example:</div>
							<div className="space-y-2">
								<div className="flex justify-between items-center p-2 bg-background rounded border border-border">
									<span className="font-medium">Planner Agent</span>
									<span className="text-xs bg-purple-500/10 text-purple-500 px-2 py-1 rounded">
										o1-preview (Reasoning)
									</span>
								</div>
								<div className="flex justify-between items-center p-2 bg-background rounded border border-border">
									<span className="font-medium">Unit Test Agent</span>
									<span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-1 rounded">
										Haiku (Speed/Cost)
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
