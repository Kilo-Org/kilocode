import React, { useState } from "react"
import Link from "next/link"

// Terminal content for each tab
const terminalContent = {
	installation: (
		<>
			<span className="terminal-comment"># Install Kilo Code VS Code Extension</span>
			{"\n"}
			<span className="terminal-prompt">$</span> code --install-extension kilocode.kilo-code
			{"\n"}
			{"\n"}
			<span className="terminal-comment"># Or install via CLI</span>
			{"\n"}
			<span className="terminal-prompt">$</span> npm install -g @kilocode/cli
		</>
	),
	firstTask: (
		<>
			<span className="terminal-comment"># Start a new task with Kilo Code</span>
			{"\n"}
			<span className="terminal-prompt">$</span> kilo "Create a React component for a user profile"
			{"\n"}
			{"\n"}
			<span className="terminal-comment">
				# Or for interactive sessions, just run the Kilo CLI in your project folder
			</span>
			{"\n"}
			<span className="terminal-prompt">$</span> kilo
			{"\n"}
			{"\n"}
			<span className="terminal-comment"># Run in architect mode for planning</span>
			{"\n"}
			<span className="terminal-prompt">$</span> kilo --mode architect "Design a REST API"
		</>
	),
	customRules: (
		<>
			<span className="terminal-comment"># Create a custom rules file in your project</span>
			{"\n"}
			<span className="terminal-prompt">$</span> touch .kilocode/rules.md
			{"\n"}
			{"\n"}
			<span className="terminal-comment"># Or use the CLI to add rules</span>
			{"\n"}
			<span className="terminal-prompt">$</span> kilo rules add "Always use TypeScript"
			{"\n"}
			<span className="terminal-prompt">$</span> kilo rules add "Follow React best practices"
			{"\n"}
			{"\n"}
			<span className="terminal-comment"># List all active rules</span>
			{"\n"}
			<span className="terminal-prompt">$</span> kilo rules list
		</>
	),
}

// Category card data based on the information architecture
const categories = [
	{
		title: "Get Started",
		description: "Install Kilo Code and get up and running in minutes",
		href: "/getting-started",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
		links: [
			{ title: "Installation", href: "/getting-started/installing" },
			{ title: "Quickstart", href: "/getting-started" },
			{ title: "FAQ", href: "/getting-started/faq" },
		],
	},
	{
		title: "Code with AI",
		description: "Learn how to use Kilo Code to write, edit, and understand code",
		href: "/code-with-ai",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
				<polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
		links: [
			{ title: "The Chat Interface", href: "/code-with-ai" },
			{ title: "Using Modes", href: "/code-with-ai" },
			{ title: "Custom Rules", href: "/code-with-ai" },
		],
	},
	{
		title: "Collaborate",
		description: "Work with teams, share sessions, and manage organizations",
		href: "/collaborate",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
				<circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M23 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
		links: [
			{ title: "Sessions & Sharing", href: "/collaborate" },
			{ title: "Kilo for Teams", href: "/collaborate" },
			{ title: "Enterprise", href: "/collaborate" },
		],
	},
	{
		title: "Automate",
		description: "Set up automated workflows, integrations, and MCP servers",
		href: "/automate",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
				<path
					d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		),
		links: [
			{ title: "Code Reviews", href: "/automate" },
			{ title: "MCP Overview", href: "/automate" },
			{ title: "Integrations", href: "/automate" },
		],
	},
	{
		title: "Deploy & Secure",
		description: "Deploy your applications and ensure security best practices",
		href: "/deploy-secure",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
		links: [
			{ title: "Deploy", href: "/deploy-secure" },
			{ title: "Managed Indexing", href: "/deploy-secure" },
			{ title: "Security Reviews", href: "/deploy-secure" },
		],
	},
	{
		title: "Contributing",
		description: "Help improve Kilo Code and learn about its architecture",
		href: "/contributing",
		icon: (
			<svg className="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
				<path
					d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		),
		links: [
			{ title: "Contributing Overview", href: "/contributing" },
			{ title: "Development Environment", href: "/contributing" },
			{ title: "Architecture", href: "/contributing" },
		],
	},
]

