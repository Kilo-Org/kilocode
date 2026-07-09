package model

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"enterprise-platform/internal/auth"
)

type Service struct {
	db   *sql.DB
	path string
}

func New(db *sql.DB, path string) *Service {
	return &Service{db: db, path: path}
}

func (s *Service) GetHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	cfg, err := s.load(r.Context(), claims.TenantID)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, cfg)
}

func (s *Service) PutHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	var cfg Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	cfg.Provider = strings.TrimSpace(cfg.Provider)
	if cfg.Provider == "" {
		http.Error(w, `{"error":"missing_provider"}`, http.StatusBadRequest)
		return
	}
	cfg.ApiKeyEnv = strings.TrimSpace(cfg.ApiKeyEnv)
	if !validEnv(cfg.ApiKeyEnv) {
		http.Error(w, `{"error":"invalid_api_key_env"}`, http.StatusBadRequest)
		return
	}
	if cfg.APIBase == "" {
		cfg.APIBase = defaultBase(cfg.Provider)
	}
	if err := s.save(r.Context(), claims.TenantID, cfg); err != nil {
		http.Error(w, `{"error":"save_failed"}`, http.StatusInternalServerError)
		return
	}
	_ = s.audit(r.Context(), claims.TenantID, claims.Subject, "model_config", fmt.Sprintf("update provider=%s", cfg.Provider))
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Service) ApplyHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	cfg, err := s.load(r.Context(), claims.TenantID)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	body, err := Translate(cfg)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
		return
	}
	if s.path == "" {
		http.Error(w, `{"error":"config_path_unset"}`, http.StatusServiceUnavailable)
		return
	}
	if err := os.WriteFile(s.path, body, 0o644); err != nil {
		http.Error(w, `{"error":"write_failed"}`, http.StatusInternalServerError)
		return
	}
	_ = s.audit(r.Context(), claims.TenantID, claims.Subject, "model_apply", fmt.Sprintf("applied %s to %s", cfg.Provider, s.path))
	writeJSON(w, map[string]any{
		"status":   "ok",
		"path":     s.path,
		"provider": cfg.Provider,
		"model":    cfg.DefaultModel,
		"hint":     "recreate kilo-engine to load new config",
	})
}

func (s *Service) load(ctx context.Context, tenantID string) (Config, error) {
	var cfg Config
	err := s.db.QueryRowContext(ctx, `
		SELECT provider, api_base, default_model, COALESCE(small_model, ''), COALESCE(fallback_provider, ''), COALESCE(api_key_env, '')
		FROM model_configs WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&cfg.Provider, &cfg.APIBase, &cfg.DefaultModel, &cfg.SmallModel, &cfg.FallbackProvider, &cfg.ApiKeyEnv)
	return cfg, err
}

func (s *Service) save(ctx context.Context, tenantID string, cfg Config) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO model_configs (tenant_id, provider, api_base, default_model, small_model, fallback_provider, api_key_env, updated_at)
		VALUES ($1::uuid, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), now())
		ON CONFLICT (tenant_id) DO UPDATE SET
		  provider = EXCLUDED.provider,
		  api_base = EXCLUDED.api_base,
		  default_model = EXCLUDED.default_model,
		  small_model = EXCLUDED.small_model,
		  fallback_provider = EXCLUDED.fallback_provider,
		  api_key_env = EXCLUDED.api_key_env,
		  updated_at = now()
	`, tenantID, cfg.Provider, cfg.APIBase, cfg.DefaultModel, cfg.SmallModel, cfg.FallbackProvider, cfg.ApiKeyEnv)
	return err
}

func (s *Service) audit(ctx context.Context, tenantID, actor, kind, summary string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO config_revisions (tenant_id, kind, summary, actor_id)
		VALUES ($1::uuid, $2, $3, NULLIF($4, '')::uuid)
	`, tenantID, kind, summary, actor)
	return err
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
