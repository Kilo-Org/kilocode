import React, { useState, useEffect } from "react"
import { useRouter } from "next/router"

interface CopyPageButtonProps {
	className?: string
}

export function CopyPageButton({ className }: CopyPageButtonProps) {
	const router = useRouter()
	const [copied, setCopied] = useState(false)
	const [isLoading, setIsLoading] = useState(false)

	// Reset copied state after 3 seconds
	useEffect(() => {
		if (copied) {
			const timer = setTimeout(() => {
				setCopied(false)
			}, 3000)
			return () => clearTimeout(timer)
		}
	}, [copied])

	const handleCopy = async () => {
		if (copied || isLoading) return

		setIsLoading(true)

		try {
			// Fetch the raw markdown file based on current route
			// The route path maps to pages/<path>.md
			const path = router.asPath.split("#")[0].split("?")[0] // Remove hash and query params
			const mdPath = path === "/" ? "/index" : path

			// Fetch the raw markdown content from the API route
			const response = await fetch(`/docs/api/raw-markdown?path=${encodeURIComponent(mdPath)}`)

			if (!response.ok) {
				throw new Error("Failed to fetch markdown")
			}

			const markdown = await response.text()

			await navigator.clipboard.writeText(markdown)
			setCopied(true)
		} catch (error) {
			console.error("Failed to copy page:", error)
			// Even on error, show some feedback
			setCopied(true)
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<>
			<button
				onClick={handleCopy}
				disabled={copied || isLoading}
				className={`copy-page-button ${copied ? "copied" : ""} ${className || ""}`}
				aria-label={copied ? "Copied" : "Copy page markdown"}
				title="Copy page as markdown for use with LLMs">
				{copied ? (
					<>
						<CheckIcon />
						<span>Copied</span>
					</>
				) : (
					<>
						<CopyIcon />
						<span>Copy page</span>
					</>
				)}
			</button>
			<style jsx>{`
				.copy-page-button {
					display: inline-flex;
					align-items: center;
					gap: 0.5rem;
					padding: 0.25rem 0.5rem;
					font-size: 0.875rem;
					font-weight: 500;
					font-family: inherit;
					color: var(--text-secondary);
					background: var(--bg-secondary);
					border: 1px solid var(--border-color);
					border-radius: 0.5rem;
					cursor: pointer;
					transition: all 0.15s ease;
					white-space: nowrap;
				}

				.copy-page-button:hover:not(:disabled) {
					background: var(--bg-tertiary, var(--bg-secondary));
					color: var(--text-brand);
					border-color: var(--text-brand);
				}

				.copy-page-button:disabled {
					cursor: default;
				}

				.copy-page-button.copied {
					color: var(--success-color, #22c55e);
					border-color: var(--success-color, #22c55e);
					background: var(--success-bg, rgba(34, 197, 94, 0.1));
				}
			`}</style>
		</>
	)
}

// Copy icon (two overlapping rectangles)
function CopyIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round">
			<rect x="5" y="5" width="9" height="9" rx="1.5" />
			<path d="M2 10V3.5A1.5 1.5 0 0 1 3.5 2H10" />
		</svg>
	)
}

// Check icon for copied state
function CheckIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round">
			<path d="M3 8.5L6.5 12L13 4" />
		</svg>
	)
}
