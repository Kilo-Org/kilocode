import inquirer from "inquirer"
import { loadConfig, saveConfig, CLIConfig } from "../config"
import openConfigFile from "../config/openConfig"
import wait from "../utils/wait"

export default async function authWizard() {
	const config = await loadConfig()
	let providerSpecificConfig: Record<string, string> = {}

	const providerOptions = [
		{ name: "Kilo Code", value: "kilocode" },
		{ name: "zAI", value: "zai" },
		{ name: "Other", value: "other" },
	] as const
	type ProviderOption = (typeof providerOptions)[number]["value"]

	const { provider } = await inquirer.prompt<{ provider: ProviderOption; kilocodeToken: string }>([
		{
			type: "list",
			name: "provider",
			message: "Please select which provider you would like to use:",
			choices: providerOptions,
		},
	])

	switch (provider) {
		case "kilocode": {
			console.info(
				"\nPlease navigate to https://app.kilocode.ai and copy your API key from the bottom of the page!\n",
			)
			const { kilocodeToken } = await inquirer.prompt<{ kilocodeToken: string }>([
				{
					type: "password",
					name: "kilocodeToken",
					message: "API Key:",
				},
			])
			providerSpecificConfig = { kilocodeToken, kilocodeModel: "anthropic/claude-sonnet-4.5" }
			break
		}
		case "zai": {
			const { zaiApiKey } = await inquirer.prompt<{ zaiApiKey: string }>([
				{
					type: "password",
					name: "zaiApiKey",
					message: "Please enter your zAI token:",
				},
			])
			providerSpecificConfig = { zaiApiKey }
			break
		}
		case "other": {
			console.info("Please manually add your provider setttings to the config file.")
			console.info(
				"Check out https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md to see potential configuration options",
			)
			await wait(1500)
			await openConfigFile()
			return
		}
	}

	const newConfig = {
		...config.config,
		providers: [
			{
				id: "default",
				provider,
				...providerSpecificConfig,
			},
		],
	}

	await saveConfig(newConfig as CLIConfig)
}
