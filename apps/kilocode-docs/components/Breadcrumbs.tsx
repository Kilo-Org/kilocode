import React from "react"
import { useRouter } from "next/router"
import Link from "next/link"
import { Nav } from "../lib/nav"
import { NavSection, NavLink } from "../lib/types"

// Map section keys to their navigation data and display labels
const sectionConfig: Record<string, { nav: NavSection[]; label: string }> = {
	"getting-started": { nav: Nav.GettingStartedNav, label: "Get Started" },
	"code-with-ai": { nav: Nav.CodeWithAiNav, label: "Code with AI" },
	customize: { nav: Nav.CustomizeNav, label: "Customize" },
	collaborate: { nav: Nav.CollaborateNav, label: "Collaborate" },
	automate: { nav: Nav.AutomateNav, label: "Automate" },
	"deploy-secure": { nav: Nav.DeploySecureNav, label: "Deploy & Secure" },
	contributing: { nav: Nav.ContributingNav, label: "Contributing" },
	"ai-providers": { nav: Nav.AiProvidersNav, label: "AI Providers" },
	tools: { nav: Nav.ToolsNav, label: "Tools" },
}

interface BreadcrumbItem {
	label: string
	href: string
}

/**
 * Find a page in the navigation structure and return its breadcrumb path
 */
function findPageInNav(
	pathname: string,
	navSections: NavSection[],
	sectionLabel: string,
	sectionHref: string,
): BreadcrumbItem[] | null {
	for (const section of navSections) {
		for (const link of section.links) {
			// Check if this is the current page
			if (link.href === pathname) {
				return [
					{ label: sectionLabel, href: sectionHref },
					{ label: link.children, href: link.href },
				]
			}

			// Check subLinks if they exist
			if (link.subLinks) {
				for (const subLink of link.subLinks) {
					if (subLink.href === pathname) {
						return [
							{ label: sectionLabel, href: sectionHref },
							{ label: link.children, href: link.href },
							{ label: subLink.children, href: subLink.href },
						]
					}
				}
			}
		}
	}
	return null
}

/**
 * Get the section key from a pathname
 */
function getSectionKey(pathname: string): string | null {
	// Handle special cases like /ai-providers which maps to ai-providers section
	const segments = pathname.split("/").filter(Boolean)
	if (segments.length === 0) return null

	// Check for exact section matches first
	const firstSegment = segments[0]
	if (sectionConfig[firstSegment]) {
		return firstSegment
	}

	// Handle nested paths like /automate/tools
	if (segments.length >= 2) {
		const twoSegmentKey = `${segments[0]}/${segments[1]}`
		if (sectionConfig[twoSegmentKey]) {
			return twoSegmentKey
		}
	}

	return null
}

/**
 * Build breadcrumb items from the current pathname
 */
function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
	const breadcrumbs: BreadcrumbItem[] = [{ label: "Home", href: "/" }]

	const sectionKey = getSectionKey(pathname)
	if (!sectionKey) {
		return breadcrumbs
	}

	const config = sectionConfig[sectionKey]
	if (!config) {
		return breadcrumbs
	}

	// Determine the section's root href
	const sectionHref = `/${sectionKey.split("/")[0]}`

	// Find the page in the navigation structure
	const pagePath = findPageInNav(pathname, config.nav, config.label, sectionHref)

	if (pagePath) {
		// Filter out duplicates (when section overview is the current page)
		const uniquePath = pagePath.filter((item, index) => {
			if (index === 0) return true
			return item.href !== pagePath[index - 1].href
		})
		breadcrumbs.push(...uniquePath)
	} else {
		// Fallback: just add the section
		breadcrumbs.push({ label: config.label, href: sectionHref })
	}

	return breadcrumbs
}

const ChevronRight = () => (
	<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
		<path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
)

export function Breadcrumbs() {
	const router = useRouter()
	const breadcrumbs = buildBreadcrumbs(router.pathname)

	// Don't render if we only have "Home" (we're on the homepage or an unknown page)
	if (breadcrumbs.length <= 1) {
		return null
	}

	return (
		<nav aria-label="Breadcrumb" className="breadcrumbs">
			<ol className="breadcrumb-list">
				{breadcrumbs.map((item, index) => {
					const isLast = index === breadcrumbs.length - 1

					return (
						<li key={item.href} className="breadcrumb-item">
							{index > 0 && (
								<span className="breadcrumb-separator">
									<ChevronRight />
								</span>
							)}
							{isLast ? (
								<span className="breadcrumb-current" aria-current="page">
									{item.label}
								</span>
							) : (
								<Link href={item.href} className="breadcrumb-link">
									{item.label}
								</Link>
							)}
						</li>
					)
				})}
			</ol>

			<style jsx>{`
				.breadcrumbs {
					margin-bottom: 1rem;
				}

				.breadcrumb-list {
					display: flex;
					flex-wrap: wrap;
					align-items: center;
					gap: 0.25rem;
					list-style: none;
					margin: 0;
					padding: 0;
					font-size: 0.875rem;
				}

				.breadcrumb-item {
					display: flex;
					align-items: center;
					gap: 0.25rem;
				}

				.breadcrumb-separator {
					color: var(--text-secondary);
					opacity: 0.6;
					display: flex;
					align-items: center;
				}

				.breadcrumb-item :global(.breadcrumb-link) {
					color: var(--text-secondary);
					text-decoration: none;
					transition: color 0.15s ease;
				}

				.breadcrumb-item :global(.breadcrumb-link:hover) {
					color: var(--accent-color);
				}

				.breadcrumb-current {
					color: var(--text-color);
					font-weight: 500;
				}

				@media (max-width: 768px) {
					.breadcrumb-list {
						font-size: 0.8125rem;
					}
				}
			`}</style>
		</nav>
	)
}
