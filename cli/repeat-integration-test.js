/* global console performance process */
import { execSync } from "child_process"

const runs = 500
let failures = 0
let durations = []

function cleanup() {
	console.log(`\nResults: ${failures} failures out of ${runs} runs`)
	console.log(`Success rate: ${(((runs - failures) / runs) * 100).toFixed(1)}%`)
	console.log(`Average duration: ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)}s`)
}

for (let i = 1; i <= runs; i++) {
	const startedAt = performance.now()
	process.stdout.write(`--- Run ${i}/${runs} --- `)

	try {
		execSync("pnpm test:integration ./integration-tests/simple-file-operations.test.ts", {
			stdio: "pipe",
		})
		process.stdout.write(`✅ passed`)
	} catch (error) {
		process.stdout.write(`❌ Run ${i} failed`)

		console.log(error.stdout.toString())

		failures++
	} finally {
		const duration = (performance.now() - startedAt) / 1000
		durations.push(duration)
		console.log(` in: ${duration.toFixed(2)}s`)
	}
}

cleanup()

process.exit(failures === 0 ? 0 : 1)
