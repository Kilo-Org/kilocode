# Training and GPU Complete Coverage Spec

Version: 1.0.0
Config path: `config/training.yaml`

---

## 1. Dataset Registry Schema

```typescript
interface DatasetEntry {
  dataset_id: string;            // UUID v4
  name: string;                  // human-readable, e.g. "customer-support-qa-v3"
  source_path: string;           // file or directory path, e.g. "/data/datasets/cs-qa-v3/"
  format: "jsonl" | "csv" | "parquet" | "hf";  // hf = Hugging Face datasets format
  size_bytes: number;
  row_count: number;
  columns: ColumnDef[];
  validation_status: "pending" | "valid" | "invalid" | "warnings";
  validation_errors: ValidationIssue[];
  preprocessing_steps: PreprocessingStep[];
  splits: {
    train: { row_count: number; path: string };
    val: { row_count: number; path: string };
    test: { row_count: number; path: string };
  } | null;                      // null until split is executed
  created_at: string;            // ISO-8601
  updated_at: string;
  created_by: string;            // agent or user ID
  tags: string[];
  fingerprint: string;           // SHA-256 hash of file content for dedup and integrity
}

interface ColumnDef {
  name: string;
  dtype: "string" | "int" | "float" | "bool" | "json" | "list";
  nullable: boolean;
  sample_values: string[];       // first 3 values as strings
}

interface PreprocessingStep {
  step_id: string;
  operation: string;             // e.g. "remove_duplicates", "normalize_whitespace", "filter_empty"
  params: Record<string, unknown>;
  applied_at: string;
  rows_before: number;
  rows_after: number;
}
```

### Dataset Config

```yaml
datasets:
  storage_path: data/datasets/
  max_upload_size_bytes: 10737418240   # 10 GB
  allowed_formats: [jsonl, csv, parquet, hf]
  auto_validate_on_register: true
```

---

## 2. Validation Pipeline

Validation runs automatically when a dataset is registered (if `auto_validate_on_register: true`) or can be triggered manually.

### Pipeline Stages

```
Stage 1: Schema Check
  - Verify file format matches declared format
  - Parse headers / schema
  - Validate column names match expected pattern (no spaces, no special chars)
  - Check data types per column against declared dtypes
  - Output: column_report[]

Stage 2: Duplicate Detection
  - Compute row hashes (SHA-256 of concatenated column values)
  - Flag duplicate rows
  - Output: duplicate_count, duplicate_row_indices[]

Stage 3: Null / Empty Scan
  - Per column: count nulls, empty strings, whitespace-only values
  - Flag columns with >10% null rate as warnings
  - Flag columns with >50% null rate as errors
  - Output: null_report per column

Stage 4: Format Normalization
  - Strip leading/trailing whitespace from all string fields
  - Normalize Unicode (NFC)
  - Convert line endings to LF
  - Standardize date formats to ISO-8601 where detected
  - Output: normalization_report

Stage 5: Split (train / val / test)
  - Default ratio: 80 / 10 / 10
  - Stratified split if a label column is declared
  - Shuffle with configurable seed (default: 42)
  - Output: split files written to source_path/splits/
  - Updates DatasetEntry.splits

Stage 6: Summary Report
  - Total rows, columns, size
  - Validation status (valid | invalid | warnings)
  - List of all issues found
  - Split statistics
```

### Validation Issue Schema

```typescript
interface ValidationIssue {
  severity: "error" | "warning" | "info";
  stage: string;              // which pipeline stage
  column: string | null;      // which column, if applicable
  row_indices: number[];      // affected rows (first 100 max)
  message: string;            // e.g. "Column 'label' has 23% null values"
  auto_fixable: boolean;      // can preprocessing fix this?
  fix_suggestion: string;     // e.g. "Run 'fill_nulls' with default value"
}
```

---

## 3. Training Job Schema

