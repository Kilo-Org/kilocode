import { Button } from "@/components/ui"
import {
	CompanyLogos,
	FAQSection,
	Testimonials,
	CTASection,
	OptionOverviewSection,
	PillarsSection,
	UseExamplesSection,
} from "@/components/homepage"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { ArrowRight } from "lucide-react"
import { StructuredData } from "@/components/structured-data"

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

export default async function Home() {
	return (
		<>
			<StructuredData />
			<section className="relative flex flex-col items-center overflow-hidden pt-20 pb-12 md:pt-32 md:pb-16">
				<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2 z-1">
					<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 dark:bg-violet-700/20 blur-[140px]" />
				</div>
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
					<h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground max-w-4xl mb-6">
						Your AI Software Engineering Team is here.
						<br />
						<span className="text-muted-foreground">Interactive in the IDE, autonomous in the cloud.</span>
					</h1>
					<div className="mt-2 max-w-3xl text-lg text-muted-foreground mb-10 space-y-3">
						<p>
							Use the <strong className="text-nowrap">Roo Code Extension</strong> on your computer for
							full control, or delegate work to your{" "}
							<strong className="text-nowrap">Roo Code Cloud Agents</strong> from the web, Slack, Github
							or wherever your team is.
						</p>
					</div>
					<div className="flex flex-col sm:flex-row gap-4 mb-16">
						<div className="flex flex-col items-center gap-2">
							<Button size="xl" className="w-full">
								<a
									href={EXTERNAL_LINKS.MARKETPLACE}
									target="_blank"
									rel="noreferrer"
									className="flex items-center justify-center">
									Install VS Code Extension
									<ArrowRight className="ml-2 size-5" />
								</a>
							</Button>
							<span className="text-xs text-muted-foreground">Free and Open Source</span>
						</div>

						<div className="flex flex-col items-center gap-2">
							<Button size="xl" className="w-full">
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP_HOME}
									className="flex items-center justify-center">
									Try Cloud for Free
									<ArrowRight className="ml-2 size-5" />
								</a>
							</Button>
							<span className="text-xs text-muted-foreground">No credit card needed</span>
						</div>
					</div>

					<div className="mb-12 px-4">
						<CompanyLogos />
					</div>
				</div>
			</section>

			<PillarsSection />
			<OptionOverviewSection />
			<UseExamplesSection />
			<Testimonials />
			<FAQSection />
			<CTASection />
		</>
	)
}
