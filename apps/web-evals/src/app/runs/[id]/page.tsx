import { findRun } from "@roo-code/evals"

import { Run } from "./run"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const run = await findRun(Number(id))

	return (
		<div className="w-full px-6 py-12">
			<Run run={run} />
		</div>
	)
}
