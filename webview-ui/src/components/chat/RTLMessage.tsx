// kilocode_change - new file

import React from "react"
import { Mention } from "./Mention"
import { getLineDirectionStyle } from "@/utils/rtl-detection"

interface RTLMessageProps {
	text: string
	withShadow?: boolean
	className?: string
}

/**
 * RTL-aware message component that handles text direction automatically
 */
export const RTLMessage: React.FC<RTLMessageProps> = ({ text, withShadow = false, className = "" }) => {
	// Split text into lines and apply direction individually
	const lines = text.split("\n")

	return (
		<div className={className}>
			{lines.map((line, index) => (
				<div key={index} style={getLineDirectionStyle(line)} className={index < lines.length - 1 ? "mb-1" : ""}>
					<Mention text={line} withShadow={withShadow} />
				</div>
			))}
		</div>
	)
}

export default RTLMessage
