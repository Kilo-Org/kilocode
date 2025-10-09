import { X } from "lucide-react"
import { StandardTooltip } from "@/components/ui"

interface ContextPillsBarProps {
	mentions: string[]
	onRemove: (mention: string) => void
}

export const ContextPillsBar = ({ mentions, onRemove }: ContextPillsBarProps) => {
	if (mentions.length === 0) return null

	const getDisplayName = (path: string) => {
		// Remove @ prefix if present
		const cleanPath = path.startsWith("@") ? path.slice(1) : path

		// Handle special mentions
		if (["problems", "terminal", "git-changes"].includes(cleanPath)) {
			return cleanPath
		}

		// Handle git commit hashes
		if (/^[a-f0-9]{7,40}$/i.test(cleanPath)) {
			return cleanPath.substring(0, 7)
		}

		// Handle URLs
		if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
			try {
				const url = new URL(cleanPath)
				return url.hostname
			} catch {
				return cleanPath
			}
		}

		// Get basename for file paths
		const parts = cleanPath.split("/")
		return parts[parts.length - 1] || cleanPath
	}

	return (
		<div className="context-pills-bar">
			{mentions.map((mention, index) => {
				const displayName = getDisplayName(mention)
				// For hover text, show the path without the @ prefix and with proper formatting
				const cleanPath = mention.startsWith("@") ? mention.slice(1) : mention
				// Ensure the path starts with / for display, but don't add an extra one
				const displayPath = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`

				return (
					<StandardTooltip key={`${mention}-${index}`} content={displayPath} side="top">
						<div className="context-pill">
							<span className="context-pill-name">{displayName}</span>
							<button
								className="context-pill-remove"
								onClick={() => onRemove(mention)}
								aria-label={`Remove ${displayName}`}
								type="button">
								<X className="h-3 w-3" />
							</button>
						</div>
					</StandardTooltip>
				)
			})}
		</div>
	)
}