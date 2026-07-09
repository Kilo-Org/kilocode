ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS api_key_env TEXT;

UPDATE model_configs
SET api_key_env = 'KILO_CUSTOM_API_KEY'
WHERE api_key_env IS NULL OR api_key_env = '';
