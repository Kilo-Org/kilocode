// Reference: https://github.com/SukkaW/react-compiler-webpack

import fs from "node:fs"
import babel from "@babel/core"
import BabelPluginReactCompiler from "babel-plugin-react-compiler"

/** @returns {import('esbuild').Plugin} */
export function reactCompiler(options = {}) {
	const filter = options.filter || /\.[jt]sx$/
	const reactCompilerConfig = options.reactCompilerConfig || {}

	function b64enc(b) {
		// eslint-disable-next-line no-undef
		return Buffer.from(b).toString("base64")
	}

	function toUrl(map) {
		return "data:application/json;charset=utf-8;base64," + b64enc(JSON.stringify(map))
	}

	return {
		name: "react-compiler",
		setup({ onLoad }) {
			onLoad({ filter }, async (args) => {
				let input = await fs.promises.readFile(args.path, "utf8")
				let result = await babel.transformAsync(input, {
					filename: args.path,
					plugins: [[BabelPluginReactCompiler, reactCompilerConfig]],
					parserOpts: {
						plugins: ["jsx", "typescript"],
					},
					ast: false,
					sourceMaps: true,
					configFile: false,
					babelrc: false,
				})
				if (result == null) {
					return { errors: [{ text: "babel.transformAsync with react compiler plugin returns null" }] }
				}
				const { code, map } = result
				return { contents: `${code}\n//# sourceMappingURL=${toUrl(map)}`, loader: "default" }
			})
		},
	}
}

export default reactCompiler
