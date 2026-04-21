---
title: "Team Registry"
description: "Publish, install, and verify signed team manifests with Ed25519 signatures and explicit publisher trust management."
---

# Team Registry

## Overview

The Team Registry lets you publish a team configuration as a cryptographically signed manifest file, then distribute it to colleagues or install it from a URL or local path. Unlike the basic [Team Portability](/docs/collaborate/teams/team-portability) export/import flow — which verifies integrity via a SHA-256 checksum but not authenticity — a registry manifest carries an **Ed25519 signature** that proves the manifest was created by a specific private key. Recipients pin that public key to their local trust store before installing; any tampering between publish and install invalidates the signature.

The security model is explicit key pinning with no Trust-On-First-Use (TOFU). You decide which publishers you trust before accepting their manifests.

## Quick Start

```bash
# 1. Generate a key pair (one time, keep the private key secret)
openssl genpkey -algorithm ed25519 -out my-team.key
openssl pkey -in my-team.key -pubout -out my-team.pub

# 2. Publish your active team as a signed manifest
team publish ./my-team.manifest.json \
  --name="Frontend Team" \
  --author="alice@example.com" \
  --version=1.0.0 \
  --sign=my-team.key

# 3. On the recipient machine: trust the publisher, then install
team trust my-team.pub 550e8400-e29b-41d4-a716-446655440000
team install ./my-team.manifest.json
```

All commands are entered at the `workflow>` prompt inside Devil Code.

## Generating Keys

Ed25519 keys are required for signing. Generate a key pair using OpenSSL:

```bash
# Generate private key (PKCS#8 PEM format)
openssl genpkey -algorithm ed25519 -out publisher.key

# Extract public key (SPKI PEM format)
openssl pkey -in publisher.key -pubout -out publisher.pub
```

Keep `publisher.key` secret — it never leaves your machine. Distribute `publisher.pub` to anyone who will install your manifests.

The publisher ID is a UUID you choose to identify yourself. You can generate one with:

```bash
python3 -c "import uuid; print(uuid.uuid4())"
# or
node -e "console.log(require('crypto').randomUUID())"
```

## team publish

Packages the active team configuration into a signed manifest file.

**Syntax**:

```
team publish <path> --name=<name> --author=<author> --version=<version> [--sign=<keyfile>] [--publisher-id=<uuid>]
```

| Argument | Required | Description |
|---|---|---|
| `<path>` | Yes | Output file path for the manifest (e.g. `./team.manifest.json`) |
| `--name` | Yes | Human-readable name for the team (e.g. `"Frontend Squad"`) |
| `--author` | Yes | Author identifier, typically an email address |
| `--version` | Yes | Semantic version string (`MAJOR.MINOR.PATCH`, e.g. `1.0.0`) |
| `--sign` | No | Path to the Ed25519 private key file. Omit to publish unsigned. |
| `--publisher-id` | No | UUID identifying the publisher. Defaults to a placeholder UUID if omitted. |

**Examples**:

```bash
# Signed manifest — recommended for distribution
team publish ~/releases/myteam-v1.manifest.json \
  --name="Backend Squad" \
  --author="platform@example.com" \
  --version=1.2.0 \
  --sign=~/.keys/platform.key

# Unsigned manifest — useful for local sharing where authenticity is established out-of-band
team publish /tmp/team-snapshot.manifest.json \
  --name="Dev Snapshot" \
  --author="dev@example.com" \
  --version=0.1.0
```

On success, a toast shows the resolved output path and whether the manifest is signed.

## team install

Fetches a manifest from a URL or local file path, verifies its signature against the trust store, and applies the team configuration.

**Syntax**:

```
team install <url-or-path> [--require-signature]
```

| Argument | Description |
|---|---|
| `<url-or-path>` | HTTPS URL or absolute/relative file path to the manifest JSON |
| `--require-signature` | Optional. Reject the manifest if it is unsigned; a missing signature becomes a hard error instead of a warning |

**Examples**:

```bash
# Install from a local file
team install ./downloads/backend-squad.manifest.json

# Install from a URL (HTTPS)
team install https://releases.example.com/teams/backend-squad-v1.manifest.json

# Install an unsigned manifest (will warn but proceed)
team install /shared/team-unsigned.manifest.json

# Require a valid signature — unsigned manifests are rejected
team install https://releases.example.com/teams/backend-squad-v1.manifest.json --require-signature
```

**What happens during install**:

1. The manifest is fetched (HTTP or local file read).
2. The JSON is parsed and validated against the `TeamRegistryManifest` schema.
3. If the manifest is signed:
   a. The publisher ID is looked up in your local trust store.
   b. If not trusted, install is rejected with a `Publisher not trusted` error.
   c. If trusted, the Ed25519 signature is verified against the pinned public key.
   d. If the signature is invalid (tampered manifest), install is rejected.
4. If the manifest is unsigned, a warning is shown but install proceeds (unless you pass `--require-signature`).
5. The embedded team configuration is activated.

## team trust

Adds a publisher's public key to your local trust store. This is a prerequisite for installing their signed manifests.

**Syntax**:

```
team trust <keyfile> <publisher-id>
```

