import { describe, expect, it } from "bun:test"
import { CloudRepositoryUnavailableError, resolveCloudRepository } from "../../src/agent-manager/cloud-agent/repository"

describe("resolveCloudRepository", () => {
  it("normalizes supported HTTPS and protocol-account SSH origins for the worker", async () => {
    const cases = [
      [
        "https://github.com/Kilo-Org/kilocode.git",
        {
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          label: "github.com/Kilo-Org/kilocode",
          name: "Kilo-Org/kilocode",
          gitUrl: "https://github.com/kilo-org/kilocode",
        },
      ],
      [
        "https://GITHUB.COM/Kilo-Org/kilocode.git",
        {
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          label: "github.com/Kilo-Org/kilocode",
          name: "Kilo-Org/kilocode",
          gitUrl: "https://github.com/kilo-org/kilocode",
        },
      ],
      [
        "git@github.com:Kilo-Org/kilocode.git",
        {
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          label: "github.com/Kilo-Org/kilocode",
          name: "Kilo-Org/kilocode",
          gitUrl: "https://github.com/kilo-org/kilocode",
        },
      ],
      [
        "ssh://git@GITHUB.COM/Kilo-Org/kilocode.git",
        {
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          label: "github.com/Kilo-Org/kilocode",
          name: "Kilo-Org/kilocode",
          gitUrl: "https://github.com/kilo-org/kilocode",
        },
      ],
      [
        "https://gitlab.com/Kilo-Org/platform/kilocode.git",
        {
          repository: { type: "gitlab", url: "https://gitlab.com/Kilo-Org/platform/kilocode.git" },
          label: "gitlab.com/Kilo-Org/platform/kilocode",
          name: "Kilo-Org/platform/kilocode",
          gitUrl: "https://gitlab.com/kilo-org/platform/kilocode",
        },
      ],
      [
        "git@gitlab.com:Kilo-Org/platform/kilocode.git",
        {
          repository: { type: "gitlab", url: "https://gitlab.com/Kilo-Org/platform/kilocode.git" },
          label: "gitlab.com/Kilo-Org/platform/kilocode",
          name: "Kilo-Org/platform/kilocode",
          gitUrl: "https://gitlab.com/kilo-org/platform/kilocode",
        },
      ],
      [
        "ssh://git@GITLAB.COM/Kilo-Org/platform/kilocode.git",
        {
          repository: { type: "gitlab", url: "https://gitlab.com/Kilo-Org/platform/kilocode.git" },
          label: "gitlab.com/Kilo-Org/platform/kilocode",
          name: "Kilo-Org/platform/kilocode",
          gitUrl: "https://gitlab.com/kilo-org/platform/kilocode",
        },
      ],
    ] as const

    for (const [remote, expected] of cases) {
      expect(await resolveCloudRepository("/repo", async () => remote)).toEqual(expected)
    }
  })

  it("resolves the exact workspace origin remote", async () => {
    const calls: Array<[string, string | undefined]> = []
    await resolveCloudRepository("/selected-workspace", async (cwd, remote) => {
      calls.push([cwd, remote])
      return "https://github.com/kilo-org/kilocode.git"
    })

    expect(calls).toEqual([["/selected-workspace", "origin"]])
  })

  it("rejects missing workspace and origin context", async () => {
    await expect(
      resolveCloudRepository(undefined, async () => "https://github.com/kilo-org/kilocode.git"),
    ).rejects.toThrow("workspace repository")
    await expect(resolveCloudRepository("/repo", async () => undefined)).rejects.toThrow("origin remote")
  })

  it("classifies missing and unsupported repository context as expected unavailability", async () => {
    const missing = await resolveCloudRepository(undefined, async () => undefined).catch((err) => err)
    const unsupported = await resolveCloudRepository("/repo", async () => "https://example.com/acme/repo.git").catch(
      (err) => err,
    )

    expect(missing).toBeInstanceOf(CloudRepositoryUnavailableError)
    expect(unsupported).toBeInstanceOf(CloudRepositoryUnavailableError)
  })

  it("propagates origin lookup failures as operational errors", async () => {
    const error = await resolveCloudRepository("/repo", async () => {
      throw new Error("git unavailable")
    }).catch((err) => err)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(CloudRepositoryUnavailableError)
    expect(error.message).toBe("git unavailable")
  })

  it("rejects credentials, URL decorations, arbitrary hosts, and invalid paths", async () => {
    const remotes = [
      "https://user@github.com/Kilo-Org/kilocode.git",
      "https://user:secret@gitlab.com/Kilo-Org/kilocode.git",
      "https://github.com/kilo-org/kilocode.git?token=secret",
      "https://gitlab.com/Kilo-Org/kilocode.git#main",
      "https://github.com:443/Kilo-Org/kilocode.git",
      "git@github.com/Kilo-Org/kilocode.git",
      "https://github.example.com/Kilo-Org/kilocode.git",
      "https://gitlab.example.com/Kilo-Org/kilocode.git",
      "https://example.com/Kilo-Org/kilocode.git",
      "ssh://user@github.com/Kilo-Org/kilocode.git",
      "ssh://git:secret@github.com/Kilo-Org/kilocode.git",
      "ssh://git@github.com:22/Kilo-Org/kilocode.git",
      "ssh://git@github.com/Kilo-Org/kilocode.git?token=secret",
      "ssh://git@gitlab.com/Kilo-Org/kilocode.git#main",
      "github.com:Kilo-Org/kilocode.git",
      "git@github.com:kilocode.git",
      "git@gitlab.com:Kilo-Org//kilocode.git",
      "https://github.com/Kilo-Org/../kilocode.git",
      "https://gitlab.com/Kilo-Org/kilocode/",
    ]

    for (const remote of remotes) {
      await expect(
        resolveCloudRepository("/repo", async () => remote),
        remote,
      ).rejects.toThrow("supported GitHub or GitLab")
    }
  })
})
