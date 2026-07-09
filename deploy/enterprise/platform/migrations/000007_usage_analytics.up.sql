CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_email TEXT NOT NULL,
  ide TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  shanghai_date DATE NOT NULL,
  event TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_ide_check CHECK (ide IN ('vscode', 'jetbrains', 'android'))
);

CREATE INDEX IF NOT EXISTS usage_events_tenant_date_idx ON usage_events (tenant_id, shanghai_date);
CREATE INDEX IF NOT EXISTS usage_events_tenant_user_date_idx ON usage_events (tenant_id, user_email, shanghai_date);
CREATE INDEX IF NOT EXISTS usage_events_tenant_event_idx ON usage_events (tenant_id, event, shanghai_date);
