# Feature Truth Matrix

| Feature | Subsystem | Phase(s) | UI Surface | Runtime Path | Config Path | Acceptance Link | Evidence Required | Status |
| SSH connect | SSH/VPS | 17-21 | Remote Ops > Hosts | ssh session manager | configs/ssh.yaml | SSH connect acceptance | screenshot+transcript+log | Planned |
| SFTP browse | SSH/VPS | 22 | Remote Ops > Files | sftp browser | configs/ssh.yaml | Remote browse acceptance | screenshot+log | Planned |
| Remote edit/save diff | SSH/VPS | 23-24 | Remote Ops > Editor | remote editor | configs/ssh.yaml | Edit/save acceptance | diff+screenshot+log | Planned |
| Remote logs | SSH/VPS | 25 | Remote Ops > Logs | log tailer | configs/ssh.yaml | Log acceptance | screenshot+transcript | Planned |
| VPS metrics | VPS | 27-28 | Infra > Metrics | vps metrics service | configs/vps_inventory.yaml | Metrics acceptance | screenshot+log | Planned |
| Service controls | VPS | 29-31 | Infra > Services | service controller | configs/vps_inventory.yaml | Service control acceptance | approval+log | Planned |
| Backup restore | VPS | 32-34 | Infra > Recovery | backup manager | configs/governance.yaml | Backup acceptance | runbook+log | Planned |
| ZeroClaw submit job | ZeroClaw | 35-40 | Tasks > Execution | hermes->zeroclaw adapter | configs/execution.yaml | Low-risk acceptance | task trace+log | Planned |
| ZeroClaw buffered diff | ZeroClaw | 41 | Tasks > Diff Review | buffered write flow | configs/execution.yaml | Medium-risk acceptance | diff+approval+log | Planned |
| ZeroClaw high-risk approval | ZeroClaw | 42-44 | Tasks > Approval | approval gate | configs/governance.yaml | High-risk acceptance | approval record+log | Planned |
| Claude routing | Routing | 45-46 | Task Detail > Routing | router | configs/providers.yaml | Contract route acceptance | route trace+log | Planned |
| MiniMax routing | Routing | 45-47 | Task Detail > Routing | router | configs/providers.yaml | Execution route acceptance | route trace+log | Planned |
| SiliconFlow fallback | Routing | 48,50-52 | Task Detail > Routing | router fallback | configs/providers.yaml | Fallback acceptance | failed primary + successful fallback | Planned |
| Local-only routing | Routing | 49-52 | Task Detail > Routing | router local lane | configs/providers.yaml | Local route acceptance | route trace | Planned |
| Shiba connectivity | Memory | 53 | Memory > Status | shiba client | configs/memory.yaml | Connectivity acceptance | status screenshot+log | Planned |
| Recall trace | Memory | 54,57 | Memory > Recall | recall engine | configs/memory.yaml | Recall acceptance | trace+log | Planned |
| Write history | Memory | 55 | Memory > Writes | memory writer | configs/memory.yaml | Write acceptance | history screenshot+log | Planned |
| Project-scoped memory | Memory | 56-58 | Memory > Project | scoped memory | configs/memory.yaml | Project memory acceptance | query result+trace | Planned |
| Dataset registry | Training | 59-60 | Training > Datasets | dataset registry | configs/training.yaml | Dataset acceptance | screenshot+log | Planned |
| Training job launch | Training | 61-63 | Training > Jobs | job launcher | configs/training.yaml | Launch acceptance | job log | Planned |
| Checkpoint resume | Training | 64 | Training > Jobs | checkpoint manager | configs/training.yaml | Resume acceptance | resume log | Planned |
| Compare runs | Training | 65 | Training > Compare | compare engine | configs/training.yaml | Compare acceptance | comparison report | Planned |
| Export package | Training | 66 | Training > Export | export packager | configs/training.yaml | Export acceptance | artifact list | Planned |
| Speech input/output | Speech | 67 | Speech > Panel | speech service | configs/speech.yaml | Speech acceptance | audio log+error path | Planned |
| Authority tiers | Governance | 68 | Settings > Governance | authority engine | configs/governance.yaml | Authority acceptance | policy+log | Planned |
| Approval history | Governance | 69-70 | Tasks > Approvals | approval ledger | configs/governance.yaml | Approval acceptance | approval audit log | Planned |
| CI/CD + release | Release | 71-72 | Release > Control | release manager | configs/governance.yaml | Release acceptance | release verdict+rollback plan | Planned |
