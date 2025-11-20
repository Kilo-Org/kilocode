import type { Metadata } from "next"

import { SEO } from "@/lib/seo"
import { ogImageUrl } from "@/lib/og"
import { PrFixerContent } from "./PrFixerContent"

const TITLE = "PR Fixer"
const DESCRIPTION =
	"Automatically apply high-quality fixes to your pull requests with comment-aware, GitHub-native workflows."
const OG_DESCRIPTION = "Transform review feedback into clean commits"
const PATH = "/pr-fixer"

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
		"PR fixer",
		"pull request fixes",
		"code fixes",
		"GitHub PR",
		"automated code fixes",
		"comment-aware agent",
		"repository-aware fixes",
		"bring your own key",
		"BYOK AI",
		"code quality",
		"cloud agents",
		"AI development team",
	],
}

export default function AgentPrFixerPage() {
	return <PrFixerContent />
}
