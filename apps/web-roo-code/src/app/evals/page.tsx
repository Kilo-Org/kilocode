import type { Metadata } from "next"

import { getEvalRuns } from "@/actions/evals"
import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"

import { Evals } from "./evals"

export const revalidate = 300
export const dynamic = "force-dynamic"

const TITLE = "Evals"
const DESCRIPTION = "Explore quantitative evals of LLM coding skills across tasks and providers."
const OG_DESCRIPTION = "Quantitative evals of LLM coding skills"
const PATH = "/evals"

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
	keywords: [...SEO.keywords, "benchmarks", "LLM evals", "coding evaluations", "model comparison"],
}

export default async function Page() {
	const runs = await getEvalRuns()

	return <Evals runs={runs} />
}