| Argument | Description |
|---|---|
| `<keyfile>` | Path to the publisher's Ed25519 public key file (PEM format) |
| `<publisher-id>` | UUID identifying the publisher (provided by the manifest author) |

**Example**:

```bash
# Trust the platform team's public key
team trust ~/keys/platform-team.pub 550e8400-e29b-41d4-a716-446655440001

# Trust a colleague's key
team trust ./alice.pub 6ba7b810-9dad-11d1-80b4-00c04fd430c8
```

The trust store is stored at `~/.local/share/kilo/registry/trusted-publishers.json`. Each entry maps a publisher UUID to their public key and the timestamp when trust was granted.

## team untrust

Removes a publisher from your local trust store. Future install attempts for manifests signed by this publisher will be rejected.

**Syntax**:

```
team untrust <publisher-id>
```

**Example**:

```bash
# Revoke trust for a publisher
team untrust 550e8400-e29b-41d4-a716-446655440001
```

If the publisher ID is not in the trust store, a warning is shown and no error is raised.

## Manifest Format

A `TeamRegistryManifest` is a JSON file with the following top-level fields:

| Field | Type | Description |
|---|---|---|
| `manifestVersion` | `"1.0"` | Schema version — always `"1.0"` for current releases |
| `envelope` | object | Versioned wrapper containing the team config and its SHA-256 checksum |
| `metadata` | object | Descriptive fields: name, author, publisher ID, version, publishedAt |
| `signature` | string (optional) | Base64-encoded Ed25519 signature over the stable-sorted `envelope` + `metadata` |

**Envelope fields**:

| Field | Type | Description |
|---|---|---|
| `version` | string | Team config schema version (e.g. `"1.1.0"`) |
| `checksum` | hex string (64 chars) | SHA-256 of the canonicalized team config |
| `config` | object | The full team configuration (roles, routing, reactions, workflow overrides) |
| `exportedAt` | ISO 8601 datetime | When the manifest was published |

**Metadata fields**:

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name for the team |
| `author` | string | Publisher identity (typically an email address) |
| `publisherId` | UUID | Stable identifier that links the manifest to a trust store entry |
| `version` | semver string | Manifest version (`MAJOR.MINOR.PATCH`) |
| `publishedAt` | ISO 8601 datetime | Publication timestamp |
| `license` | string (optional) | License identifier (e.g. `MIT`) |
| `description` | string (optional) | Human-readable description |
| `tags` | string array (optional) | Searchable tags |
| `homepage` | URL (optional) | Project homepage |
| `repository` | URL (optional) | Source repository |

## Security Model

**Ed25519 signatures**

The signature covers a deterministic, stable-sorted JSON serialization of the entire `envelope` and `metadata` objects. This means any modification to any field — including the team config, checksum, version, author, or timestamp — invalidates the signature. An attacker who intercepts the manifest file cannot modify it and forge a valid signature without the private key.

**Explicit key pinning — no TOFU**

Devil Code does not automatically trust new publishers on first use. You must explicitly run `team trust <keyfile> <publisher-id>` before installing a signed manifest. This prevents a compromised distribution channel from silently replacing a manifest with one signed by an attacker's key.

**Trust store isolation**

The trust store (`~/.local/share/kilo/registry/trusted-publishers.json`) is a local file under your control. It is never updated automatically. Removing a publisher with `team untrust` immediately prevents their future manifests from being installed, even if the manifests are cryptographically valid.

**Unsigned manifest warnings**

Installing an unsigned manifest is permitted by default (to support local development workflows), but Devil Code always displays a warning: `Manifest is unsigned — authenticity not verified`. In security-sensitive environments, treat unsigned manifest installation as a policy violation.

**Signature payload coverage**

The signature covers both `envelope` and `metadata`, so the following tampering attacks are detected:

- Modified team config (roles, routing, capabilities)
- Modified version number
- Modified publisher identity fields (name, author)
- Modified checksum or timestamp

## Troubleshooting

**"Publisher not trusted: `<uuid>`. Use 'team trust' to add them."**

The manifest's `publisherId` is not in your trust store. Obtain the publisher's public key file out-of-band and run:

```bash
team trust <keyfile> <publisher-id>
```

**"Signature verification failed"**

The signature in the manifest does not verify against the public key stored for that publisher. Causes:

1. The manifest was tampered with after signing (MITM attack or accidental modification).
2. You trusted a different key for this publisher than the one that signed the manifest.
3. The manifest was signed with a different private key than the one corresponding to the trusted public key.

Re-obtain the manifest directly from the publisher and confirm the public key is correct.

**"Manifest is unsigned — authenticity not verified"**

The manifest has no `signature` field. The team config will be installed, but you cannot verify the manifest came from the claimed author. For production use, request a signed manifest from the publisher.

**"Invalid manifest: Manifest from ... failed schema validation"**

The file does not conform to the `TeamRegistryManifest` schema. Possible causes: the file was created by an incompatible version of Devil Code, the JSON was manually edited incorrectly, or the file is corrupted. Re-export from a current Devil Code install.

**"Failed to fetch manifest: ..."**

For URL-based installs, the server returned a non-200 response or the connection timed out (default timeout: 30 seconds). Check that the URL is correct and the server is reachable.
