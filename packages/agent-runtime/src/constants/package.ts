import pkg from "../../package.json" with { type: "json" }

export const Package = {
	name: pkg.name,
	version: pkg.version,
}
