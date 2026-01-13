/* eslint-disable react/jsx-no-target-blank */

import { getVSCodeDownloads } from "@/lib/stats"

import { Button } from "@/components/ui"
import {
	AnimatedBackground,
	CodeExample,
	CompanyLogos,
	FAQSection,
	Features,
	InstallSection,
	Testimonials,
} from "@/components/homepage"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { ArrowRight } from "lucide-react"
import { StructuredData } from "@/components/structured-data"

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

export default async function ExtensionPage() {
	const downloads = await getVSCodeDownloads()

	return (
		<>
			<StructuredData />
			<section className="relative flex h-[calc(125vh-theme(spacing.12))] items-center overflow-hidden md:h-[calc(80svh-theme(spacing.12))]">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col justify-center space-y-4 sm:space-y-8">
							<div>
								<h1 className="text-4xl font-bold tracking-tight mt-8 text-center md:text-left md:text-4xl lg:text-5xl lg:mt-0">
									The Open Source AI Coding Assistant for serious work.
								</h1>
								<p className="mt-4 max-w-lg text-lg text-muted-foreground text-center md:text-left sm:mt-6">
									Specialized modes stay on task and ship great code.
									<br />
									Fully model-agnostic so you can use the best (or most cost-effective) model for each
									task.
								</p>
								<p className="max-w-lg text-lg text-muted-foreground text-center md:text-left sm:mt-6">
									Stop chasing this week&apos;s hot new model or CLI tool and go deep with Roo Code.
								</p>
							</div>
							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0">
								<Button
									size="lg"
									className="w-full hover:bg-gray-200 dark:bg-white dark:text-black sm:w-auto">
									<a
										href={EXTERNAL_LINKS.MARKETPLACE}
										target="_blank"
										className="flex w-full items-center justify-center">
										Install VS Code Extension
										<ArrowRight className="ml-2" />
									</a>
								</Button>
							</div>
							<div className="md:max-h-[70px] md:overflow-clip text-center md:text-left pt-6 md:pt-0">
								<CompanyLogos />
							</div>
						</div>
						<div className="relative flex items-center mx-auto h-full mt-8 lg:mt-0">
							<div className="flex items-center justify-center">
								<CodeExample />
							</div>
						</div>
					</div>
				</div>
			</section>
			<div id="product">
				<Features />
			</div>
			<div id="testimonials">
				<Testimonials />
			</div>
			<div id="faq">
				<FAQSection />
			</div>
			<InstallSection downloads={downloads} />
		</>
	)
}
