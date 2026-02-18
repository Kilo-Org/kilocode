import React, { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/router"
import docsearch from "@docsearch/js"
import { ThemeToggle } from "./ThemeToggle"

interface NavItem {
	label: string
	href: string
}

interface DropdownItem {
	label: string
	href: string
	description?: string
}

interface DropdownMenuProps {
	label: string
	items: DropdownItem[]
	isOpen: boolean
	onToggle: () => void
	onClose: () => void
}

const mainNavItems: NavItem[] = [
	{ label: "Get Started", href: "/getting-started" },
	{ label: "Code with AI", href: "/code-with-ai" },
	{ label: "Customize", href: "/customize" },
	{ label: "Collaborate", href: "/collaborate" },
	{ label: "Automate", href: "/automate" },
	{ label: "Deploy & Secure", href: "/deploy-secure" },
	{ label: "Kilo Gateway", href: "/gateway" },
	{ label: "Contributing", href: "/contributing" },
]

const contributingItems: DropdownItem[] = [
	{ label: "Contributing Guide", href: "/contributing", description: "How to contribute to Kilo Code" },
	{
		label: "Code of Conduct",
		href: "https://github.com/Kilo-Org/kilocode?tab=coc-ov-file",
		description: "Our community guidelines",
	},
	{ label: "GitHub Repository", href: "https://github.com/Kilo-Org/", description: "View source and issues" },
	{ label: "Discord Community", href: "https://kilo.ai/discord", description: "Join our community" },
]

const helpItems: DropdownItem[] = [
	{ label: "Documentation", href: "/", description: "Browse all documentation" },
	{ label: "FAQ", href: "/getting-started/faq", description: "Frequently asked questions" },
	{ label: "Community Projects", href: "/community", description: "Explore community resources" },
	{ label: "Support", href: "https://kilo.ai/support", description: "Get help from the team" },
	{
		label: "Changelog",
		href: "https://github.com/Kilo-Org/kilocode/releases",
		description: "Latest updates and releases",
	},
]

function ChevronDownIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg">
			<path
				d="M2.5 4.5L6 8L9.5 4.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function SparkleIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			xmlns="http://www.w3.org/2000/svg">
			<path
				d="M8 1V3M8 13V15M3 8H1M15 8H13M12.5 3.5L11 5M5 11L3.5 12.5M12.5 12.5L11 11M5 5L3.5 3.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function SearchIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg">
			<path
				d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M19 19L14.65 14.65"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function HamburgerIcon({ isOpen }: { isOpen: boolean }) {
	return (
		<div className={`hamburger ${isOpen ? "open" : ""}`}>
			<span />
			<span />
			<span />
		</div>
	)
}

