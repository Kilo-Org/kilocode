import React, { useState, useRef, useEffect, useCallback, forwardRef } from "react"
import styled from "styled-components"
import { getHighlighter, isLanguageLoaded, normalizeLanguage, ExtendedLanguage } from "@src/utils/highlighter"
import { CODE_BLOCK_BG_COLOR } from "@src/components/common/CodeBlock"

interface EditableCodeBlockProps {
	value: string
	onChange: (value: string) => void
	language: string
	placeholder?: string
	className?: string
	rows?: number
}

const EditorContainer = styled.div`
	position: relative;
	width: 100%;
	font-family: var(--vscode-editor-font-family);
	font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
	line-height: 1.5;
	background-color: ${CODE_BLOCK_BG_COLOR};
	border-radius: 5px;
	overflow: auto;
	display: block;
	box-sizing: border-box;
`

const HiddenTextArea = styled.textarea`
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	padding: 10px;
	margin: 0;
	border: none;
	resize: none;
	color: transparent;
	background: transparent;
	caret-color: var(--vscode-editor-foreground);
	z-index: 2;
	white-space: pre-wrap;
	word-break: break-word;
	overflow-wrap: break-word;
	overflow: visible;
	font-family: var(--vscode-editor-font-family);
	font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
	line-height: 1.5;
	outline: none;
	tab-size: 4;

	&::selection {
		background-color: var(--vscode-editor-selectionBackground);
		color: transparent;
	}
`

const SyntaxHighlightedContent = styled.div`
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	padding: 10px;
	margin: 0;
	pointer-events: none;
	white-space: pre-wrap;
	word-break: break-word;
	overflow-wrap: break-word;
	overflow: visible;
	z-index: 1;
	tab-size: 4;

	pre {
		margin: 0;
		padding: 0;
		background: transparent;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
		tab-size: 4;
	}

	code {
		font-family: var(--vscode-editor-font-family);
		font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 12px));
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
		tab-size: 4;
	}

	.hljs {
		color: var(--vscode-editor-foreground, #fff);
		background-color: transparent;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
	}
`

const EditableCodeBlock = forwardRef<HTMLTextAreaElement, EditableCodeBlockProps>(
	({ value, onChange, language, placeholder = "Enter code here...", className, rows = 5 }, ref) => {
		const [highlightedCode, setHighlightedCode] = useState<string>("")
		const [currentLanguage, setCurrentLanguage] = useState<ExtendedLanguage>(() => normalizeLanguage(language))
		const textAreaRef = useRef<HTMLTextAreaElement>(null)

		// Sync internal ref with forwarded ref
		useEffect(() => {
			if (typeof ref === "function") {
				ref(textAreaRef.current)
			} else if (ref) {
				ref.current = textAreaRef.current
			}
		}, [ref])
		const containerRef = useRef<HTMLDivElement>(null)

		// Update current language when prop changes
		useEffect(() => {
			const normalizedLang = normalizeLanguage(language)
			if (normalizedLang !== currentLanguage) {
				setCurrentLanguage(normalizedLang)
			}
		}, [language, currentLanguage])

		// Syntax highlighting with Shiki
		useEffect(() => {
			const fallback = `<pre><code class="hljs language-${currentLanguage || "txt"}">${value || ""}</code></pre>`

			const highlight = async () => {
				// Show plain text if language needs to be loaded
				if (currentLanguage && !isLanguageLoaded(currentLanguage)) {
					setHighlightedCode(fallback)
				}

				const highlighter = await getHighlighter(currentLanguage)

				const html = await highlighter.codeToHtml(value || "", {
					lang: currentLanguage || "txt",
					theme: document.body.className.toLowerCase().includes("light") ? "github-light" : "github-dark",
					transformers: [
						{
							pre(node) {
								node.properties.style = "padding: 0; margin: 0; background: transparent;"
								return node
							},
							code(node) {
								// Add hljs classes for consistent styling
								node.properties.class = `hljs language-${currentLanguage}`
								return node
							},
							line(node) {
								// Preserve existing line handling
								node.properties.class = node.properties.class || ""
								return node
							},
						},
					],
				})

				setHighlightedCode(html)
			}

			highlight().catch((e) => {
				console.error("[EditableCodeBlock] Syntax highlighting error:", e)
				setHighlightedCode(fallback)
			})
		}, [value, currentLanguage])

		// Re-highlight when content changes
		useEffect(() => {
			// Force a re-render of the syntax highlighting when content changes
			// This helps keep the highlighting in sync with the textarea
			const fallback = `<pre><code class="hljs language-${currentLanguage || "txt"}">${value || ""}</code></pre>`
			setHighlightedCode(fallback)

			// Schedule a proper highlight after the DOM has updated
			setTimeout(async () => {
				try {
					const highlighter = await getHighlighter(currentLanguage)
					const html = await highlighter.codeToHtml(value || "", {
						lang: currentLanguage || "txt",
						theme: document.body.className.toLowerCase().includes("light") ? "github-light" : "github-dark",
						transformers: [
							{
								pre(node) {
									node.properties.style = "padding: 0; margin: 0; background: transparent;"
									return node
								},
								code(node) {
									node.properties.class = `hljs language-${currentLanguage}`
									return node
								},
								line(node) {
									node.properties.class = node.properties.class || ""
									return node
								},
							},
						],
					})
					setHighlightedCode(html)
				} catch (e) {
					console.error("[EditableCodeBlock] Syntax highlighting error:", e)
				}
			}, 10)
		}, [value, currentLanguage])

		// Handle input changes
		const handleChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				onChange(e.target.value)
			},
			[onChange],
		)

		// Handle tab key for indentation
		const handleKeyDown = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (e.key === "Tab") {
					e.preventDefault()
					const target = e.target as HTMLTextAreaElement
					const start = target.selectionStart
					const end = target.selectionEnd

					// Insert tab at cursor position
					const newValue = value.substring(0, start) + "    " + value.substring(end)
					onChange(newValue)

					// Move cursor after the inserted tab
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.selectionStart = textAreaRef.current.selectionEnd = start + 4
						}
					}, 0)
				}
			},
			[value, onChange],
		)

		return (
			<EditorContainer ref={containerRef} className={className} style={{ height: `${rows * 20}px` }}>
				<HiddenTextArea
					ref={textAreaRef}
					value={value}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					spellCheck={false}
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
					data-gramm="false"
				/>
				<SyntaxHighlightedContent
					dangerouslySetInnerHTML={{ __html: highlightedCode || `<pre><code>${placeholder}</code></pre>` }}
				/>
			</EditorContainer>
		)
	},
)

export default EditableCodeBlock
