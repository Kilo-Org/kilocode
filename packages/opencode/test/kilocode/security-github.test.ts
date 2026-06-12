import { describe, expect, test } from "bun:test"
import { GitHubSecurity } from "@/kilocode/security/github"

describe("GitHubSecurity.attachment", () => {
  test("accepts canonical GitHub attachment URLs", () => {
    expect(
      GitHubSecurity.attachment("https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000"),
    ).toBe("https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000")
    expect(GitHubSecurity.attachment("https://github.com/user-attachments/files/12345/report%20final.txt")).toBe(
      "https://github.com/user-attachments/files/12345/report%20final.txt",
    )
  })

  test.each([
    "https://github.com/user-attachments/assets/../../settings/profile",
    "https://github.com/user-attachments/assets/%2e%2e/%2e%2e/settings/profile",
    "https://github.com/user-attachments/files/12345/%2Fsettings",
    "https://github.com/user-attachments/files/12345/folder/report.txt",
    "https://github.com/user-attachments/assets/not-a-uuid",
    "https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000?download=1",
    "https://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000#fragment",
    "https://example.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000",
    "http://github.com/user-attachments/assets/123e4567-e89b-12d3-a456-426614174000",
    "not a URL",
  ])("rejects non-canonical attachment URL %s", (url) => {
    expect(GitHubSecurity.attachment(url)).toBeUndefined()
  })
})