function DropdownMenu({ label, items, isOpen, onToggle, onClose }: DropdownMenuProps) {
	const dropdownRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				onClose()
			}
		}

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside)
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpen, onClose])

	return (
		<div ref={dropdownRef} className="relative">
			<button
				onClick={onToggle}
				className="flex items-center gap-1 px-3 py-2 text-sm font-medium transition-colors hover:text-[var(--text-color)]"
				style={{ color: "var(--text-secondary)" }}>
				{label}
				<ChevronDownIcon className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>
			{isOpen && (
				<div
					className="absolute right-0 top-full mt-2 w-64 rounded-lg border shadow-lg z-50"
					style={{
						backgroundColor: "var(--bg-color)",
						borderColor: "var(--border-color)",
					}}>
					<div className="py-2">
						{items.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								onClick={onClose}
								className="block px-4 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors">
								<span className="block text-sm font-medium" style={{ color: "var(--text-color)" }}>
									{item.label}
								</span>
								{item.description && (
									<span className="block text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
										{item.description}
									</span>
								)}
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

function NavTab({ item, isActive }: { item: NavItem; isActive: boolean }) {
	return (
		<Link
			href={item.href}
			className={`relative px-1 py-3 text-sm font-medium transition-colors ${
				isActive ? "text-indigo-600 dark:text-[#F8F675]" : "hover:text-[var(--text-color)]"
			}`}
			style={{ color: isActive ? "var(--text-brand)" : "var(--text-secondary)" }}>
			{item.label}
			{isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-[#F8F675]" />}
		</Link>
	)
}

interface TopNavProps {
	onMobileMenuToggle?: () => void
	isMobileMenuOpen?: boolean
	showMobileMenuButton?: boolean
}

export function TopNav({ onMobileMenuToggle, isMobileMenuOpen = false, showMobileMenuButton = true }: TopNavProps) {
	const router = useRouter()
	const [openDropdown, setOpenDropdown] = useState<string | null>(null)

	const handleDropdownToggle = (name: string) => {
		setOpenDropdown(openDropdown === name ? null : name)
	}

	const handleDropdownClose = () => {
		setOpenDropdown(null)
	}

	const isActiveTab = (href: string) => {
		if (href === "/docs") {
			return router.pathname === "/docs" || router.pathname === "/docs/index"
		}
		return router.pathname.startsWith(href)
	}

	// Open DocSearch modal programmatically
	const openDocSearch = () => {
		const searchButton = document.querySelector(".DocSearch-Button") as HTMLButtonElement
		if (searchButton) {
			searchButton.click()
		}
	}

	// Initialize DocSearch
	useEffect(() => {
		docsearch({
			container: "#docsearch",
			appId: process.env.NEXT_PUBLIC_ALGOLIA_APP_ID || "PMZUYBQDAK",
			indexName: process.env.NEXT_PUBLIC_ALGOLIA_INDEX_NAME || "docsearch",
			apiKey: process.env.NEXT_PUBLIC_ALGOLIA_API_KEY || "24b09689d5b4223813d9b8e48563c8f6",
			askAi: process.env.NEXT_PUBLIC_ALGOLIA_ASSISTANT_ID || "askAIDemo",
		})
	}, [])

	return (
		<header className="top-header">
			{/* Top bar */}
			<div className="top-bar">
				{/* Mobile menu button */}
				{showMobileMenuButton && (
					<button className="mobile-menu-btn" onClick={onMobileMenuToggle} aria-label="Toggle menu">
						<HamburgerIcon isOpen={isMobileMenuOpen} />
					</button>
				)}

				<Link href="/" className="logo-link flex gap-2 items-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 100 100"
						className="logo-icon"
						aria-label="Kilo Code Logo">
						<path
							fill="currentColor"
							d="M0,0v100h100V0H0ZM92.5925926,92.5925926H7.4074074V7.4074074h85.1851852v85.1851852ZM61.1111044,71.9096084h9.2592593v7.4074074h-11.6402116l-5.026455-5.026455v-11.6402116h7.4074074v9.2592593ZM77.7777711,71.9096084h-7.4074074v-9.2592593h-9.2592593v-7.4074074h11.6402116l5.026455,5.026455v11.6402116ZM46.2962963,61.1114207h-7.4074074v-7.4074074h7.4074074v7.4074074ZM22.2222222,53.7040133h7.4074074v16.6666667h16.6666667v7.4074074h-19.047619l-5.026455-5.026455v-19.047619ZM77.7777711,38.8888889v7.4074074h-24.0740741v-7.4074074h8.2781918v-9.2592593h-8.2781918v-7.4074074h10.6591442l5.026455,5.026455v11.6402116h8.3884749ZM29.6296296,30.5555556h9.2592593l7.4074074,7.4074074v8.3333333h-7.4074074v-8.3333333h-9.2592593v8.3333333h-7.4074074v-24.0740741h7.4074074v8.3333333ZM46.2962963,30.5555556h-7.4074074v-8.3333333h7.4074074v8.3333333Z"
						/>
					</svg>
					<div>
						<span className="logo-text font-brand">Kilo Code</span>
						<span className="docs-label">DOCS</span>
					</div>
				</Link>

				{/* Center - Search and Ask AI (desktop only) */}
				<div className="search-container desktop-nav">
					<div id="docsearch" />

					{/* <button className="ask-ai-btn">
						Ask AI
						<SparkleIcon className="w-4 h-4" />
					</button> */}
				</div>

				<div className="right-actions">
					{/* Mobile search button */}
					<button
						className="mobile-search-btn mobile-only"
						onClick={openDocSearch}
						aria-label="Search documentation">
						<SearchIcon />
					</button>
					<ThemeToggle />
					<Link href="https://kilo.ai/github" className="github-link desktop-nav">
						GitHub
					</Link>
					<Link href="https://app.kilo.ai" className="signin-btn desktop-nav">
						Sign in
					</Link>
				</div>
			</div>

			{/* Secondary nav bar (desktop only) */}
			<div className="secondary-bar desktop-nav">
				<nav className="main-nav">
					{mainNavItems.map((item) => (
						<NavTab key={item.href} item={item} isActive={isActiveTab(item.href)} />
					))}
				</nav>

				<div className="dropdown-container">
					<DropdownMenu
						label="Contributing"
						items={contributingItems}
						isOpen={openDropdown === "contributing"}
						onToggle={() => handleDropdownToggle("contributing")}
						onClose={handleDropdownClose}
					/>
					<DropdownMenu
						label="Help"
						items={helpItems}
						isOpen={openDropdown === "help"}
						onToggle={() => handleDropdownToggle("help")}
						onClose={handleDropdownClose}
					/>
				</div>
			</div>

			{/* Announcement banner */}
			<div className="announcement-banner">
				<p>
					We're{" "}
					<Link href="https://blog.kilo.ai/p/kilo-cli">replatforming our extensions on the new Kilo CLI</Link>
					. Contribute to the new CLI and pre-release extensions at{" "}
					<Link href="https://github.com/Kilo-Org/kilo">Kilo-Org/kilo</Link>.
				</p>
			</div>

			<style jsx>{`
				.top-header {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					z-index: 50;
					background-color: var(--bg-color);
					transition: background-color 0.2s ease;
				}

				.top-bar {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0.75rem 1.5rem;
					border-bottom: 1px solid var(--border-color);
					transition: border-color 0.2s ease;
				}

				.mobile-menu-btn {
					display: none;
					align-items: center;
					justify-content: center;
					padding: 0.5rem;
					background: transparent;
					border: none;
					cursor: pointer;
					margin-right: 0.75rem;
				}

				.logo-link {
					align-items: center;
					flex-wrap: nowrap;
					text-decoration: none;
				}

				.logo-icon {
					display: inline-block;
					width: 1.5rem;
					height: 1.5rem;
					color: var(--text-brand);
				}

				.logo-text {
					font-size: 1.125rem;
					font-weight: 600;
					letter-spacing: -0.025em;
				}

				.docs-label {
					font-size: 1rem;
					font-weight: 300;
					margin-left: 0.5rem;
					color: var(--text-secondary);
				}

				.search-container {
					display: flex;
					align-items: center;
					gap: 0.75rem;
				}

				.ask-ai-btn {
					display: flex;
					align-items: center;
					gap: 0.5rem;
					padding: 0.375rem 0.75rem;
					border-radius: 0.5rem;
					border: 1px solid var(--border-color);
					background-color: var(--bg-secondary);
					color: var(--text-secondary);
					font-size: 0.875rem;
					font-weight: 500;
					cursor: pointer;
					transition: border-color 0.15s ease;
				}

				.ask-ai-btn:hover {
					border-color: #9ca3af;
				}

				.right-actions {
					display: flex;
					align-items: center;
					gap: 1rem;
				}

				.github-link {
					font-size: 0.875rem;
					font-weight: 500;
					color: var(--text-secondary);
					text-decoration: none;
					transition: color 0.15s ease;
				}

				.github-link:hover {
					color: var(--text-color);
				}

				.signin-btn {
					padding: 0.375rem 0.75rem;
					font-size: 0.875rem;
					font-weight: 500;
					border-radius: 0.5rem;
					border: 1px solid var(--border-color);
					color: var(--text-color);
					text-decoration: none;
					transition: background-color 0.15s ease;
				}

				.signin-btn:hover {
					background-color: var(--bg-secondary);
				}

				.secondary-bar {
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0 1.5rem;
					border-bottom: 1px solid var(--border-color);
					transition: border-color 0.2s ease;
				}

				.main-nav {
					display: flex;
					align-items: center;
					gap: 1.5rem;
				}

				.dropdown-container {
					display: flex;
					align-items: center;
					gap: 0.5rem;
				}

				.mobile-search-btn {
					display: none;
					align-items: center;
					justify-content: center;
					padding: 0.5rem;
					background: transparent;
					border: none;
					cursor: pointer;
					color: var(--text-secondary);
					transition: color 0.15s ease;
				}

				.mobile-search-btn:hover {
					color: var(--text-color);
				}

				/* Mobile styles */
				@media (max-width: 768px) {
					.top-bar {
						padding: 0.75rem 1rem;
					}

					.mobile-menu-btn {
						display: flex;
					}

					.mobile-search-btn {
						display: flex;
					}

					.mobile-only {
						display: flex;
					}

					.logo-icon {
						display: none;
					}

					.docs-label {
						display: inline;
					}

					.desktop-nav {
						display: none !important;
					}

					.right-actions {
						gap: 0.5rem;
					}
				}

				.announcement-banner {
					background: #1a1a18;
					color: #a3a3a2;
					padding: 0.5rem 1rem;
					text-align: center;
					font-size: 0.875rem;
					border-bottom: 1px solid #3f3f3f;
				}

				.announcement-banner p {
					margin: 0;
				}

				.announcement-banner :global(a) {
					color: #f8f674;
					text-decoration: underline;
					text-underline-offset: 2px;
				}

				.announcement-banner :global(a:hover) {
					color: #ffff8d;
				}

				@media (max-width: 768px) {
					.announcement-banner {
						font-size: 0.8rem;
					}
				}
			`}</style>
		</header>
	)
}
