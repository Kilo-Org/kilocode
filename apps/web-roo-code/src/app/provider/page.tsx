"use client"

import { useEffect, useMemo, useState } from "react"
import { ModelCard } from "./pricing/components/model-card"
import { Model, ModelWithTotalPrice, ModelsResponse, SortOption } from "@/lib/types/models"
import Link from "next/link"
import { ChevronDown, CircleX, Cloud, Loader, LoaderCircle, Puzzle, Search } from "lucide-react"

const API_URL = "https://api.roocode.com/proxy/v1/models?include_paid=true"

const faqs = [
	{
		question: "What are AI model providers?",
		answer: "AI model providers offer various language models with different capabilities and pricing.",
	},
	{
		question: "What is the Roo Code Router?",
		answer: (
			<>
				<p>This is our very own model router, optimized to work seamlessly with Roo Code Cloud.</p>
				<p>You don&apos;t have to use it to use Roo Code, but it&apos;s the easiest way to do it.</p>
			</>
		),
	},
	{
		question: "Do I have to use the Roo Code Router to use the Roo Code products?",
		answer: "Not at all! You can bring your own provider key, no problem. This is just meant to make it easier.",
	},
	{
		question: "How is pricing calculated?",
		answer: "Pricing is based on token usage for input and output, measured per million tokens, like pretty much any other provider out there.",
	},
	{
		question: "How is my data treated?",
		answer: "The Roo Code Router doesn't keep any of your data, the service only aims to make it easier to use Roo Code. Each model vendor has their own privacy policy though, and usually free models use your data for training, so keep that in mind.",
	},
	{
		question: "How much does the Roo Code Cloud service cost?",
		answer: (
			<>
				Our{" "}
				<Link href="/pricing" className="underline hover:no-underline">
					service pricing is here.
				</Link>
			</>
		),
	},
]

function calculateTotalPrice(model: Model): number {
	return parseFloat(model.pricing.input) + parseFloat(model.pricing.output)
}

function enrichModelWithTotalPrice(model: Model): ModelWithTotalPrice {
	return {
		...model,
		totalPrice: calculateTotalPrice(model),
	}
}

