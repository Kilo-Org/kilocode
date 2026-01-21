const ESCAPED_DOLLAR_TOKEN = "__KC_ESCAPED_DOLLAR__"

export function expandSlashCommandTemplate(template: string, args: string[]): string {
	const escaped = template.replace(/\\\$/g, ESCAPED_DOLLAR_TOKEN)
	const withArguments = escaped.replace(/\$ARGUMENTS\b/g, args.join(" "))
	const withPositionals = withArguments.replace(/\$(\d+)/g, (_match, index) => {
		const position = Number(index) - 1
		if (Number.isNaN(position) || position < 0) {
			return ""
		}
		return args[position] ?? ""
	})

	return withPositionals.replace(new RegExp(ESCAPED_DOLLAR_TOKEN, "g"), "$")
}
