# Block E — ZeroClaw Execution

Implement:
- task intake schema
- low/medium/high risk levels
- Hermes -> ZeroClaw adapter
- workspace scope enforcement
- network policy enforcement
- low-risk auto path
- medium-risk buffered diff path
- high-risk approval gate
- artifact/log/result return
- retry/rollback behavior

Required proof:
- low-risk task auto-runs
- medium-risk returns diff before apply
- high-risk blocked until approval
- logs + artifacts + changed files visible
- out-of-scope request blocked
