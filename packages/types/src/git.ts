export interface GitRepositoryInfo {
	repositoryUrl?: string
	repositoryName?: string
	defaultBranch?: string
}

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}
