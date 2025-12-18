import React from "react"
import { useTranslation } from "react-i18next"
import { ClipboardCopy } from "lucide-react"

import { StandardTooltip } from "../../../components/ui"
import type { SuggestionItem } from "@roo-code/types"

interface FollowUpSuggestionsProps {
	suggestions: SuggestionItem[]
	onSuggestionClick: (suggestion: SuggestionItem) => void
	onCopyToInput?: (suggestion: SuggestionItem) => void
}

/**
 * Displays clickable suggestion buttons for follow-up questions in the agent manager.
 * Simplified version of the main sidebar's FollowUpSuggest component without auto-approval features.
 */
export function FollowUpSuggestions({ suggestions, onSuggestionClick, onCopyToInput }: FollowUpSuggestionsProps) {
	const { t } = useTranslation("agentManager")

	if (!suggestions?.length) {
		return null
	}

	return (
		<div className="am-followup-suggestions">
			{suggestions.map((suggestion, index) => (
				<div key={`${suggestion.answer}-${index}`} className="am-followup-suggestion-wrapper">
					<button
						type="button"
						onClick={() => onSuggestionClick(suggestion)}
						className="am-followup-suggestion-btn"
						aria-label={suggestion.answer}>
						{suggestion.answer}
					</button>
					{onCopyToInput && (
						<StandardTooltip content={t("chat:followUpSuggest.copyToInput")}>
							<button
								type="button"
								className="am-followup-copy-btn"
								onClick={(e) => {
									e.stopPropagation()
									onCopyToInput(suggestion)
								}}
								aria-label={t("chat:followUpSuggest.copyToInput")}>
								<ClipboardCopy size={16} />
							</button>
						</StandardTooltip>
					)}
				</div>
			))}
		</div>
	)
}
