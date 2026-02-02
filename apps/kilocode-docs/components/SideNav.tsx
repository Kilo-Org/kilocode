import React, { useState, useEffect } from "react"
import { useRouter } from "next/router"
import Link from "next/link"
import { SectionNav } from "../lib/types"
import { Nav } from "../lib/nav"

// Define navigation items for each major section
const sectionNavItems: SectionNav = {
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

// Main nav items with their section keys
const mainNavItems = [
	{ label: "Home", href: "/", sectionKey: null },
	{ label: "Get Started", href: "/getting-started", sectionKey: "getting-started" },
	{ label: "Code with AI", href: "/code-with-ai", sectionKey: "code-with-ai" },
	{ label: "Customize", href: "/customize", sectionKey: "customize" },
	{ label: "Collaborate", href: "/collaborate", sectionKey: "collaborate" },
	{ label: "Automate", href: "/automate", sectionKey: "automate" },
	{ label: "Deploy & Secure", href: "/deploy-secure", sectionKey: "deploy-secure" },
	{ label: "Contributing", href: "/contributing", sectionKey: "contributing" },
]

function getCurrentSection(pathname: string): string | null {
	const sectionKeys = Object.keys(sectionNavItems)
	for (const section of sectionKeys) {
		if (pathname.startsWith(`/${section}`)) {
			return section
		}
	}
	return null
}

function getSectionLabel(sectionKey: string): string {
	const item = mainNavItems.find((nav) => nav.sectionKey === sectionKey)
	return item?.label || sectionKey
}

// Chevron icons as components
const ChevronRight = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
		<path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
)

const ChevronLeft = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
		<path
			d="M10 4L6 8L10 12"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

interface SideNavProps {
	isMobileOpen?: boolean
	onMobileClose?: () => void
}

