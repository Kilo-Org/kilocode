import posthog from "posthog-js"

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
	api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
	person_profiles: "identified_only",
	capture_pageview: true,
	capture_pageleave: true,
})
