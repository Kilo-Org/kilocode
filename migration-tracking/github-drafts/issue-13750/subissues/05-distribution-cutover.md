# Complete distribution and safe migration cutover

## Outcome

Turn validated local preview mechanics into an accepted distribution and migration path.

## Scope

Portable payloads, update/rollback, signing, platforms, clean installation, explicit import and canary cutover.

## Current position

Real local directory update/rollback and supported copy-import paths are covered. Production archives, signing and hosted distribution are not accepted.

## Acceptance

- [ ] Complete Kilo CI and build hardening, including reproducible package and client builds.
- [ ] Complete a safe production payload format and its integrity/ownership boundaries.
- [ ] Verify update and rollback with actual supported platform artifacts.
- [ ] Complete signing/notarization and distribution automation where required.
- [ ] Verify clean install and source build dependency resolution.
- [ ] Exercise opt-in database/config/credential import while preserving v1 originals.
- [ ] Verify isolated canary and a documented production cutover/rollback procedure.

## Dependencies and boundaries

External publishing and platform acceptance require their own execution authorization.

## Tracking

Update the affected rows in `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` and link acceptance evidence.
