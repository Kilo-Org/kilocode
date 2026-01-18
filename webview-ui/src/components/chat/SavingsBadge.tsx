import React from "react"
import { formatPrice } from "@/utils/formatPrice"

interface SavingsBadgeProps {
	saved: number
	comparisonModel: string
	showDetailed?: boolean
	className?: string
}

export function SavingsBadge({ saved, comparisonModel, showDetailed = false, className = "" }: SavingsBadgeProps) {
	if (saved <= 0) return null

	return (
		<div className={`savings-badge ${className}`}>
			<span className="savings-icon">💰</span>
			<span className="savings-text">
				You saved {formatPrice(saved)} by using Agentica instead of {comparisonModel}
			</span>
			{showDetailed && (
				<span className="savings-details">
					({((saved / (saved + 0.01)) * 100).toFixed(1)}% savings)
				</span>
			)}
		</div>
	)
}

export default SavingsBadge
