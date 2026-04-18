# KiloCode Training and GPU Hardened Spec

## Purpose
Provide orchestration coverage for model work.

## Data model
### Dataset
```yaml
name: string
source_path: string
format: jsonl|parquet|csv|folder
validation_status: pending|passed|failed
```

### TrainingJob
```yaml
name: string
preset: lora|qlora|custom
target: local_gpu|remote_gpu
dataset: string
status: queued|running|paused|completed|failed
checkpoint_path: string|null
```

## Required operations
- register_dataset
- validate_dataset
- launch_training_job
- monitor_training_job
- resume_checkpoint
- compare_runs
- export_package

## Failure modes
- invalid dataset
- no GPU target available
- job launch failed
- checkpoint missing
- compare data incomplete

## Evidence requirements
- dataset registration entry
- job launch log
- monitor screenshot/log
- checkpoint resume log
- compare report
- export artifact list
