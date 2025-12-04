import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ManagedIndexerStatus } from "../ManagedIndexerStatus"

describe("ManagedIndexerStatus", () => {
	it("should show message when no workspace folders", () => {
		render(<ManagedIndexerStatus workspaceFolders={[]} />)
		expect(screen.getByText(/No workspace folders found/i)).toBeInTheDocument()
	})

	it("should render workspace folder with basic info", () => {
		const folders = [
			{
				workspaceFolderPath: "/test/path",
				workspaceFolderName: "test-project",
				gitBranch: "main",
				projectId: "proj-123",
				isIndexing: false,
				hasManifest: true,
				manifestFileCount: 42,
				hasWatcher: true,
			},
		]

		render(<ManagedIndexerStatus workspaceFolders={folders} />)

		expect(screen.getByText("test-project")).toBeInTheDocument()
		expect(screen.getByText("main")).toBeInTheDocument()
		expect(screen.getByText("42")).toBeInTheDocument()
		expect(screen.getByText("Ready")).toBeInTheDocument()
	})

	it("should show indexing status when indexing", () => {
		const folders = [
			{
				workspaceFolderPath: "/test/path",
				workspaceFolderName: "test-project",
				gitBranch: "feature/new",
				projectId: "proj-123",
				isIndexing: true,
				hasManifest: false,
				manifestFileCount: 0,
				hasWatcher: true,
			},
		]

		render(<ManagedIndexerStatus workspaceFolders={folders} />)

		expect(screen.getByText("Indexing")).toBeInTheDocument()
	})

	it("should show error state with error message", () => {
		const folders = [
			{
				workspaceFolderPath: "/test/path",
				workspaceFolderName: "test-project",
				gitBranch: "main",
				projectId: "proj-123",
				isIndexing: false,
				hasManifest: false,
				manifestFileCount: 0,
				hasWatcher: false,
				error: {
					type: "manifest",
					message: "Failed to fetch manifest",
					timestamp: new Date().toISOString(),
					context: {
						operation: "fetch-manifest",
						branch: "main",
					},
				},
			},
		]

		render(<ManagedIndexerStatus workspaceFolders={folders} />)

		expect(screen.getByText("Error")).toBeInTheDocument()
		expect(screen.getByText("MANIFEST ERROR")).toBeInTheDocument()
		expect(screen.getByText("Failed to fetch manifest")).toBeInTheDocument()
		expect(screen.getByText(/Operation: fetch-manifest/i)).toBeInTheDocument()
	})

	it("should render multiple workspace folders", () => {
		const folders = [
			{
				workspaceFolderPath: "/test/path1",
				workspaceFolderName: "project-1",
				gitBranch: "main",
				projectId: "proj-1",
				isIndexing: false,
				hasManifest: true,
				manifestFileCount: 10,
				hasWatcher: true,
			},
			{
				workspaceFolderPath: "/test/path2",
				workspaceFolderName: "project-2",
				gitBranch: "develop",
				projectId: "proj-2",
				isIndexing: true,
				hasManifest: true,
				manifestFileCount: 25,
				hasWatcher: true,
			},
		]

		render(<ManagedIndexerStatus workspaceFolders={folders} />)

		expect(screen.getByText("project-1")).toBeInTheDocument()
		expect(screen.getByText("project-2")).toBeInTheDocument()
		expect(screen.getByText("main")).toBeInTheDocument()
		expect(screen.getByText("develop")).toBeInTheDocument()
	})

	it("should show standby status when not indexing and no manifest", () => {
		const folders = [
			{
				workspaceFolderPath: "/test/path",
				workspaceFolderName: "test-project",
				gitBranch: "main",
				projectId: "proj-123",
				isIndexing: false,
				hasManifest: false,
				manifestFileCount: 0,
				hasWatcher: true,
			},
		]

		render(<ManagedIndexerStatus workspaceFolders={folders} />)

		expect(screen.getByText("Standby")).toBeInTheDocument()
	})
})
