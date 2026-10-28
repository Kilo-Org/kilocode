// Kilo's release variables for the v2 build and publish scripts.
//
// Upstream's release library (`@opencode/script`, packages/script/src/index.ts) reads OPENCODE_CHANNEL,
// OPENCODE_VERSION, OPENCODE_BUMP and OPENCODE_RELEASE when it loads. v1 Kilo names them KILO_CHANNEL, KILO_VERSION,
// KILO_BUMP and KILO_RELEASE. This module copies each set KILO_ name to its OPENCODE_ name, so the Kilo names work
// without a patch in the upstream file. The Kilo name wins when both are set. Import it before `@opencode/script`:
// ES modules evaluate their imports in order. Child processes inherit the result.
for (const name of ["CHANNEL", "VERSION", "BUMP", "RELEASE"]) {
  const value = process.env[`KILO_${name}`]
  if (value !== undefined) process.env[`OPENCODE_${name}`] = value
}
