import { useState, useEffect } from "react"
import Head from "next/head"
import { useRouter } from "next/router"
import posthog from "posthog-js"

import { CopyPageButton, SideNav, TableOfContents, TopNav } from "../components"

import "prismjs"
import "prismjs/components/prism-bash.min"
import "prismjs/components/prism-javascript.min"
import "prismjs/components/prism-typescript.min"
import "prismjs/components/prism-python.min"
import "prismjs/components/prism-json.min"
import "prismjs/components/prism-yaml.min"
import "prismjs/components/prism-go.min"
import "prismjs/components/prism-ruby.min"
import "prismjs/components/prism-markdown.min"
import "prismjs/components/prism-powershell.min"
import "prismjs/themes/prism.css"

import "@docsearch/css"

import "../public/globals.css"

import type { AppProps } from "next/app"
import type { MarkdocNextJsPageProps } from "@markdoc/next.js"

const TITLE = "Kilo Code Documentation"
const DESCRIPTION = "Build, ship, and iterate faster with the most popular open source coding agent."

function collectHeadings(node, sections = []) {
	if (node) {
		// Skip headings inside tabs - they're not always visible
		if (node.name === "Tabs") {
			return sections
		}

		if (node.name === "Heading") {
			const title = node.children[0]

			if (typeof title === "string") {
				sections.push({
					...node.attributes,
					title,
				})
			}
		}

		if (node.children) {
			for (const child of node.children) {
				collectHeadings(child, sections)
			}
		}
	}

	return sections
}

export type MyAppProps = MarkdocNextJsPageProps

export default function MyApp({ Component, pageProps }: AppProps<MyAppProps>) {
	const { markdoc } = pageProps
	const router = useRouter()
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

	// Check if we're on the homepage or 404 page (full-page layouts)
	const isHomepage = router.pathname === "/"
	const is404 = router.pathname === "/404"
	const isFullPageLayout = isHomepage || is404

	// Close mobile menu on route change and track pageviews
	useEffect(() => {
		const handleRouteChange = () => {
			setIsMobileMenuOpen(false)
		}

		const handleRouteComplete = () => {
			posthog.capture("$pageview")
		}

		router.events.on("routeChangeStart", handleRouteChange)
		router.events.on("routeChangeComplete", handleRouteComplete)
		return () => {
			router.events.off("routeChangeStart", handleRouteChange)
			router.events.off("routeChangeComplete", handleRouteComplete)
		}
	}, [router])

	// Prevent body scroll when mobile menu is open
	useEffect(() => {
		if (isMobileMenuOpen) {
			document.body.style.overflow = "hidden"
		} else {
			document.body.style.overflow = ""
		}
		return () => {
			document.body.style.overflow = ""
		}
	}, [isMobileMenuOpen])

	const handleMobileMenuToggle = () => {
		setIsMobileMenuOpen(!isMobileMenuOpen)
	}

	const handleMobileMenuClose = () => {
		setIsMobileMenuOpen(false)
	}

	let title = TITLE
	let description = DESCRIPTION
	if (markdoc) {
		if (markdoc.frontmatter.title) {
			title = markdoc.frontmatter.title
		}
		if (markdoc.frontmatter.description) {
			description = markdoc.frontmatter.description
		}
	}

	const toc = pageProps.markdoc?.content ? collectHeadings(pageProps.markdoc.content) : []

	return (
		<>
			<Head>
				<title>{title}</title>
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<meta name="referrer" content="strict-origin" />
				<meta name="title" content={title} />
				<meta name="description" content={description} />
				<link rel="shortcut icon" href="https://kilo.ai/favicon.ico" />
				<link rel="icon" href="https://kilo.ai/favicon.ico" sizes="48x48" type="image/x-icon" />
				<link rel="icon" href="https://kilo.ai/favicon.svg" type="image/svg+xml" />
				<link
					rel="apple-touch-icon"
					href="https://kilo.ai/apple-touch-icon.png"
					sizes="180x180"
					type="image/png"
				/>
				<link rel="manifest" href="https://kilo.ai/site.webmanifest" />
				<link rel="icon" href="https://kilo.ai/android-chrome-192x192.png" type="image/png" sizes="192x192" />
				<link rel="icon" href="https://kilo.ai/android-chrome-512x512.png" type="image/png" sizes="512x512" />
				<meta name="theme-color" content="#617A91" />
				{/* Preconnect to Algolia for better performance */}
				<link rel="preconnect" href="https://PMZUYBQDAK-dsn.algolia.net" crossOrigin="anonymous" />
				{/* Script to prevent flash of wrong theme */}
				<script
					dangerouslySetInnerHTML={{
						__html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
					}}
				/>
			</Head>
			<TopNav
				onMobileMenuToggle={handleMobileMenuToggle}
				isMobileMenuOpen={isMobileMenuOpen}
				showMobileMenuButton={!isFullPageLayout}
			/>
			{isFullPageLayout ? (
				<main className="fullpage-main">
					<Component {...pageProps} />
				</main>
			) : (
				<div className="page">
					<SideNav isMobileOpen={isMobileMenuOpen} onMobileClose={handleMobileMenuClose} />
					<main className="main-content">
						<div className="content-wrapper">
							<div className="article-content flex column mt-5">
								<Component {...pageProps} />
							</div>
							<div className="right-sidebar">
								{markdoc && <CopyPageButton />}
								<TableOfContents toc={toc} />
							</div>
						</div>
					</main>
				</div>
			)}
			<style jsx>
				{`
					.fullpage-main {
						position: fixed;
						top: var(--top-nav-height);
						left: 0;
						right: 0;
						bottom: 0;
						overflow: auto;
						background: var(--bg-color);
						transition: background-color 0.2s ease;
					}
					.page {
						position: fixed;
						top: var(--top-nav-height);
						left: 0;
						right: 0;
						bottom: 0;
						display: flex;
						overflow: hidden;
					}
					.main-content {
						overflow-y: auto;
						overflow-x: hidden;
						height: calc(100vh - var(--top-nav-height));
						flex: 1 1 0;
						min-width: 0;
						background: var(--bg-color);
						transition: background-color 0.2s ease;
					}
					.content-wrapper {
						display: flex;
						position: relative;
						max-width: 1200px;
						margin: 0 auto;
						width: 100%;
						padding-right: 1rem;
						box-sizing: border-box;
					}
					.article-content {
						flex: 1 1 0;
						font-size: 16px;
						padding: 0 2rem 2rem;
						min-width: 0;
						max-width: 100%;
						overflow: hidden;
						overflow-wrap: break-word;
						word-wrap: break-word;
					}
					.article-content > * {
						max-width: 100%;
					}
					.article-content pre {
						max-width: 100%;
						overflow-x: auto;
					}
					.right-sidebar {
						display: flex;
						flex-direction: column;
						align-items: flex-start;
						gap: 1rem;
						padding-top: 2.5rem;
						flex: 0 0 240px;
						position: sticky;
						top: 0;
						height: fit-content;
					}

					/* Mobile responsive styles */
					@media (max-width: 1024px) {
						.right-sidebar {
							display: none;
						}
						.content-wrapper {
							padding-right: 0;
						}
					}
					@media (max-width: 768px) {
						.article-content {
							padding: 0 1rem 1.5rem;
						}
					}
				`}
			</style>
		</>
	)
}
