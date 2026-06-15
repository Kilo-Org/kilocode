#!/usr/bin/env bun
/**
 * Generate RSA key pair and signed offline license JSON (Phase 1 prototype).
 * Usage: bun deploy/enterprise/scripts/gen-offline-license.mjs [--out-dir deploy/enterprise/samples]
 */
import { generateKeyPairSync, createSign, createVerify } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = process.argv.includes("--out-dir")
  ? process.argv[process.argv.indexOf("--out-dir") + 1]
  : join(root, "samples")

const key = process.argv.find((a) => a.startsWith("--key="))?.slice(6) ?? "enterprise-offline-demo"
const expires =
  process.argv.find((a) => a.startsWith("--expires="))?.slice(10) ?? "2027-12-31T23:59:59.000Z"

const payload = { expiresAt: expires, key }
const canonical = JSON.stringify(payload)

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const signer = createSign("RSA-SHA256")
signer.update(canonical)
signer.end()
const signature = signer.sign(privateKey, "base64")

const verifier = createVerify("RSA-SHA256")
verifier.update(canonical)
verifier.end()
if (!verifier.verify(publicKey, signature, "base64")) {
  console.error("self-verify failed")
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

const license = { key, expiresAt: expires, signature, algorithm: "RSA-SHA256" }
writeFileSync(join(outDir, "offline-license.signed.json"), JSON.stringify(license, null, 2) + "\n")
writeFileSync(join(outDir, "license-dev-public.pem"), publicKey)
writeFileSync(join(outDir, "license-dev-private.pem"), privateKey)
writeFileSync(join(outDir, ".gitignore"), "license-dev-private.pem\n")

console.log("Wrote:")
console.log(" ", join(outDir, "offline-license.signed.json"))
console.log(" ", join(outDir, "license-dev-public.pem"))
console.log(" ", join(outDir, "license-dev-private.pem"), "(local only — listed in .gitignore)")
