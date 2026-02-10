import React from "react"
import Link from "next/link"

export function TableOfContents({ toc }) {
	const items = toc.filter((item) => item.id && (item.level === 2 || item.level === 3))

	if (items.length <= 1) {
		return null
	}

	return (
		<nav className="toc">
			<ul className="flex column">
				{items.map((item) => {
					const href = `#${item.id}`
					const active = typeof window !== "undefined" && window.location.hash === href
					return (
						<li
							key={item.title}
							className={[active ? "active" : undefined, item.level === 3 ? "padded" : undefined]
								.filter(Boolean)
								.join(" ")}>
							<Link href={href}>{item.title}</Link>
						</li>
					)
				})}
			</ul>
			<style jsx>
				{`
					nav {
						position: sticky;
						top: 0;
						max-height: calc(100vh - var(--top-nav-height) - 6rem);
						width: 100%;
						align-self: flex-start;
						margin-bottom: 1rem;
						padding: 0.5rem 0 0;
						border-left: 1px solid var(--border-color);
						transition: border-color 0.2s ease;
						overflow-y: auto;
					}
					ul {
						margin: 0;
						padding-left: 1rem;
						display: flex;
						flex-direction: column;
					}
					li {
						list-style-type: none;
						margin: 0 0 1rem;
					}
					li :global(a) {
						text-decoration: none;
						color: var(--text-secondary);
					}
					li :global(a:hover),
					li.active :global(a) {
						text-decoration: underline;
					}
					li.padded {
						padding-left: 1rem;
					}

					/* Hide on tablet and mobile */
					@media (max-width: 1024px) {
						nav {
							display: none;
						}
					}
				`}
			</style>
		</nav>
	)
}
