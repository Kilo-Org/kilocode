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
						background: #1e1e1e;
						border: 1px solid rgba(255, 255, 255, 0.2);
						border-radius: 4px;
						color: rgba(255, 255, 255, 0.7);
						cursor: pointer;
						display: flex;
						align-items: center;
						justify-content: center;
						transition: all 0.2s ease;
						z-index: 10;
					}

					.copy-button:hover {
						background: #2d2d2d;
						color: rgba(255, 255, 255, 1);
						border-color: rgba(255, 255, 255, 0.3);
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