```typescript
interface TrainingJob {
  job_id: string;               // UUID v4
  dataset_id: string;           // FK to DatasetEntry
  model_base: string;           // e.g. "meta-llama/Llama-3.1-8B", "mistralai/Mistral-7B-v0.3"
  method: "lora" | "qlora" | "full";
  hyperparams: Hyperparams;
  target: "local_gpu" | "remote_gpu";
  gpu_target: GpuTarget;
  status: "queued" | "preparing" | "running" | "paused" | "completed" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  eta: string | null;           // ISO-8601 estimated completion
  duration_seconds: number | null;
  metrics: TrainingMetrics;
  error: string | null;         // error message if status == "failed"
  error_code: string | null;    // error code if status == "failed"
  checkpoints: string[];        // checkpoint_id list
  created_by: string;
  tags: string[];
}

interface Hyperparams {
  learning_rate: number;        // e.g. 2e-5
  epochs: number;               // e.g. 3
  batch_size: number;           // e.g. 4
  gradient_accumulation_steps: number;  // e.g. 8
  warmup_steps: number;         // e.g. 100
  weight_decay: number;         // e.g. 0.01
  max_seq_length: number;       // e.g. 2048
  lora_r: number | null;        // LoRA rank, e.g. 16 (null for full fine-tune)
  lora_alpha: number | null;    // LoRA alpha, e.g. 32
  lora_dropout: number | null;  // e.g. 0.05
  lora_target_modules: string[] | null;  // e.g. ["q_proj", "v_proj"]
  quantization: "4bit" | "8bit" | null;  // for QLoRA
  optimizer: "adamw" | "sgd" | "adafactor";
  scheduler: "cosine" | "linear" | "constant";
  fp16: boolean;
  bf16: boolean;
  seed: number;                 // default 42
}

interface TrainingMetrics {
  train_loss: number | null;
  val_loss: number | null;
  best_val_loss: number | null;
  best_epoch: number | null;
  total_steps: number | null;
  current_step: number | null;
  current_epoch: number | null;
  tokens_processed: number | null;
  throughput_tokens_per_sec: number | null;
}
```

### Job Presets

```yaml
presets:
  lora_default:
    method: lora
    hyperparams:
      learning_rate: 2e-5
      epochs: 3
      batch_size: 4
      gradient_accumulation_steps: 8
      warmup_steps: 100
      weight_decay: 0.01
      max_seq_length: 2048
      lora_r: 16
      lora_alpha: 32
      lora_dropout: 0.05
      lora_target_modules: [q_proj, v_proj, k_proj, o_proj]
      quantization: null
      optimizer: adamw
      scheduler: cosine
      fp16: true
      bf16: false
      seed: 42

  qlora_default:
    method: qlora
    hyperparams:
      learning_rate: 2e-4
      epochs: 3
      batch_size: 2
      gradient_accumulation_steps: 16
      warmup_steps: 50
      weight_decay: 0.01
      max_seq_length: 1024
      lora_r: 64
      lora_alpha: 16
      lora_dropout: 0.1
      lora_target_modules: [q_proj, v_proj, k_proj, o_proj, gate_proj, up_proj, down_proj]
      quantization: 4bit
      optimizer: adamw
      scheduler: cosine
      fp16: false
      bf16: true
      seed: 42

  full_finetune:
    method: full
    hyperparams:
      learning_rate: 1e-5
      epochs: 2
      batch_size: 1
      gradient_accumulation_steps: 32
      warmup_steps: 200
      weight_decay: 0.1
      max_seq_length: 4096
      lora_r: null
      lora_alpha: null
      lora_dropout: null
      lora_target_modules: null
      quantization: null
      optimizer: adamw
      scheduler: cosine
      fp16: false
      bf16: true
      seed: 42
```

---

## 4. GPU Target Selection

### Local Detection

```typescript
interface LocalGpuInfo {
  detected: boolean;
  gpu_name: string | null;       // e.g. "NVIDIA RTX 4090"
  vram_total_mb: number | null;
  vram_available_mb: number | null;
  cuda_version: string | null;   // e.g. "12.4"
  driver_version: string | null; // e.g. "550.54.14"
  compute_capability: string | null;  // e.g. "8.9"
}
```

