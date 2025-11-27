import type { Metadata } from "next"

import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"
import { AgentLandingContent } from "@/app/shared/AgentLandingContent"
import { getContentVariant } from "@/app/shared/getContentVariant"
import { content as contentA } from "./content"
import { content as contentB } from "./content-b"

const TITLE = "PR Reviewer"
const DESCRIPTION =
	"Get comprehensive AI-powered PR reviews that save you time, not tokens. Bring your own API key and leverage advanced reasoning, repository-aware analysis, and actionable feedback to keep your PR queue moving."
const OG_DESCRIPTION = "AI-powered PR reviews that save you time, not tokens"
const PATH = "/reviewer"

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
	keywords: [
		...SEO.keywords,
		"PR reviewer",
		"code review",
		"pull request review",
		"AI code review",
		"GitHub PR review",
		"automated code review",
		"repository-aware review",
		"bring your own key",
		"BYOK AI",
		"code quality",
		"development workflow",
		"cloud agents",
		"AI development team",
	],
}

export default async function AgentReviewerPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
	const params = await searchParams
	const content = getContentVariant(params, {
		A: contentA,
		B: contentB,
	})

	return <AgentLandingContent content={content} />
}
