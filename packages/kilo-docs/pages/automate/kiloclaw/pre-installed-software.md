---
title: "Pre-installed Software"
description: "Default system utilities, languages, and CLI tools included in the KiloClaw Docker image"
---

# Pre-installed Software

Every KiloClaw instance ships with a curated set of system utilities, language runtimes, package managers, and CLI tools. This page documents everything that comes pre-installed in the KiloClaw Docker image so you know what's available out of the box.

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

| Package           | Description                               |
| ----------------- | ----------------------------------------- |
| `ca-certificates` | Root CA certificates for TLS verification |
| `curl`            | HTTP client                               |
| `gnupg`           | GPG encryption and signing                |
| `git`             | Version control                           |
| `unzip`           | Archive extraction                        |
| `jq`              | JSON processor                            |
| `ripgrep`         | Fast recursive search (`rg`)              |
| `rsync`           | File synchronization                      |
| `zstd`            | Zstandard compression                     |
| `build-essential` | GCC, make, and core build tools           |
| `python3`         | Python 3 interpreter (system default)     |
| `ffmpeg`          | Audio/video processing                    |
| `tmux`            | Terminal multiplexer                      |

## Languages & Runtimes

| Language / Runtime        | Version        | Install Method                   |
| ------------------------- | -------------- | -------------------------------- |
| Node.js                   | 22.13.1        | Binary tarball (primary runtime) |
| Go                        | 1.26.0         | Binary tarball                   |
| Python 3                  | System default | `apt` (Debian Bookworm)          |
| Rust (`rustup` + `cargo`) | Latest stable  | `rustup` installer               |

## Package Managers

These package managers are available for installing libraries and dependencies:

| Manager | Included Via                     |
| ------- | -------------------------------- |
| `npm`   | Bundled with Node.js             |
| `pip3`  | Bundled with Python 3            |
| `cargo` | Installed with Rust via `rustup` |

## CLI Tools & Utilities

A broad set of CLI tools is pre-installed for cloud operations, infrastructure management, and DevOps workflows:

| Tool                 | Version / Source                   |
| -------------------- | ---------------------------------- |
| GitHub CLI (`gh`)    | Latest from GitHub apt repo        |
| GitLab CLI (`glab`)  | Latest from GitLab apt repo        |
| AWS CLI v2           | Latest installer                   |
| `kubectl`            | Latest stable                      |
| Helm                 | Latest via `get-helm-3` script     |
| Terraform            | Latest from HashiCorp apt repo     |
| OpenTofu             | Latest from OpenTofu apt repo      |
| Docker CLI + Buildx  | Latest from Docker apt repo        |
| Trivy                | Latest from Aqua Security apt repo |
| 1Password CLI (`op`) | Latest from 1Password apt repo     |
| Rclone               | Latest via `rclone` install script |

{% callout type="tip" %}
Most of these tools receive updates when you **Upgrade & Redeploy** your instance from the [KiloClaw Dashboard](/docs/automate/kiloclaw/dashboard#redeploy). Check the changelog for image update announcements.
{% /callout %}

## Related

- [KiloClaw Overview](/docs/automate/kiloclaw/overview)
- [Dashboard Reference](/docs/automate/kiloclaw/dashboard)
- [Machine Specs](/docs/automate/kiloclaw/dashboard#machine-specs)
- [Troubleshooting](/docs/automate/kiloclaw/troubleshooting)
