import Prism from "prismjs"

import * as React from "react"
import { Codicon } from "./Codicon"

export function CodeBlock({ children, "data-language": language }) {
	const ref = React.useRef(null)
	const timeoutRef = React.useRef(null)
	const [copied, setCopied] = React.useState(false)

	React.useEffect(() => {
		if (ref.current) Prism.highlightElement(ref.current, false)
	}, [children])

	React.useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	const handleCopy = async () => {
		const code = ref.current?.textContent || ""
		try {
			await navigator.clipboard.writeText(code)
			setCopied(true)
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
			timeoutRef.current = setTimeout(() => setCopied(false), 2000)
		} catch (err) {
			console.error("Failed to copy code:", err)
		}
	}

	return (
		<div className="code" aria-live="polite">
			<button
				type="button"
				className="copy-button"
				onClick={handleCopy}
				aria-label="Copy code to clipboard"
				title={copied ? "Copied!" : "Copy code"}>
				{copied ? <Codicon name="check" /> : <Codicon name="copy" />}
			</button>
			<pre ref={ref} className={`language-${language}`}>
				{children}
			</pre>
			<style jsx>
				{`
					.code {
						position: relative;
					}

					.copy-button {
						position: absolute;
						top: 8px;
						right: 8px;
						padding: 6px 8px;
						background: rgba(0, 0, 0, 0.05);
						border: 1px solid rgba(0, 0, 0, 0.1);
						border-radius: 4px;
						color: rgba(0, 0, 0, 0.4);
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						transition: all 0.2s ease;
						z-index: 10;
					}

					.copy-button:hover {
						background: rgba(0, 0, 0, 0.1);
						color: rgba(0, 0, 0, 0.6);
						border-color: rgba(0, 0, 0, 0.2);
					}

					:global(.dark) .copy-button {
						background: rgba(255, 255, 255, 0.05);
						border-color: rgba(255, 255, 255, 0.1);
						color: rgba(255, 255, 255, 0.4);
					}

					:global(.dark) .copy-button:hover {
						background: rgba(255, 255, 255, 0.1);
						color: rgba(255, 255, 255, 0.7);
						border-color: rgba(255, 255, 255, 0.2);
					}

					.copy-button:active {
						transform: scale(0.95);
					}

					/* Override Prism styles */
					.code :global(pre[class*="language-"]) {
						text-shadow: none;
						border-radius: 4px;
						padding-right: 3.5rem;
					}
				`}
			</style>
		</div>
	)
}
