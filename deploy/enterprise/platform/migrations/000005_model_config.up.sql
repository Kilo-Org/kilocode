CREATE TABLE IF NOT EXISTS model_configs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  provider TEXT NOT NULL,
  api_base TEXT NOT NULL,
  default_model TEXT NOT NULL,
  small_model TEXT,
  fallback_provider TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT model_configs_provider_check CHECK (
    provider IN ('deepseek', 'qwen', 'glm', 'minimax')
  )
);

CREATE TABLE IF NOT EXISTS config_revisions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,
  summary TEXT,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS config_revisions_tenant_idx ON config_revisions (tenant_id, created_at DESC);

INSERT INTO model_configs (tenant_id, provider, api_base, default_model, small_model)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'deepseek',
  'https://api.deepseek.com/v1',
  'deepseek-v4-pro',
  'deepseek-v4-flash'
)
ON CONFLICT (tenant_id) DO NOTHING;
