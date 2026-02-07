import React from "react"
import Link from "next/link"
import Head from "next/head"

export default function Custom404() {
	return (
		<>
			<Head>
				<title>404 - Page Not Found | Kilo Code Documentation</title>
				<meta name="description" content="The requested page could not be found." />
			</Head>
			<div className="not-found-page">
				<div className="not-found-container">
					{/* Terminal Window */}
					<div className="terminal-window">
						<div className="terminal-header">
							<div className="terminal-dots">
								<span className="dot red"></span>
								<span className="dot yellow"></span>
								<span className="dot green"></span>
							</div>
							<span className="terminal-title">terminal</span>
						</div>
						<div className="terminal-body">
							<div className="terminal-line">
								<span className="prompt">$</span>
								<span className="command"> GET /requested-path</span>
							</div>
							<div className="terminal-line error">
								<span className="error-text">Error 404: Page not found</span>
							</div>
							<div className="error-code">
								<div className="error-bar"></div>
								<span className="code-404">404</span>
							</div>
						</div>
					</div>

					{/* Message */}
					<div className="message-section">
						<h1 className="message-title">Page not found</h1>
						<p className="message-subtitle">The page you requested does not exist or has been moved.</p>
					</div>

					{/* Actions */}
					<div className="actions">
						<Link href="/" className="btn btn-primary">
							Return to Documentation
						</Link>
						<Link href="/getting-started" className="btn btn-secondary">
							Getting Started
						</Link>
					</div>
				</div>

				<style jsx>{`
					.not-found-page {
						min-height: calc(100vh - var(--top-nav-height));
						display: flex;
						align-items: center;
						justify-content: center;
						padding: 2rem;
						background: var(--bg-color);
					}

					.not-found-container {
						max-width: 600px;
						width: 100%;
						text-align: center;
					}

					/* Terminal Window */
					.terminal-window {
						background: #2d2d2d;
						border-radius: 8px;
						overflow: hidden;
						box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
						margin-bottom: 2.5rem;
					}

					.terminal-header {
						background: #3d3d3d;
						padding: 0.75rem 1rem;
						display: flex;
						align-items: center;
						gap: 0.75rem;
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
						font-family: "JetBrains Mono", monospace;
						font-size: 0.85rem;
					}

					.terminal-body {
						padding: 1.5rem;
						text-align: left;
					}

					.terminal-line {
						font-family: "JetBrains Mono", monospace;
						font-size: 0.95rem;
						margin-bottom: 0.5rem;
					}

					.prompt {
						color: #f8f674;
					}

					.command {
						color: #a0a0a0;
					}

					.terminal-line.error {
						margin-top: 0.25rem;
					}

					.error-text {
						color: #ff6b6b;
					}

					.error-code {
						display: flex;
						align-items: center;
						margin-top: 1rem;
						padding-left: 0.5rem;
					}

					.error-bar {
						width: 4px;
						height: 80px;
						background: #f8f674;
						margin-right: 1.5rem;
						border-radius: 2px;
					}

					.code-404 {
						font-family: "JetBrains Mono", monospace;
						font-size: 4.5rem;
						font-weight: 700;
						color: #f8f674;
						line-height: 1;
					}

					/* Message Section */
					.message-section {
						margin-bottom: 2rem;
					}

					.message-title {
						font-family: "JetBrains Mono", monospace;
						font-size: 1.5rem;
						font-weight: 600;
						color: var(--text-header);
						margin: 0 0 0.75rem 0;
					}

					.message-subtitle {
						color: var(--text-secondary);
						font-size: 1rem;
						margin: 0;
						line-height: 1.5;
					}

					/* Actions */
					.actions {
						display: flex;
						gap: 1rem;
						justify-content: center;
						flex-wrap: wrap;
					}

					/* Mobile Responsive */
					@media (max-width: 600px) {
						.not-found-page {
							padding: 1.5rem;
						}

						.code-404 {
							font-size: 3.5rem;
						}

						.error-bar {
							height: 60px;
						}

						.message-title {
							font-size: 1.25rem;
						}

						.actions {
							flex-direction: column;
						}

						.actions :global(.btn) {
							width: 100%;
						}
					}
				`}</style>
			</div>
		</>
	)
}

// This tells Next.js to use a different layout approach
Custom404.is404 = true
