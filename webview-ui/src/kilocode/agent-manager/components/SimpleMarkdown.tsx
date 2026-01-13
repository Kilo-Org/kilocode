import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface SimpleMarkdownProps {
	content: string
}

export const SimpleMarkdown: React.FC<SimpleMarkdownProps> = ({ content }) => {
	return (
		<div className="am-markdown-content">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
		</div>
	)
}
