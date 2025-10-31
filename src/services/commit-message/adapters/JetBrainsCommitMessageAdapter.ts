// kilocode_change - new file
import { ICommitMessageAdapter } from "./ICommitMessageAdapter"
import { ICommitMessageIntegration } from "./ICommitMessageIntegration"
import { CommitMessageRequest, CommitMessageResult } from "../types/core"
import { CommitMessageGenerator } from "../CommitMessageGenerator"
import { CommitMessageOrchestrator } from "../CommitMessageOrchestrator"

export class JetBrainsCommitMessageAdapter implements ICommitMessageAdapter {
	private orchestrator: CommitMessageOrchestrator

	constructor(private messageGenerator: CommitMessageGenerator) {
		this.orchestrator = new CommitMessageOrchestrator()
	}

	async generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult> {
		const integration: ICommitMessageIntegration = {
			// JetBrains doesn't need progress reporting or messages - handled externally
			// Just need to handle the final result
			handleResult: async (result: CommitMessageResult) => {
				// JetBrains handles the result externally - no UI integration needed here
				// The result is returned to the calling Kotlin code
			},
		}

		return this.orchestrator.generateCommitMessage(request, integration, this.messageGenerator)
	}

	public dispose(): void {
		// No resources to dispose for JetBrains adapter
	}
}