export function SideNav({ isMobileOpen = false, onMobileClose }: SideNavProps) {
	const router = useRouter()
	const currentSection = getCurrentSection(router.pathname)

	// Track which view is shown: 'main' or 'section'
	const [activeView, setActiveView] = useState<"main" | "section">(currentSection ? "section" : "main")

	// Track which section is being viewed (for animation purposes)
	const [viewedSection, setViewedSection] = useState<string | null>(currentSection)

	// Update view when route changes
	useEffect(() => {
		const newSection = getCurrentSection(router.pathname)
		if (newSection) {
			setViewedSection(newSection)
			setActiveView("section")
		} else {
			setActiveView("main")
		}
	}, [router.pathname])

	const handleLinkClick = () => {
		if (onMobileClose) {
			onMobileClose()
		}
	}

	const handleSectionClick = (sectionKey: string | null) => {
		if (sectionKey) {
			setViewedSection(sectionKey)
			setActiveView("section")
		}
	}

	const handleBackClick = () => {
		setActiveView("main")
	}

	const sectionItems = viewedSection ? sectionNavItems[viewedSection] || [] : []
	const sectionLabel = viewedSection ? getSectionLabel(viewedSection) : ""

	// Main navigation panel
	const mainNavPanel = (
		<div className="nav-panel main-panel">
			{mainNavItems.map((item) => {
				const isActive = item.sectionKey ? router.pathname.startsWith(item.href) : router.pathname === item.href
				const hasSubItems = item.sectionKey && sectionNavItems[item.sectionKey]

				if (hasSubItems) {
					return (
						<button
							key={item.href}
							onClick={() => handleSectionClick(item.sectionKey)}
							className={`nav-item nav-item-button ${isActive ? "active" : ""}`}>
							<span>{item.label}</span>
							<span className="nav-arrow">
								<ChevronRight />
							</span>
						</button>
					)
				}

				return (
					<Link
						key={item.href}
						href={item.href}
						onClick={handleLinkClick}
						className={`nav-item ${isActive ? "active" : ""}`}>
						<span>{item.label}</span>
					</Link>
				)
			})}

			<style jsx>{`
				.nav-panel {
					width: 50%;
					height: 100%;
					overflow-y: auto;
					padding: 1rem;
					flex-shrink: 0;
				}

				.nav-item {
					display: flex;
					align-items: center;
					justify-content: space-between;
					width: 100%;
					padding: 0.75rem 1rem;
					font-size: 0.9375rem;
					font-weight: 500;
					text-decoration: none;
					color: var(--text-color);
					border-radius: 0.5rem;
					transition:
						background-color 0.15s ease,
						color 0.15s ease;
					cursor: pointer;
				}

				.nav-item-button {
					background: none;
					border: none;
					text-align: left;
					font-family: inherit;
				}

				.nav-item:hover {
					background-color: var(--bg-secondary);
				}

				.nav-item.active {
					color: var(--accent-color);
				}

				.nav-arrow {
					color: var(--text-secondary);
					opacity: 0.6;
					transition: opacity 0.15s ease;
					display: flex;
					align-items: center;
				}

				.nav-item:hover .nav-arrow {
					opacity: 1;
				}
			`}</style>
		</div>
	)

	// Section navigation panel
	const sectionNavPanel = (
		<div className="nav-panel section-panel">
			<button className="back-button mobile-only" onClick={handleBackClick}>
				<span className="back-arrow">
					<ChevronLeft />
				</span>
				<span>{sectionLabel}</span>
			</button>

			<div className="section-content">
				{sectionItems.map((group) => (
					<div key={group.title} className="nav-group">
						<span className="nav-group-title">{group.title}</span>
						<ul className="nav-links">
							{group.links.map((link) => {
								const active = router.pathname === link.href
								return (
									<li key={link.href} className={active ? "active" : ""}>
										<Link href={link.href} onClick={handleLinkClick}>
											{link.children}
										</Link>
									</li>
								)
							})}
						</ul>
					</div>
				))}
			</div>

			<style jsx>{`
				.nav-panel {
					width: 50%;
					height: 100%;
					overflow-y: auto;
					padding: 1rem;
					flex-shrink: 0;
				}

				.back-button {
					display: none;
					align-items: center;
					gap: 0.5rem;
					width: 100%;
					padding: 0.75rem 1rem;
					font-size: 0.9375rem;
					font-weight: 600;
					color: var(--text-color);
					background: none;
					border: none;
					border-radius: 0.5rem;
					cursor: pointer;
					transition: background-color 0.15s ease;
					font-family: inherit;
					margin-bottom: 0.5rem;
				}

				@media (max-width: 768px) {
					.back-button.mobile-only {
						display: flex;
					}
				}

				.back-button:hover {
					background-color: var(--bg-secondary);
				}

				.back-arrow {
					color: var(--text-secondary);
					display: flex;
					align-items: center;
				}

				.section-content {
					padding-left: 0.25rem;
				}

				.nav-group {
					margin-bottom: 1.25rem;
				}

				.nav-group-title {
					display: block;
					font-size: 0.75rem;
					font-weight: 600;
					text-transform: uppercase;
					letter-spacing: 0.05em;
					padding: 0.5rem 0.75rem;
					color: var(--text-secondary);
				}

				.nav-links {
					padding: 0;
					margin: 0;
				}

				.nav-links li {
					list-style: none;
					margin: 0;
				}

				.nav-links li :global(a) {
					display: block;
					padding: 0.375rem 0.75rem;
					font-size: 0.875rem;
					text-decoration: none;
					color: var(--text-secondary);
					border-radius: 0.375rem;
					transition:
						background-color 0.15s ease,
						color 0.15s ease;
				}

				.nav-links li :global(a:hover) {
					background-color: var(--bg-secondary);
					color: var(--text-color);
				}

				.nav-links li.active :global(a) {
					background-color: var(--bg-secondary);
					color: var(--accent-color);
					font-weight: 500;
				}
			`}</style>
		</div>
	)

	const navContent = (
		<div className={`sliding-nav ${activeView === "section" ? "show-section" : "show-main"}`}>
			{mainNavPanel}
			{sectionNavPanel}

			<style jsx>{`
				.sliding-nav {
					display: flex;
					width: 200%;
					height: 100%;
					transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
				}

				.sliding-nav.show-main {
					transform: translateX(0);
				}

				.sliding-nav.show-section {
					transform: translateX(-50%);
				}

				/* On desktop, always show section panel when in a section */
				@media (min-width: 769px) {
					.sliding-nav {
						transition: none;
					}

					.sliding-nav.show-section {
						transform: translateX(-50%);
					}
				}
			`}</style>
		</div>
	)

	return (
		<>
			{/* Desktop sidebar */}
			<nav className="sidenav sidenav-desktop">{navContent}</nav>

			{/* Mobile overlay */}
			<div className={`sidenav-mobile-overlay ${isMobileOpen ? "open" : ""}`} onClick={onMobileClose} />

			{/* Mobile sidebar drawer */}
			<nav className={`sidenav sidenav-mobile ${isMobileOpen ? "open" : ""}`}>{navContent}</nav>

			<style jsx>{`
				.sidenav {
					background: var(--bg-color);
					overflow: hidden;
					transition:
						background-color 0.2s ease,
						border-color 0.2s ease;
				}

				/* Desktop styles */
				.sidenav-desktop {
					position: sticky;
					top: var(--top-nav-height);
					height: calc(100vh - var(--top-nav-height));
					flex: 0 0 260px;
					border-right: 1px solid var(--border-color);
				}

				/* Mobile overlay */
				.sidenav-mobile-overlay {
					display: none;
				}

				/* Mobile drawer */
				.sidenav-mobile {
					display: none;
				}

				/* Mobile styles */
				@media (max-width: 768px) {
					.sidenav-desktop {
						display: none;
					}

					.sidenav-mobile-overlay {
						display: block;
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						background: rgba(0, 0, 0, 0.5);
						z-index: 40;
						opacity: 0;
						visibility: hidden;
						transition:
							opacity 0.3s ease,
							visibility 0.3s ease;
					}

					.sidenav-mobile-overlay.open {
						opacity: 1;
						visibility: visible;
					}

					.sidenav-mobile {
						display: block;
						position: fixed;
						top: var(--top-nav-height);
						left: 0;
						width: 300px;
						height: calc(100vh - var(--top-nav-height));
						z-index: 50;
						transform: translateX(-100%);
						transition: transform 0.3s ease;
						border-right: 1px solid var(--border-color);
					}

					.sidenav-mobile.open {
						transform: translateX(0);
					}
				}
			`}</style>

			{/* Global styles for elements that styled-jsx can't reach */}
			<style jsx global>{`
				.nav-item {
					display: flex;
					align-items: center;
					justify-content: space-between;
					width: 100%;
					padding: 0.75rem 1rem;
					font-size: 0.9375rem;
					font-weight: 500;
					text-decoration: none;
					color: var(--text-color);
					border-radius: 0.5rem;
					transition:
						background-color 0.15s ease,
						color 0.15s ease;
					cursor: pointer;
				}

				.nav-item-button {
					background: none;
					border: none;
					text-align: left;
					font-family: inherit;
				}

				.nav-item:hover {
					background-color: var(--bg-secondary);
				}

				.nav-item.active {
					color: var(--accent-color);
				}
			`}</style>
		</>
	)
}