export default function HomePage() {
	const [activeTab, setActiveTab] = useState<"installation" | "firstTask" | "customRules">("installation")

	return (
		<div className="homepage">
			{/* Dotted background pattern */}
			<div className="dot-pattern" />

			{/* Hero Section */}
			<section className="hero">
				<div className="hero-content">
					<h1 className="hero-title">Kilo Code Documentation</h1>
					<p className="hero-subtitle">
						Explore our guides and examples to build with Kilo Code, the most popular open source coding
						agent.
					</p>
					<div className="hero-buttons">
						<Link href="/getting-started" className="btn btn-primary">
							Get started with Kilo Code →
						</Link>
						<Link href="/code-with-ai" className="btn btn-secondary">
							Explore all features
						</Link>
					</div>
				</div>

				{/* Quick Links Panel - Stripe style */}
				<div className="quick-panel">
					<div className="quick-section">
						<h3 className="quick-title">POPULAR GUIDES</h3>
						<div className="quick-links">
							<Link href="/getting-started/installing" className="quick-link">
								Installation Guide
							</Link>
							<Link href="/code-with-ai" className="quick-link">
								Chat Interface
							</Link>
							<Link href="/getting-started" className="quick-link">
								Your First Task
							</Link>
						</div>
					</div>
					<div className="quick-section">
						<h3 className="quick-title">PLATFORMS</h3>
						<div className="quick-links">
							<Link href="/code-with-ai" className="quick-link">
								VS Code Extension
							</Link>
							<Link href="/code-with-ai" className="quick-link">
								JetBrains Extension
							</Link>
							<Link href="/code-with-ai" className="quick-link">
								CLI
							</Link>
						</div>
					</div>
				</div>
			</section>

			{/* Browse by Category - Three Column Layout */}
			<section className="categories-section">
				<div className="category-group">
					{categories.slice(0, 3).map((category) => (
						<div key={category.title} className="category-column">
							<h3 className="category-title">{category.title}</h3>
							<div className="category-links">
								{category.links.map((link) => (
									<Link key={link.title} href={link.href} className="category-link">
										{link.title}
									</Link>
								))}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Category Cards Grid */}
			<section className="cards-section">
				<h2 className="section-title">Browse by topic</h2>
				<div className="cards-grid">
					{categories.map((category) => (
						<Link key={category.title} href={category.href} className="category-card">
							<div className="card-icon-wrapper">{category.icon}</div>
							<h3 className="card-title">{category.title}</h3>
							<p className="card-description">{category.description}</p>
							<span className="card-arrow">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</span>
						</Link>
					))}
				</div>
			</section>

			{/* Interactive Terminal Section - Stripe Shell Style */}
			<section className="terminal-section">
				<div className="terminal-intro">
					<h2 className="section-title">Try it out</h2>
					<p className="terminal-description">Get started quickly with common Kilo Code commands</p>
				</div>
				<div className="terminal-container">
					<div className="terminal-tabs">
						<button
							className={`terminal-tab ${activeTab === "installation" ? "active" : ""}`}
							onClick={() => setActiveTab("installation")}>
							Installation
						</button>
						<button
							className={`terminal-tab ${activeTab === "firstTask" ? "active" : ""}`}
							onClick={() => setActiveTab("firstTask")}>
							First Task
						</button>
						<button
							className={`terminal-tab ${activeTab === "customRules" ? "active" : ""}`}
							onClick={() => setActiveTab("customRules")}>
							Custom Rules
						</button>
					</div>
					<div className="terminal-window">
						<div className="terminal-header">
							<div className="terminal-dots">
								<span className="dot red"></span>
								<span className="dot yellow"></span>
								<span className="dot green"></span>
							</div>
							<span className="terminal-title">Terminal</span>
						</div>
						<div className="terminal-body">
							<pre className="terminal-code">
								<code>{terminalContent[activeTab]}</code>
							</pre>
						</div>
					</div>
				</div>
			</section>

			{/* Footer Links */}
			<section className="footer-section">
				<div className="footer-grid">
					<div className="footer-item">
						<span className="footer-icon">💬</span>
						<div>
							<strong>Need help?</strong>
							<Link href="https://discord.gg/kilocode" className="footer-link">
								Join our Discord
							</Link>
						</div>
					</div>
					<div className="footer-item">
						<span className="footer-icon">📝</span>
						<div>
							<strong>Check out our</strong>
							<Link href="/changelog" className="footer-link">
								Changelog
							</Link>
						</div>
					</div>
					<div className="footer-item">
						<span className="footer-icon">🐛</span>
						<div>
							<strong>Found a bug?</strong>
							<Link href="https://github.com/kilocode/kilocode/issues" className="footer-link">
								Report an issue
							</Link>
						</div>
					</div>
				</div>
			</section>

			<style jsx>{`
				.homepage {
					position: relative;
					min-height: 100vh;
					overflow-x: hidden;
				}

				/* Dotted Background Pattern */
				.dot-pattern {
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					height: 400px;
					background-image: radial-gradient(circle, var(--border-color) 1px, transparent 1px);
					background-size: 24px 24px;
					opacity: 0.5;
					pointer-events: none;
					z-index: 0;
				}

				/* Hero Section */
				.hero {
					position: relative;
					z-index: 1;
					display: grid;
					grid-template-columns: 1fr 350px;
					gap: 3rem;
					max-width: 1200px;
					margin: 0 auto;
					padding: 3rem 2rem 4rem;
				}

				.hero-content {
					padding-top: 1rem;
				}

				.hero-title {
					font-size: 3rem;
					font-weight: 700;
					margin: 0 0 1rem;
					line-height: 1.1;
				}

				.hero-subtitle {
					font-size: 1.25rem;
					color: var(--text-secondary);
					margin: 0 0 2rem;
					line-height: 1.6;
					max-width: 500px;
				}

				.hero-buttons {
					display: flex;
					gap: 1rem;
					flex-wrap: wrap;
				}

				.btn {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					gap: 0.5rem;
					padding: 1rem 2rem;
					border-radius: 4px;
					font-family: "JetBrains Mono", monospace;
					font-weight: 500;
					font-size: 1rem;
					text-decoration: none;
					transition: all 0.15s ease;
					border: 2px solid transparent;
				}

				.btn-primary {
					background: #f8f674;
					color: #1a1a18;
					border-color: #f8f674;
				}

				.btn-primary:hover {
					background: #ffff8d;
					border-color: #ffff8d;
					transform: translateY(-1px);
				}

				.btn-secondary {
					background: transparent;
					color: var(--text-secondary);
					border: 2px solid var(--text-secondary);
				}

				:global(.dark) .btn-secondary {
					color: #888;
					border-color: #555;
				}

				.btn-secondary:hover {
					color: var(--text-brand);
					border-color: var(--text-brand);
				}

				:global(.dark) .btn-secondary:hover {
					color: #f8f674;
					border-color: #f8f674;
				}

				.btn-primary {
					white-space: nowrap;
				}

				/* Quick Panel */
				.quick-panel {
					background: var(--bg-color);
					border: 1px solid var(--border-color);
					border-radius: 12px;
					padding: 1.5rem;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
				}

				:global(.dark) .quick-panel {
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
				}

				.quick-section {
					margin-bottom: 1.5rem;
				}

				.quick-section:last-child {
					margin-bottom: 0;
				}

				.quick-title {
					font-size: 0.7rem;
					font-weight: 600;
					letter-spacing: 0.05em;
					color: var(--text-secondary);
					margin: 0 0 0.75rem;
				}

				.quick-links {
					display: flex;
					flex-direction: column;
				}

				.quick-link {
					display: block;
					color: var(--accent-color);
					text-decoration: none;
					font-size: 0.9rem;
					padding: 0.25rem 0;
					transition: color 0.2s ease;
				}

				.quick-link:hover {
					color: var(--accent-hover);
				}

				/* Categories Section */
				.categories-section {
					position: relative;
					z-index: 1;
					max-width: 1200px;
					margin: 0 auto;
					padding: 2rem;
					border-top: 1px solid var(--border-color);
				}

				.category-group {
					display: grid;
					grid-template-columns: repeat(3, 1fr);
					gap: 3rem;
				}

				.category-column h3 {
					font-size: 1rem;
					font-weight: 600;
					margin: 0 0 0.75rem;
					color: var(--text-color);
				}

				.category-links {
					display: flex;
					flex-direction: column;
				}

				.category-link {
					display: block;
					color: var(--accent-color);
					text-decoration: none;
					font-size: 0.9rem;
					padding: 0.25rem 0;
					transition: color 0.2s ease;
				}

				.category-link:hover {
					color: var(--accent-hover);
				}

				/* Cards Section */
				.cards-section {
					position: relative;
					z-index: 1;
					max-width: 1200px;
					margin: 0 auto;
					padding: 3rem 2rem;
				}

				.section-title {
					font-size: 1.5rem;
					font-weight: 600;
					margin: 0 0 2rem;
					color: var(--text-color);
				}

				.cards-grid {
					display: grid;
					grid-template-columns: repeat(3, 1fr);
					gap: 1.5rem;
				}

				.category-card {
					position: relative;
					background: var(--bg-color);
					border: 1px solid var(--border-color);
					border-radius: 12px;
					padding: 1.5rem;
					text-decoration: none;
					transition: all 0.2s ease;
				}

				.category-card:hover {
					border-color: var(--accent-color);
					transform: translateY(-2px);
					box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
				}

				:global(.dark) .category-card:hover {
					box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
				}

				.card-icon-wrapper {
					width: 48px;
					height: 48px;
					display: flex;
					align-items: center;
					justify-content: center;
					background: var(--bg-secondary);
					border-radius: 10px;
					margin-bottom: 1rem;
				}

				:global(.category-icon) {
					width: 24px;
					height: 24px;
					color: var(--accent-color);
				}

				.card-title {
					font-size: 1.1rem;
					font-weight: 600;
					margin: 0 0 0.5rem;
					color: var(--text-brand);
				}

				.card-description {
					font-size: 0.9rem;
					color: var(--text-secondary);
					margin: 0;
					line-height: 1.5;
				}

				.card-arrow {
					position: absolute;
					top: 1.5rem;
					right: 1.5rem;
					width: 20px;
					height: 20px;
					opacity: 0;
					transform: translateX(-8px);
					transition: all 0.2s ease;
					color: var(--accent-color);
				}

				.category-card:hover .card-arrow {
					opacity: 1;
					transform: translateX(0);
				}

				/* Terminal Section */
				.terminal-section {
					position: relative;
					z-index: 1;
					max-width: 1200px;
					margin: 0 auto;
					padding: 3rem 2rem 4rem;
				}

				.terminal-intro {
					margin-bottom: 1.5rem;
				}

				.terminal-description {
					color: var(--text-secondary);
					margin: 0;
				}

				.terminal-container {
					display: flex;
					gap: 2rem;
				}

				.terminal-tabs {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
					min-width: 180px;
				}

				.terminal-tab {
					background: transparent;
					border: 1px solid transparent;
					border-radius: 8px;
					padding: 0.75rem 1rem;
					text-align: left;
					font-size: 0.9rem;
					color: var(--text-secondary);
					cursor: pointer;
					transition: all 0.2s ease;
				}

				.terminal-tab:hover {
					background: var(--bg-secondary);
				}

				.terminal-tab.active {
					background: var(--bg-secondary);
					border-color: var(--border-color);
					color: var(--text-brand);
					font-weight: 500;
				}

				.terminal-window {
					flex: 1;
					background: #1e1e1e;
					border-radius: 12px;
					overflow: hidden;
					box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
				}

				.terminal-header {
					display: flex;
					align-items: center;
					gap: 0.75rem;
					padding: 0.75rem 1rem;
					background: #2d2d2d;
				}

				.terminal-dots {
					display: flex;
					gap: 6px;
				}

				.dot {
					width: 12px;
					height: 12px;
					border-radius: 50%;
				}

				.dot.red {
					background: #ff5f56;
				}
				.dot.yellow {
					background: #ffbd2e;
				}
				.dot.green {
					background: #27ca40;
				}

				.terminal-title {
					color: #888;
					font-size: 0.8rem;
				}

				.terminal-body {
					padding: 1.5rem;
				}

				.terminal-code {
					margin: 0;
					font-family: "JetBrains Mono", monospace;
					font-size: 0.85rem;
					line-height: 1.6;
					color: #e5e5e5;
				}

				:global(.terminal-comment) {
					color: #6a9955;
				}

				:global(.terminal-prompt) {
					color: #dcdcaa;
				}

				/* Footer Section */
				.footer-section {
					position: relative;
					z-index: 1;
					max-width: 1200px;
					margin: 0 auto;
					padding: 2rem;
					border-top: 1px solid var(--border-color);
				}

				.footer-grid {
					display: grid;
					grid-template-columns: repeat(3, 1fr);
					gap: 2rem;
				}

				.footer-item {
					display: flex;
					align-items: center;
					gap: 1rem;
				}

				.footer-icon {
					font-size: 1.5rem;
				}

				.footer-item strong {
					display: block;
					font-size: 0.85rem;
					color: var(--text-secondary);
					font-weight: 400;
				}

				.footer-link {
					color: var(--accent-color);
					text-decoration: none;
					font-weight: 500;
				}

				.footer-link:hover {
					color: var(--accent-hover);
				}

				/* Responsive Design */
				@media (max-width: 1024px) {
					.hero {
						grid-template-columns: 1fr;
						gap: 2rem;
					}

					.quick-panel {
						display: grid;
						grid-template-columns: repeat(2, 1fr);
					}

					.quick-section {
						margin-bottom: 0;
					}

					.cards-grid {
						grid-template-columns: repeat(2, 1fr);
					}

					.category-group {
						grid-template-columns: repeat(2, 1fr);
					}

					.footer-grid {
						grid-template-columns: repeat(2, 1fr);
					}
				}

				@media (max-width: 768px) {
					.hero {
						padding: 2rem 1rem 3rem;
					}

					.hero-title {
						font-size: 2rem;
					}

					.hero-subtitle {
						font-size: 1rem;
					}

					.hero-buttons {
						flex-direction: column;
					}

					.btn {
						width: 100%;
						justify-content: center;
					}

					.quick-panel {
						grid-template-columns: 1fr;
					}

					.quick-section {
						margin-bottom: 1.5rem;
					}

					.category-group {
						grid-template-columns: 1fr;
						gap: 2rem;
					}

					.cards-grid {
						grid-template-columns: 1fr;
					}

					.terminal-container {
						flex-direction: column;
					}

					.terminal-tabs {
						flex-direction: row;
						overflow-x: auto;
						min-width: 0;
					}

					.terminal-tab {
						white-space: nowrap;
					}

					.footer-grid {
						grid-template-columns: 1fr;
						gap: 1.5rem;
					}

					.cards-section,
					.categories-section,
					.terminal-section,
					.footer-section {
						padding: 2rem 1rem;
					}
				}
			`}</style>
		</div>
	)
}
