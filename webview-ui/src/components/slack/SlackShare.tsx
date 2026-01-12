// kilocode_change - Slack Share Component

import React, { useState } from "react"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Textarea } from "../ui/textarea"
import { Badge } from "../ui/badge"
import { Share2, Loader2, CheckCircle2, XCircle } from "lucide-react"

interface SlackShareProps {
	content: string
	citations?: Array<{
		sourceType: "file" | "documentation" | "url"
		sourcePath: string
		startLine?: number
		endLine?: number
		snippet: string
	}>
	onShare?: (channelId: string, message: string) => Promise<{ success: boolean; error?: string }>
	channels?: Array<{ id: string; name: string }>
}

export const SlackShare: React.FC<SlackShareProps> = ({ content, citations = [], onShare, channels = [] }) => {
	const [open, setOpen] = useState(false)
	const [selectedChannel, setSelectedChannel] = useState<string>("")
	const [customMessage, setCustomMessage] = useState("")
	const [isSharing, setIsSharing] = useState(false)
	const [shareResult, setShareResult] = useState<{ success: boolean; error?: string } | null>(null)

	const handleShare = async () => {
		if (!onShare || !selectedChannel) return

		setIsSharing(true)
		setShareResult(null)

		try {
			const result = await onShare(selectedChannel, customMessage || content)
			setShareResult(result)

			if (result.success) {
				setTimeout(() => {
					setOpen(false)
					setCustomMessage("")
					setShareResult(null)
				}, 2000)
			}
		} catch (error) {
			setShareResult({ success: false, error: error.message })
		} finally {
			setIsSharing(false)
		}
	}

	const _formatMessage = () => {
		let message = customMessage || content

		if (citations.length > 0) {
			message += "\n\n*Sources:*\n"
			citations.forEach((citation, index) => {
				const icon =
					citation.sourceType === "file" ? "📄" : citation.sourceType === "documentation" ? "📚" : "🔗"
				const location =
					citation.startLine && citation.endLine ? ` (lines ${citation.startLine}-${citation.endLine})` : ""
				message += `${index + 1}. ${icon} *${citation.sourcePath}*${location}\n`
			})
		}

		return message
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Share2 className="h-4 w-4 mr-2" />
					Share to Slack
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Share to Slack</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<div className="text-sm font-medium">Channel</div>
						<Select value={selectedChannel} onValueChange={setSelectedChannel}>
							<SelectTrigger id="channel">
								<SelectValue placeholder="Select a channel" />
							</SelectTrigger>
							<SelectContent>
								{channels.map((channel) => (
									<SelectItem key={channel.id} value={channel.id}>
										#{channel.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<div className="text-sm font-medium">Message</div>
						<Textarea
							id="message"
							value={customMessage}
							onChange={(e) => setCustomMessage(e.target.value)}
							placeholder="Add a custom message (optional)"
							rows={3}
						/>
					</div>

					{citations.length > 0 && (
						<div className="space-y-2">
							<div className="text-sm font-medium">Citations ({citations.length})</div>
							<div className="flex flex-wrap gap-2">
								{citations.map((citation, index) => (
									<Badge key={index} variant="secondary">
										{citation.sourceType === "file"
											? "📄"
											: citation.sourceType === "documentation"
												? "📚"
												: "🔗"}{" "}
										{citation.sourcePath.split("/").pop()}
									</Badge>
								))}
							</div>
						</div>
					)}

					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleShare} disabled={!selectedChannel || isSharing}>
							{isSharing ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Sharing...
								</>
							) : (
								<>
									<Share2 className="h-4 w-4 mr-2" />
									Share
								</>
							)}
						</Button>
					</div>

					{shareResult && (
						<div
							className={`flex items-center gap-2 p-3 rounded-md ${
								shareResult.success
									? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
									: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
							}`}>
							{shareResult.success ? (
								<CheckCircle2 className="h-5 w-5" />
							) : (
								<XCircle className="h-5 w-5" />
							)}
							<span className="text-sm">
								{shareResult.success
									? "Message shared successfully!"
									: shareResult.error || "Failed to share message"}
							</span>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
