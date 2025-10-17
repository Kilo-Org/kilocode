import React from "react"
import { Box, Text, useStdout } from "ink"
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

export const Logo: React.FC = () => {
	const theme = useTheme()
	const {
		stdout: { columns },
	} = useStdout()
	const logoColor = theme.brand.primary
	const justifyContent = "flex-start"

	const LogoIcon = (
		<Box flexDirection="column">
			{ASCII_LOGO.split("\n").map((line, index) => (
				<Text key={index} color={logoColor}>
					{line}
				</Text>
			))}
		</Box>
	)

	const LogoBigText = (
		<Box flexDirection="column">
			{BIG_TEXT.split("\n").map((line, index) => (
				<Text key={index} color={logoColor}>
					{line}
				</Text>
			))}
		</Box>
	)

	return (
		<Box flexDirection="row" alignItems="center" gap={4} justifyContent={justifyContent}>
			{columns < 80 ? (
				LogoIcon
			) : columns < 104 ? (
				LogoBigText
			) : (
				<>
					{LogoIcon}
					{LogoBigText}
				</>
			)}
		</Box>
	)
}
