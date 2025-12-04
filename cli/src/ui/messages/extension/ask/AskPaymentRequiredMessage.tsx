import React from "react"
import { Box, Text } from "ink"
import Link from "ink-link"
import type { MessageComponentProps } from "../types.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { logs } from "../../../../services/logs.js"

interface PaymentRequiredData {
	title: string
	message: string
	balance: number
	buyCreditsUrl: string
}

/**
 * Display payment required message with parsed JSON data
 * Shows title, message, balance, and URL for adding credits
 */
export const AskPaymentRequiredMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()

	// Parse JSON data with error handling and fallback values
	let data: PaymentRequiredData = {
		title: "Payment Required",
		message: "Credits are required to continue.",
		balance: 0,
		buyCreditsUrl: "",
	}

	try {
		const parsed = JSON.parse(message.text ?? "{}")
		data = { ...data, ...parsed }
	} catch (e) {
		logs.error("Failed to parse payment_required_prompt data", "AskPaymentRequiredMessage", { error: e })
	}

	return (
		<Box
			width={getBoxWidth(1)}
			flexDirection="column"
			borderStyle="single"
			borderColor={theme.semantic.warning}
			paddingX={1}
			marginY={1}>
			{/* Header with $ icon and dynamic title */}
			<Box>
				<Text color={theme.semantic.warning} bold>
					$ {data.title}
				</Text>
			</Box>

			{/* Main message content */}
			{data.message && (
				<Box marginTop={1}>
					<Text color={theme.ui.text.primary}>{data.message}</Text>
				</Box>
			)}

			{/* Balance display in bordered box */}
			<Box marginTop={1} borderStyle="single" borderColor={theme.semantic.info} paddingX={1} paddingY={0}>
				<Text color={theme.semantic.info} bold>
					Current Balance: ${data.balance.toFixed(2)}
				</Text>
			</Box>

			{/* URL section for adding credits */}
			{data.buyCreditsUrl && (
				<Box flexDirection="column" marginTop={1}>
					<Link url={data.buyCreditsUrl}>
						<Text color={theme.ui.text.primary}>Add Credits:</Text>
						<Text color={theme.semantic.info}> {data.buyCreditsUrl}</Text>
					</Link>
				</Box>
			)}
		</Box>
	)
}
