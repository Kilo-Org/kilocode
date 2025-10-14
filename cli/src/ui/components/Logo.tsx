import React from "react"
import { Box, Text } from "ink"
import { useTheme } from "../../state/hooks/useTheme.js"

export const ASCII_LOGO = `⣿⡿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⢿⣿
⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⢰⣶⠀⠀⣶⡆⢰⣶⣶⣄⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⢸⣿⠿⠿⣦⡀⠀⠀⢸⣿⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⠸⠿⠀⠀⠿⠃⠘⠿⠿⠿⠿⠇⠀⠀⢸⣿
⣿⡇⠀⠀⢰⣶⠀⠀⣶⡄⠀⠀⣴⣶⣦⡀⠀⠀⢸⣿
⣿⡇⠀⠀⢸⣿⠀⠀⠀⠀⢰⣿⠁⠀⣿⡇⠀⠀⢸⣿
⣿⡇⠀⠀⠘⠿⠿⠿⠿⠇⠈⠻⠿⠿⠀⠀⠀⠀⢸⣿
⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿
⣿⣷⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣾⣿`

export const BIG_TEXT = ` █████   ████  ███  ████                █████████               █████
░░███   ███░  ░░░  ░░███               ███░░░░░███             ░░███
 ░███  ███    ████  ░███   ██████     ███     ░░░   ██████   ███████   ██████
 ░███████    ░░███  ░███  ███░░███   ░███          ███░░███ ███░░███  ███░░███
 ░███░░███    ░███  ░███ ░███ ░███   ░███         ░███ ░███░███ ░███ ░███████
 ░███ ░░███   ░███  ░███ ░███ ░███   ░░███     ███░███ ░███░███ ░███ ░███░░░
 █████ ░░████ █████ █████░░██████     ░░█████████ ░░██████ ░░████████░░██████
░░░░░   ░░░░ ░░░░░ ░░░░░  ░░░░░░       ░░░░░░░░░   ░░░░░░   ░░░░░░░░  ░░░░░░ `

interface LogoProps {
	color?: string
	showBigText?: boolean
	alignment?: "left" | "center" | "right"
}

export const Logo: React.FC<LogoProps> = ({ color, showBigText = true, alignment = "left" }) => {
	const theme = useTheme()
	const logoColor = color ?? theme.brand.primary
	const justifyContent = alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start"

	return (
		<Box flexDirection="row" alignItems="center" gap={4} justifyContent={justifyContent}>
			<Box flexDirection="column">
				{ASCII_LOGO.split("\n").map((line, index) => (
					<Text key={index} color={logoColor}>
						{line}
					</Text>
				))}
			</Box>
			{showBigText && (
				<Box flexDirection="column">
					{BIG_TEXT.split("\n").map((line, index) => (
						<Text key={index} color={logoColor}>
							{line}
						</Text>
					))}
				</Box>
			)}
		</Box>
	)
}
