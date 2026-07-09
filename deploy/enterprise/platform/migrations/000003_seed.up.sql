INSERT INTO tenants (id, name, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO licenses (tenant_id, license_key, expires_at, status)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'poc-demo-key',
    now() + interval '365 days',
    'active'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'enterprise-poc',
    now() + interval '365 days',
    'active'
  )
ON CONFLICT (license_key) DO NOTHING;

INSERT INTO roles (tenant_id, name, level, kind)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'viewer', 1, 'normal'),
  ('00000000-0000-0000-0000-000000000001', 'developer', 2, 'normal'),
  ('00000000-0000-0000-0000-000000000001', 'tenant_admin', 3, 'normal'),
  ('00000000-0000-0000-0000-000000000001', 'sys_admin', 4, 'sys_admin'),
  ('00000000-0000-0000-0000-000000000001', 'security_admin', 4, 'security_admin'),
  ('00000000-0000-0000-0000-000000000001', 'audit_admin', 4, 'audit_admin')
ON CONFLICT (tenant_id, name) DO NOTHING;