Detection command: `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader`
CUDA version: `nvcc --version | grep release`

### Remote Providers

```typescript
interface RemoteGpuProvider {
  provider: "runpod" | "lambda" | "vastai";
  endpoint: string;
  auth_env: string;              // env var name for API key
  available_gpus: RemoteGpuOption[];
}

interface RemoteGpuOption {
  gpu_type: string;              // e.g. "A100-80GB", "H100-80GB", "RTX-4090"
  vram_mb: number;
  cost_per_hour_usd: number;
  availability: "available" | "limited" | "unavailable";
  region: string;
}
```

### Remote Provider Config

```yaml
remote_providers:
  runpod:
    endpoint: https://api.runpod.io/v2
    auth_env: RUNPOD_API_KEY
    gpus:
      - type: A100-80GB
        vram_mb: 81920
        cost_per_hour: 1.99
      - type: H100-80GB
        vram_mb: 81920
        cost_per_hour: 3.49
      - type: RTX-4090
        vram_mb: 24576
        cost_per_hour: 0.69

  lambda:
    endpoint: https://cloud.lambdalabs.com/api/v1
    auth_env: LAMBDA_API_KEY
    gpus:
      - type: A100-80GB
        vram_mb: 81920
        cost_per_hour: 1.29
      - type: H100-80GB
        vram_mb: 81920
        cost_per_hour: 2.49

  vastai:
    endpoint: https://console.vast.ai/api/v0
    auth_env: VASTAI_API_KEY
    gpus:
      - type: RTX-4090
        vram_mb: 24576
        cost_per_hour: 0.40
      - type: A100-40GB
        vram_mb: 40960
        cost_per_hour: 0.80
```

### Auto-Select Logic

```
1. Estimate VRAM requirement:
   - full fine-tune: model_params_billions * 18 GB (weights + optimizer + gradients)
   - lora: model_params_billions * 2 GB + lora overhead (~500 MB)
   - qlora: model_params_billions * 0.5 GB + lora overhead (~500 MB)

2. Check local GPU:
   - if LocalGpuInfo.detected == true AND vram_available_mb >= estimated_vram_mb:
     → select local_gpu (cost = $0)
   - else: proceed to remote

3. Query remote providers:
   - filter GPUs where vram_mb >= estimated_vram_mb AND availability == "available"
   - sort by cost_per_hour ascending
   - estimate total_cost = cost_per_hour * estimated_hours
   - select cheapest available option

4. Return GpuTarget:
   {
     target: "local_gpu" | "remote_gpu",
     provider: string | null,
     gpu_type: string,
     vram_mb: number,
     estimated_cost_usd: number,
     estimated_hours: number
   }
```

---

## 5. Monitoring Data Model

Monitoring data is emitted at each training step and stored for real-time display and post-hoc analysis.

```typescript
interface MonitoringEvent {
  job_id: string;
  timestamp: string;            // ISO-8601
  epoch: number;
  step: number;
  global_step: number;          // step across all epochs
  loss: number;
  val_loss: number | null;      // null between validation intervals
  learning_rate: number;        // current LR (may change with scheduler)
  gpu_util_percent: number;     // 0-100
  vram_used_mb: number;
  vram_total_mb: number;
  throughput_tokens_per_sec: number;
  batch_time_ms: number;
  gradient_norm: number | null;
  samples_seen: number;
}
```

### Monitoring Config

```yaml
monitoring:
  log_interval_steps: 10        # emit MonitoringEvent every N steps
  validation_interval_steps: 500
  tensorboard:
    enabled: true
    log_dir: data/training/tensorboard/
  checkpoint_interval_steps: 1000
  early_stopping:
    enabled: true
    patience: 3                 # epochs without val_loss improvement
    min_delta: 0.001            # minimum improvement to count
```

### Monitoring Storage

