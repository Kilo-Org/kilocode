ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_sub_uidx ON users (oidc_sub) WHERE oidc_sub IS NOT NULL;

INSERT INTO users (id, tenant_id, email, oidc_sub, display_name, status)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'admin@enterprise.local',
  'dev-admin',
  'Dev Admin',
  'active'
)
ON CONFLICT (tenant_id, email) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000101', r.id
FROM roles r
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name = 'tenant_admin'
ON CONFLICT DO NOTHING;