export default function ProviderPage() {
	const [models, setModels] = useState<ModelWithTotalPrice[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("alphabetical")

	useEffect(() => {
		async function fetchModels() {
			try {
				setLoading(true)
				setError(null)
				const response = await fetch(API_URL)
				if (!response.ok) {
					throw new Error(`Failed to fetch models: ${response.statusText}`)
				}
				const data: ModelsResponse = await response.json()
				const enrichedModels = data.data.map(enrichModelWithTotalPrice)
				setModels(enrichedModels)
			} catch (err) {
				setError(err instanceof Error ? err.message : "An error occurred while fetching models")
			} finally {
				setLoading(false)
			}
		}

		fetchModels()
	}, [])

	const filteredAndSortedModels = useMemo(() => {
		// Filter out deprecated models
		let filtered = models.filter((model) => !model.deprecated)

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase()
			filtered = filtered.filter((model) => {
				return (
					model.name.toLowerCase().includes(query) ||
					model.owned_by?.toLowerCase().includes(query) ||
					model.description.toLowerCase().includes(query)
				)
			})
		}

		// Sort filtered results
		const sorted = [...filtered]
		switch (sortOption) {
			case "alphabetical":
				sorted.sort((a, b) => a.name.localeCompare(b.name))
				break
			case "price-asc":
				sorted.sort((a, b) => a.totalPrice - b.totalPrice)
				break
			case "price-desc":
				sorted.sort((a, b) => b.totalPrice - a.totalPrice)
				break
			case "context-window-asc":
				sorted.sort((a, b) => a.context_window - b.context_window)
				break
			case "context-window-desc":
				sorted.sort((a, b) => b.context_window - a.context_window)
				break
		}

		return sorted
	}, [models, searchQuery, sortOption])

	// Count non-deprecated models for the display
	const nonDeprecatedCount = useMemo(() => models.filter((model) => !model.deprecated).length, [models])

	return (
		<>
			<section className="relative overflow-hidden py-16">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center">
						<h1 className="text-4xl md:text-5xl font-bold tracking-tight">The Roo Code Router</h1>
						<p className="mx-auto mt-4 max-w-3xl md:text-lg text-muted-foreground">
							The easiest way to use Roo Code (in the{" "}
							<Link href="/cloud" className="underline hover:no-underline">
								<Cloud className="inline size-5 mx-1 -mt-0.5" />
								Cloud
							</Link>{" "}
							or the{" "}
							<Link href="/extension" className="underline hover:no-underline">
								<Puzzle className="inline size-5 mx-1 -mt-0.5" />
								Extension
							</Link>
							) with the best free and paid models – no separate accounts, no messing with API keys.
						</p>
						<p className="mx-auto mt-2 max-w-2xl md:text-lg text-muted-foreground">
							And you can always bring your own key (
							<Link href="#faq" className="underline hover:no-underline">
								FAQ
							</Link>
							).
						</p>
					</div>
				</div>
			</section>

			<section className="py-10 relative border-t border-b">
				<div className="absolute inset-0 bg-gradient-to-br from-violet-500/0 via-violet-500/10 to-violet-500/0 dark:from-blue-500/10 dark:via-cyan-500/10 dark:to-purple-500/10" />
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex-1">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<input
										type="text"
										placeholder="Search models..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="w-full rounded-full border border-input bg-background px-10 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									/>

									<div className="text-sm cursor-default text-muted-foreground absolute bg-background right-0 top-0 m-0.5 px-3 py-2 rounded-full">
										{filteredAndSortedModels.length} of {nonDeprecatedCount} models
									</div>
								</div>
							</div>
							<div className="flex-shrink-0">
								<div className="flex items-center gap-2 relative">
									<select
										id="sort"
										value={sortOption}
										onChange={(e) => setSortOption(e.target.value as SortOption)}
										className="rounded-full cursor-pointer border border-input bg-background hover:bg-muted pl-4 w-full md:w-auto pr-9 py-2.5 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 relative appearance-none">
										<option value="alphabetical">Alphabetical</option>
										<option value="price-asc">Price: Low to High</option>
										<option value="price-desc">Price: High to Low</option>
										<option value="context-window-asc">Context Window: Small to Large</option>
										<option value="context-window-desc">Context Window: Large to Small</option>
									</select>
									<ChevronDown className="size-4 absolute right-3" />
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="container mx-auto px-4 sm:px-6 lg:px-8 ">
					<div className="mx-auto max-w-6xl">
						{loading && (
							<div className="text-center pt-12 space-y-2 mb-4">
								<LoaderCircle className="size-8 text-muted-foreground mx-auto animate-spin" />
								<p className="text-lg">Loading model list...</p>
							</div>
						)}

						{error && (
							<div className="text-center pt-12 space-y-2">
								<CircleX className="size-8 text-muted-foreground mx-auto mb-4" />
								<p className="text-lg">Oops, couldn&apos;t load the model list.</p>
								<p className="text-muted-foreground">Try again in a bit please.</p>
							</div>
						)}

						{!loading && !error && filteredAndSortedModels.length === 0 && (
							<div className="text-center pt-12 space-y-2">
								<Loader className="size-8 text-muted-foreground mx-auto mb-4" />
								<p className="text-lg">No models match your search.</p>
								<p className="text-muted-foreground">
									Keep in mind we don&apos;t have every model under the sun – only the ones we think
									are worth using.
									<br />
									You can always use a third-party provider to access a wider selection.
								</p>
							</div>
						)}

						{!loading && !error && filteredAndSortedModels.length > 0 && (
							<div className="grid gap-4 pt-8 md:grid-cols-2 lg:grid-cols-3">
								{filteredAndSortedModels.map((model) => (
									<ModelCard key={model.id} model={model} />
								))}
							</div>
						)}
					</div>
				</div>
			</section>

			{/* FAQ Section */}
			<section className="bg-background my-16 relative z-50">
				<a id="faq" />
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl text-center">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently Asked Questions</h2>
					</div>
					<div className="mx-auto mt-12 grid max-w-5xl gap-8 md:grid-cols-2">
						{faqs.map((faq, index) => (
							<div key={index} className="rounded-2xl border border-border bg-card p-6">
								<h3 className="font-semibold">{faq.question}</h3>
								<p className="mt-2 text-sm text-muted-foreground">{faq.answer}</p>
							</div>
						))}
					</div>
				</div>
			</section>
		</>
	)
}
