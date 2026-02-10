import React from "react"
import Link from "next/link"
import { useRouter } from "next/router"
import { Nav } from "../lib/nav"
import { NavSection } from "../lib/types"

// Section key to nav mapping (mirrors SideNav)
const sectionNavItems: Record<string, NavSection[]> = {
	"getting-started": Nav.GettingStartedNav,
	"code-with-ai": Nav.CodeWithAiNav,
	customize: Nav.CustomizeNav,
	collaborate: Nav.CollaborateNav,
	"automate/tools": Nav.ToolsNav,
	automate: Nav.AutomateNav,
	"deploy-secure": Nav.DeploySecureNav,
	contributing: Nav.ContributingNav,
	"ai-providers": Nav.AiProvidersNav,
}

// Section key to display label
const sectionLabels: Record<string, { label: string; href: string }> = {
	"getting-started": { label: "Get Started", href: "/getting-started" },
	"code-with-ai": { label: "Code with AI", href: "/code-with-ai" },
	customize: { label: "Customize", href: "/customize" },
	collaborate: { label: "Collaborate", href: "/collaborate" },
	automate: { label: "Automate", href: "/automate" },
	"deploy-secure": { label: "Deploy & Secure", href: "/deploy-secure" },
	contributing: { label: "Contributing", href: "/contributing" },
	"ai-providers": { label: "AI Providers", href: "/ai-providers" },
}

function getCurrentSectionKey(pathname: string): string | null {
	const keys = Object.keys(sectionNavItems)
	// Sort by length descending so more specific keys match first (e.g., "automate/tools" before "automate")
	keys.sort((a, b) => b.length - a.length)
	for (const key of keys) {
		if (pathname.startsWith(`/${key}`)) {
			return key
		}
	}
	return null
}

function findPageTitle(pathname: string, navSections: NavSection[]): string | null {
	for (const section of navSections) {
		for (const link of section.links) {
			if (link.href === pathname) {
				return link.children
			}
			if (link.subLinks) {
				for (const subLink of link.subLinks) {
					if (subLink.href === pathname) {
						return subLink.children
					}
				}
			}
		}
	}
	return null
}

interface BreadcrumbItem {
	label: string
	href?: string
}

export function Breadcrumbs() {
	const router = useRouter()
	const pathname = router.pathname

	const sectionKey = getCurrentSectionKey(pathname)
	if (!sectionKey) return null

	// Get the base section key for display (e.g., "automate" for "automate/tools")
	const baseSectionKey = sectionKey.includes("/") ? sectionKey.split("/")[0] : sectionKey
	const section = sectionLabels[baseSectionKey]
	if (!section) return null

	const navSections = sectionNavItems[sectionKey]
	const pageTitle = navSections ? findPageTitle(pathname, navSections) : null

	const items: BreadcrumbItem[] = [{ label: "Home", href: "/" }]

	// If we're on the section index page, just show section name as current (no link)
	if (pathname === section.href) {
		items.push({ label: section.label })
	} else {
		items.push({ label: section.label, href: section.href })
		if (pageTitle) {
			items.push({ label: pageTitle })
		}
	}

	return (
		<nav aria-label="Breadcrumb" className="breadcrumbs">
			<ol>
				{items.map((item, index) => {
					const isLast = index === items.length - 1
					return (
						<li key={`${item.label}-${index}`}>
							{item.href && !isLast ? (
								<Link href={item.href}>{item.label}</Link>
							) : (
								<span className={isLast ? "current" : ""}>{item.label}</span>
							)}
							{!isLast && <span className="separator">/</span>}
						</li>
					)
				})}
			</ol>
			<style jsx>{`
				.breadcrumbs {
					margin-bottom: 0.5rem;
				}
				.breadcrumbs ol {
					display: flex;
					flex-wrap: wrap;
					align-items: center;
					list-style: none;
					margin: 0;
					padding: 0;
					gap: 0;
				}
				.breadcrumbs li {
					display: flex;
					align-items: center;
					font-size: 0.875rem;
					line-height: 1.25rem;
					margin: 0;
				}
				.breadcrumbs li :global(a) {
					color: var(--text-link);
					text-decoration: none;
					transition: color 0.15s ease;
				}
				.breadcrumbs li :global(a:hover) {
					color: var(--text-color);
				}
				.breadcrumbs .current {
					color: var(--text-secondary);
				}
				.separator {
					margin: 0 0.5rem;
					color: var(--text-secondary);
					opacity: 0.5;
					user-select: none;
				}
			`}</style>
		</nav>
	)
}