- Events: `data/training/logs/{job_id}/events.jsonl`
- TensorBoard: `data/training/tensorboard/{job_id}/`
- Summary: `data/training/logs/{job_id}/summary.json`

---

## 6. Checkpoint Schema

```typescript
interface Checkpoint {
  checkpoint_id: string;         // UUID v4
  job_id: string;
  epoch: number;
  step: number;
  global_step: number;
  path: string;                  // e.g. "data/training/checkpoints/{job_id}/epoch-2-step-1500/"
  size_bytes: number;
  created_at: string;
  metrics_at_checkpoint: {
    train_loss: number;
    val_loss: number | null;
    learning_rate: number;
  };
  is_best: boolean;             // true if this has the lowest val_loss so far
  resumable: boolean;           // always true unless corrupted
  files: string[];              // list of files in the checkpoint dir
  checksum: string;             // SHA-256 of concatenated file checksums
}
```

### Checkpoint Storage

```
data/training/checkpoints/{job_id}/
  epoch-1-step-500/
    adapter_model.safetensors   # LoRA weights (or full model weights)
    adapter_config.json
    optimizer.pt
    scheduler.pt
    trainer_state.json
    rng_state.pth
    CHECKPOINT_MANIFEST.json    # Checkpoint schema as JSON
  epoch-2-step-1000/
    ...
  best/                         # symlink to best checkpoint
```

### Resume from Checkpoint

```
1. Load Checkpoint by checkpoint_id
2. Verify checksum matches (compare to stored checksum)
   - if mismatch → TRAIN_CHECKPOINT_CORRUPTED
3. Restore model weights, optimizer state, scheduler state, RNG state
4. Set starting epoch/step from checkpoint
5. Continue training from that point
6. Update job status from "paused" → "running"
```

---

## 7. Compare Runs Model

```typescript
interface RunComparison {
  comparison_id: string;
  run_ids: string[];             // job_ids to compare
  metric_keys: string[];         // e.g. ["train_loss", "val_loss", "throughput_tokens_per_sec"]
  runs: RunSummary[];
  chart_data: ChartDataSet[];
  best_run_id: string;           // job_id with best primary metric
  best_metric_key: string;       // which metric determined "best"
  best_metric_value: number;
  recommendation: string;        // e.g. "Run job_xyz had the lowest val_loss (0.342) at epoch 3. Consider using its hyperparams."
  generated_at: string;
}

interface RunSummary {
  job_id: string;
  model_base: string;
  method: string;
  hyperparams: Hyperparams;
  final_train_loss: number;
  final_val_loss: number;
  best_val_loss: number;
  total_duration_seconds: number;
  total_cost_usd: number;
  gpu_type: string;
}

interface ChartDataSet {
  metric_key: string;            // e.g. "val_loss"
  series: ChartSeries[];
}

interface ChartSeries {
  job_id: string;
  label: string;                 // e.g. "LoRA r=16 lr=2e-5"
  data_points: { step: number; value: number }[];
}
```

---

## 8. Export Schema

```typescript
interface ModelExport {
  export_id: string;             // UUID v4
  job_id: string;
  checkpoint_id: string;         // which checkpoint to export
  format: "gguf" | "safetensors" | "onnx";
  quantization: "q4_0" | "q4_k_m" | "q5_k_m" | "q8_0" | "f16" | "f32" | null;
  output_path: string;           // e.g. "data/training/exports/{export_id}/model.gguf"
  size_bytes: number;
  created_at: string;
  status: "pending" | "exporting" | "completed" | "failed";
  error: string | null;
  metadata: {
    base_model: string;
    method: string;
    dataset_id: string;
    best_val_loss: number;
    training_job_id: string;
  };
}
```

### Export Pipeline

```
1. Validate checkpoint exists and is not corrupted
2. Load adapter weights (LoRA/QLoRA) or full model weights
3. Merge adapter with base model (if LoRA/QLoRA)
4. Apply quantization (if specified)
5. Convert to target format
6. Write output files to output_path
7. Generate metadata sidecar: {output_path}/metadata.json
8. Compute file checksum
9. Update status to "completed"
```

