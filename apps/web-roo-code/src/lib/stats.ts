export async function getGitHubStars() {
	try {
		const res = await fetch("https://api.github.com/repos/RooCodeInc/Roo-Code")
		const data = await res.json()

		if (typeof data.stargazers_count !== "number") {
			console.error("GitHub API: Invalid stargazers count. Possible that you got rate-limited?")
			return null
		}

		return formatNumber(data.stargazers_count)
	} catch (error) {
		console.error("Error fetching GitHub stars:", error)
		return null
	}
}

export async function getVSCodeReviews() {
	const res = await fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json;api-version=7.1-preview.1",
		},
		body: JSON.stringify({
			filters: [
				{
					criteria: [
						{
							filterType: 7,
							value: "RooVeterinaryInc.roo-cline",
						},
					],
				},
			],
			flags: 914,
		}),
	})

	try {
		const data = await res.json()
		const reviews = data?.results?.[0]?.extensions?.[0]?.reviews

		if (!reviews) {
			console.error("VSCode API: Missing reviews in response")
			return []
		}

		/* eslint-disable  @typescript-eslint/no-explicit-any */
		return reviews.map((review: any) => ({
			name: review.reviewer?.displayName || "Anonymous",
			rating: review.rating,
			content: review.text,
			date: new Date(review.date).toLocaleDateString(),
		}))
	} catch (error) {
		console.error("Error fetching VSCode reviews:", error)
		return []
	}
}

export async function getVSCodeDownloads() {
	const res = await fetch("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json;api-version=7.1-preview.1",
		},
		body: JSON.stringify({
			filters: [
				{
					criteria: [
						{
							filterType: 7,
							value: "RooVeterinaryInc.roo-cline",
						},
					],
				},
			],
			flags: 914,
		}),
	})
	try {
		const data = await res.json()
		const statistics = data?.results?.[0]?.extensions?.[0]?.statistics

		if (!statistics) {
			console.error("VSCode API: Missing statistics in response")
			return null
		}

		/* eslint-disable  @typescript-eslint/no-explicit-any */
		const installStat = statistics.find((stat: any) => stat.statisticName === "install")
		if (!installStat) {
			console.error("VSCode API: Install count not found")
			return null
		}

		return formatNumber(installStat.value)
	} catch (error) {
		console.error("Error fetching VSCode downloads:", error)
		return null
	}
}

function formatNumber(num: number): string {
	// if number is 1 million or more, format as millions
	if (num >= 1000000) {
		const truncated = Math.floor((num / 1000000) * 100) / 100
		return truncated.toFixed(2) + "M"
	}

	// otherwise, format as thousands
	const truncated = Math.floor((num / 1000) * 10) / 10
	return truncated.toFixed(1) + "k"

	// examples:
	// console.log(formatNumber(1033400)) -> "1.03M"
	// console.log(formatNumber(2500000)) -> "2.50M"
	// console.log(formatNumber(337231)) -> "337.2k"
	// console.log(formatNumber(23233)) -> "23.2k"
	// console.log(formatNumber(2322)) -> "2.3k"
	// console.log(formatNumber(212)) -> "0.2k"
}
