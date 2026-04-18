# No Fake Completion and No Drift Rules

A feature automatically fails if:
- docs claim it exists but runtime path is absent
- config exists but UI/action path is absent
- only the happy path is tested
- evidence bundle is missing
- truth-matrix row is missing
- challenger found critical breakage
- runtime changed and docs were not updated
- approval is claimed but no approval record exists