### Export Storage

```
data/training/exports/{export_id}/
  model.gguf                   # or model.safetensors / model.onnx
  metadata.json
  README.md                   # auto-generated model card
```

---

## 9. Error Codes

| Code                        | Description                                                   | Recovery                                                          |
|-----------------------------|---------------------------------------------------------------|-------------------------------------------------------------------|
| TRAIN_GPU_NOT_FOUND         | No local GPU detected and no remote provider configured       | Install CUDA drivers, configure a remote provider                 |
| TRAIN_OOM                   | GPU ran out of memory during training                         | Reduce batch_size, use QLoRA, use gradient accumulation, use larger GPU |
| TRAIN_DATASET_INVALID       | Dataset failed validation (schema errors, too many nulls)     | Fix dataset issues listed in validation_errors[], re-register     |
| TRAIN_CHECKPOINT_CORRUPTED  | Checkpoint checksum mismatch on resume                        | Delete corrupted checkpoint, resume from an earlier one            |
| TRAIN_REMOTE_AUTH_FAILED    | Remote GPU provider rejected API key                          | Check env var for provider API key, rotate key                    |
| TRAIN_JOB_TIMEOUT           | Training job exceeded maximum allowed wall-clock time          | Increase timeout in config, reduce epochs, use faster GPU         |
| TRAIN_CUDA_ERROR            | CUDA runtime error (driver mismatch, kernel failure)          | Update CUDA drivers, check GPU hardware                           |
| TRAIN_DATASET_TOO_LARGE     | Dataset exceeds max_upload_size_bytes                          | Split dataset, increase limit in config                           |
| TRAIN_EXPORT_FAILED         | Model export/conversion failed                                | Check format compatibility, ensure enough disk space              |
| TRAIN_REMOTE_DISCONNECTED   | Lost connection to remote GPU instance during training        | Check network, resume from last checkpoint                        |

### Error Response Envelope

```typescript
interface TrainingError {
  error_code: string;
  message: string;
  job_id: string | null;
  dataset_id: string | null;
  timestamp: string;
  gpu_state: {
    vram_used_mb: number | null;
    vram_total_mb: number | null;
    gpu_util_percent: number | null;
  } | null;
  details: Record<string, unknown>;
}
```

---

## 10. Config Path

Primary configuration: `config/training.yaml`

```
config/
  training.yaml             # datasets, job presets, GPU providers, monitoring
  training.local.yaml       # local overrides (gitignored)
```

Environment variables referenced:
- `RUNPOD_API_KEY`
- `LAMBDA_API_KEY`
- `VASTAI_API_KEY`

Data paths:
- `data/datasets/` -- registered datasets
- `data/training/logs/{job_id}/` -- monitoring events and summaries
- `data/training/checkpoints/{job_id}/` -- checkpoint files
- `data/training/tensorboard/{job_id}/` -- TensorBoard logs
- `data/training/exports/{export_id}/` -- exported models

---

## Acceptance Criteria

1. A dataset can be registered from a JSONL/CSV/Parquet/HF source and passes schema validation.
2. Validation pipeline runs all 6 stages and produces a summary report with actionable issues.
3. A training job can be launched with a preset (lora_default, qlora_default, full_finetune) or custom hyperparams.
4. Local GPU is auto-detected via `nvidia-smi`; if insufficient VRAM, remote providers are queried and ranked by cost.
5. Monitoring events are emitted every `log_interval_steps` and are visible in the monitoring UI and TensorBoard.
6. Checkpoints are saved at `checkpoint_interval_steps`, each with a verifiable checksum.
7. A paused job can be resumed from any valid checkpoint.
8. Two or more completed runs can be compared with overlaid loss curves and a recommendation for the best run.
9. A completed job can be exported to GGUF, safetensors, or ONNX with optional quantization.
10. OOM during training returns `TRAIN_OOM` with VRAM usage details and a suggestion to reduce batch size or switch methods.
