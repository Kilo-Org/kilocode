import { describe, it, expect } from "vitest"
import { normalizeGitUrl } from "../normalizeGitUrl"

describe("normalizeGitUrl", () => {
	describe("HTTPS URLs with credentials", () => {
		it("strips simple token from GitHub URL", () => {
			expect(normalizeGitUrl("https://ghp_xxxxxxxxxxxx@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})

		it("strips username:password credentials", () => {
			expect(normalizeGitUrl("https://username:password@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})

		it("strips OAuth2 style credentials (GitHub PAT)", () => {
			expect(normalizeGitUrl("https://oauth2:ghp_xxxxxxxxxxxxxxxxxxxx@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})

		it("strips GitLab CI token", () => {
			expect(normalizeGitUrl("https://gitlab-ci-token:glpat-xxxxxxxxxxxx@gitlab.com/org/repo.git")).toBe(
				"https://gitlab.com/org/repo.git",
			)
		})

		it("strips Bitbucket app password", () => {
			expect(normalizeGitUrl("https://x-token-auth:app_password_here@bitbucket.org/org/repo.git")).toBe(
				"https://bitbucket.org/org/repo.git",
			)
		})

		it("strips Azure DevOps PAT", () => {
			expect(normalizeGitUrl("https://pat:xxxxxxxxxx@dev.azure.com/org/project/_git/repo")).toBe(
				"https://dev.azure.com/org/project/_git/repo",
			)
		})

		it("handles URL-encoded special characters in credentials", () => {
			expect(normalizeGitUrl("https://user%40email:p%40ss%2Fword@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})
	})

	describe("HTTP URLs with credentials", () => {
		it("strips credentials from HTTP URLs", () => {
			expect(normalizeGitUrl("http://token@github.com/org/repo.git")).toBe("http://github.com/org/repo.git")
		})

		it("strips username:password from HTTP URLs", () => {
			expect(normalizeGitUrl("http://user:pass@localhost/repo.git")).toBe("http://localhost/repo.git")
		})
	})

	describe("HTTPS URLs without credentials", () => {
		it("returns unchanged when no credentials present", () => {
			expect(normalizeGitUrl("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git")
		})

		it("preserves URL without .git suffix", () => {
			expect(normalizeGitUrl("https://github.com/org/repo")).toBe("https://github.com/org/repo")
		})

		it("preserves URL with port", () => {
			expect(normalizeGitUrl("https://github.com:443/org/repo.git")).toBe("https://github.com/org/repo.git")
		})

		it("preserves URL with custom port", () => {
			expect(normalizeGitUrl("https://git.example.com:8443/org/repo.git")).toBe(
				"https://git.example.com:8443/org/repo.git",
			)
		})

		it("preserves query parameters", () => {
			expect(normalizeGitUrl("https://github.com/org/repo.git?ref=main")).toBe(
				"https://github.com/org/repo.git?ref=main",
			)
		})
	})

	describe("SSH URLs", () => {
		it("leaves git@host:path format unchanged", () => {
			expect(normalizeGitUrl("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git")
		})

		it("leaves ssh:// format unchanged", () => {
			expect(normalizeGitUrl("ssh://git@github.com/org/repo.git")).toBe("ssh://git@github.com/org/repo.git")
		})

		it("leaves GitLab SSH URL unchanged", () => {
			expect(normalizeGitUrl("git@gitlab.com:org/repo.git")).toBe("git@gitlab.com:org/repo.git")
		})

		it("leaves Bitbucket SSH URL unchanged", () => {
			expect(normalizeGitUrl("git@bitbucket.org:org/repo.git")).toBe("git@bitbucket.org:org/repo.git")
		})

		it("leaves SSH URL with custom user unchanged", () => {
			expect(normalizeGitUrl("deploy@git.example.com:org/repo.git")).toBe("deploy@git.example.com:org/repo.git")
		})

		it("leaves ssh:// URL with port unchanged", () => {
			expect(normalizeGitUrl("ssh://git@github.com:22/org/repo.git")).toBe("ssh://git@github.com:22/org/repo.git")
		})
	})

	describe("edge cases", () => {
		it("handles empty string", () => {
			expect(normalizeGitUrl("")).toBe("")
		})

		it("handles URL with only protocol", () => {
			expect(normalizeGitUrl("https://")).toBe("https://")
		})

		it("returns invalid URL unchanged", () => {
			expect(normalizeGitUrl("not-a-url")).toBe("not-a-url")
		})

		it("returns malformed HTTPS URL unchanged", () => {
			expect(normalizeGitUrl("https://[invalid")).toBe("https://[invalid")
		})

		it("handles file:// protocol unchanged", () => {
			expect(normalizeGitUrl("file:///path/to/repo.git")).toBe("file:///path/to/repo.git")
		})

		it("handles git:// protocol unchanged", () => {
			expect(normalizeGitUrl("git://github.com/org/repo.git")).toBe("git://github.com/org/repo.git")
		})

		it("handles localhost URLs with credentials", () => {
			expect(normalizeGitUrl("https://user:pass@localhost:3000/repo.git")).toBe("https://localhost:3000/repo.git")
		})

		it("handles IP address URLs with credentials", () => {
			expect(normalizeGitUrl("https://token@192.168.1.100/repo.git")).toBe("https://192.168.1.100/repo.git")
		})

		it("preserves trailing slash", () => {
			expect(normalizeGitUrl("https://github.com/org/repo/")).toBe("https://github.com/org/repo/")
		})

		it("handles deeply nested paths", () => {
			expect(normalizeGitUrl("https://token@github.com/org/group/subgroup/repo.git")).toBe(
				"https://github.com/org/group/subgroup/repo.git",
			)
		})
	})

	describe("credentials with special characters", () => {
		it("handles token with special characters", () => {
			expect(normalizeGitUrl("https://ghp_abc123XYZ@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})

		it("handles password with colon", () => {
			// Colon in password would be URL-encoded as %3A
			expect(normalizeGitUrl("https://user:pass%3Aword@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})

		it("handles username with @ symbol (URL-encoded)", () => {
			expect(normalizeGitUrl("https://user%40domain.com:pass@github.com/org/repo.git")).toBe(
				"https://github.com/org/repo.git",
			)
		})
	})
})
