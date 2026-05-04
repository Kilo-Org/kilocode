---
title: "Pre-installed Software"
description: "Default system utilities, languages, and CLI tools included in the KiloClaw Docker image"
---

# Pre-installed Software

Every KiloClaw instance ships with a curated set of system utilities, language runtimes, package managers, and CLI tools. This page documents everything that comes pre-installed in the KiloClaw Docker image so you know what's available out of the box. Where a specific version is listed it reflects the pin in the Dockerfile as of March 2026. Entries marked **unpinned** install the latest available version at image build time and may differ between releases.

## Base Image

KiloClaw is built on **Debian Bookworm** (`debian:bookworm-slim`). Since it's Debian-based, you can use `apt` to install additional packages at any time:

```bash
apt update && apt install -y <package>
```

{% callout type="info" %}
Packages installed via `apt` do not persist across redeploys. If you need a package to survive redeploys, install it from a cron job or startup script on the persistent volume.
{% /callout %}

## System Utilities

The following packages are installed via `apt` on top of the base image:

| Package | Description |
|---|---|
| `ca-certificates` | Root CA certificates for TLS verification |
| `curl` | HTTP client |
| `gnupg` | GPG encryption and signing |
| `git` | Version control |
| `unzip` | Archive extraction |
| `jq` | JSON processor |
| `ripgrep` | Fast recursive search (`rg`) |
| `rsync` | File synchronization |
| `zstd` | Zstandard compression |
| `build-essential` | GCC, make, and core build tools |
| `python3` | Python 3 interpreter (system default) |
| `ffmpeg` | Audio/video processing |
| `tmux` | Terminal multiplexer |

## Browser

| Tool | Description |
|---|---|
| Headless Chromium | Built-in browser for web browsing, screenshots, and CDP automation. Works with OpenClaw's browser tool out of the box. Requires the "full" tool profile. |

## Languages & Runtimes

| Language / Runtime | Version | Install Method |
|---|---|---|
| Node.js | 22.13.1 | Binary tarball (primary runtime) |
| Go | 1.26.0 | Binary tarball |
| Bun | 1.2.4 | Install script |
| Python 3 | Unpinned (Debian Bookworm default) | `apt` |

## Package Managers

These package managers are available for installing libraries and dependencies:

| Manager | Included Via |
|---|---|
| `npm` | Bundled with Node.js |
| `pnpm` | Installed via `npm` |
| `bun` | Bundled with Bun |

## CLI Tools

| Tool | Version / Source |
|---|---|
| GitHub CLI (`gh`) | Unpinned (GitHub apt repo) |
| 1Password CLI (`op`) | 2.32.1 (1Password apt repo) |

## npm Global Packages

The following packages are installed globally via `npm`:

| Package | Version |
|---|---|
| ClawHub CLI (`clawhub`) | Unpinned |
| mcporter | 0.7.3 |
| `@steipete/summarize` | 0.11.1 |

## OpenClaw Skills & Integrations

| Tool | Description |
|---|---|
| gog (gogcli) | Google Workspace CLI — Gmail, Calendar, Drive, Contacts, Sheets, Docs |
| blogwatcher | Monitor blogs and RSS/Atom feeds for updates |
| xurl | Authenticated requests to the X (Twitter) API |
| gifgrep | Search GIF providers, download results, extract stills |
| summarize | Summarize or extract text/transcripts from URLs and files |
| goplaces | Location and places lookup |

## Installing Additional Tools

Your agent can install additional tools at runtime:

- **Go packages:** `go install github.com/example/tool@latest`
- **Node packages:** `npm install -g <package>`
- **Python packages:** `pip install <package>`

{% callout type="tip" %}
These tools receive updates when you **Upgrade & Redeploy** your instance from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy). Check the changelog for image update announcements.
{% /callout %}

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Machine Specs](/docs/kiloclaw/dashboard#machine-specs)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)
