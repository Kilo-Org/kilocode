package oidc

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"enterprise-platform/internal/auth"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type Config struct {
	Issuer           string
	ClientID         string
	ClientSecret     string
	RedirectURL      string
	BrowserRedirect  string
	VSCodeRedirect   string
	TenantID         string
	JWTSecret        []byte
	JWTKey           string
	JWTTTL           time.Duration
	Dev              bool
}

type stateEntry struct {
	exp    time.Time
	client string
}

type Service struct {
	db     *sql.DB
	cfg    Config
	oauth  *oauth2.Config
	verify *oidc.IDTokenVerifier
	states map[string]stateEntry
}

type tokenResp struct {
	AccessToken string `json:"accessToken"`
	ExpiresIn   int64  `json:"expiresIn"`
	TokenType   string `json:"tokenType"`
}

type devReq struct {
	Email string `json:"email"`
}

func New(ctx context.Context, db *sql.DB, cfg Config) (*Service, error) {
	svc := &Service{db: db, cfg: cfg, states: map[string]stateEntry{}}
	if cfg.Issuer == "" {
		return svc, nil
	}
	provider, err := oidc.NewProvider(ctx, cfg.Issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc provider: %w", err)
	}
	svc.oauth = &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	svc.verify = provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})
	return svc, nil
}

func (s *Service) Enabled() bool {
	return s.oauth != nil
}

func (s *Service) LoginHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled() {
		http.Error(w, `{"error":"oidc_disabled"}`, http.StatusServiceUnavailable)
		return
	}
	state := randToken()
	client := strings.TrimSpace(r.URL.Query().Get("client"))
	if client == "" {
		client = "browser"
	}
	s.states[state] = stateEntry{
		exp:    time.Now().UTC().Add(10 * time.Minute),
		client: client,
	}
	url := s.oauth.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusFound)
}

func (s *Service) CallbackHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled() {
		http.Error(w, `{"error":"oidc_disabled"}`, http.StatusServiceUnavailable)
		return
	}
	state := r.URL.Query().Get("state")
	client, ok := s.popState(state)
	if !ok {
		http.Error(w, `{"error":"bad_state"}`, http.StatusBadRequest)
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, `{"error":"missing_code"}`, http.StatusBadRequest)
		return
	}
	tok, err := s.oauth.Exchange(r.Context(), code)
	if err != nil {
		http.Error(w, `{"error":"exchange_failed"}`, http.StatusBadGateway)
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		http.Error(w, `{"error":"missing_id_token"}`, http.StatusBadGateway)
		return
	}
	idtok, err := s.verify.Verify(r.Context(), rawID)
	if err != nil {
		http.Error(w, `{"error":"invalid_id_token"}`, http.StatusBadGateway)
		return
	}
	var prof struct {
		Email         string `json:"email"`
		Sub           string `json:"sub"`
		Name          string `json:"name"`
		Username      string `json:"username"`
		PreferredUser string `json:"preferred_username"`
	}
	_ = idtok.Claims(&prof)
	if prof.Sub == "" {
		prof.Sub = idtok.Subject
	}
	email := strings.TrimSpace(prof.Email)
	if email == "" {
		email = strings.TrimSpace(prof.Username)
	}
	if email == "" {
		email = strings.TrimSpace(prof.PreferredUser)
	}
	if email == "" {
		http.Error(w, `{"error":"missing_email"}`, http.StatusBadGateway)
		return
	}
	name := prof.Name
	if name == "" {
		name = email
	}
	userID, roles, err := s.upsert(r.Context(), prof.Sub, email, name)
	if err != nil {
		http.Error(w, `{"error":"user_provision"}`, http.StatusInternalServerError)
		return
	}
	if r.URL.Query().Get("format") == "json" {
		s.writeToken(w, userID, roles)
		return
	}
	if client == "vscode" {
		s.writeVscode(w, r, userID, roles)
		return
	}
	s.writeBrowser(w, userID, roles)
}

func (s *Service) StatusHTTP(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"enabled": s.Enabled(),
		"issuer":  s.cfg.Issuer,
		"login":   "/api/v1/auth/login",
	})
}

func (s *Service) DevTokenHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.Dev {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req devReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(req.Email)
	if email == "" {
		email = "admin@enterprise.local"
	}
	userID, roles, err := s.userByEmail(r.Context(), email)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"user_not_found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	s.writeToken(w, userID, roles)
}

func (s *Service) MeHTTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"missing_claims"}`, http.StatusUnauthorized)
		return
	}
	writeJSON(w, map[string]any{
		"id":        claims.Subject,
		"tenant_id": claims.TenantID,
		"roles":     claims.Roles,
	})
}

func (s *Service) upsert(ctx context.Context, sub, email, name string) (string, []string, error) {
	var userID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text FROM users WHERE oidc_sub = $1
	`, sub).Scan(&userID)
	if err == sql.ErrNoRows {
		err = s.db.QueryRowContext(ctx, `
			INSERT INTO users (tenant_id, email, oidc_sub, display_name)
			VALUES ($1::uuid, $2, $3, $4)
			ON CONFLICT (tenant_id, email) DO UPDATE SET oidc_sub = EXCLUDED.oidc_sub
			RETURNING id::text
		`, s.cfg.TenantID, email, sub, name).Scan(&userID)
	}
	if err != nil {
		return "", nil, err
	}
	roles, err := s.roles(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	if len(roles) == 0 {
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO user_roles (user_id, role_id)
			SELECT $1::uuid, id FROM roles
			WHERE tenant_id = $2::uuid AND name = 'developer'
			ON CONFLICT DO NOTHING
		`, userID, s.cfg.TenantID)
		if err != nil {
			return "", nil, err
		}
		roles, err = s.roles(ctx, userID)
		if err != nil {
			return "", nil, err
		}
	}
	return userID, roles, nil
}

func (s *Service) userByEmail(ctx context.Context, email string) (string, []string, error) {
	var userID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text FROM users
		WHERE tenant_id = $1::uuid AND email = $2
	`, s.cfg.TenantID, email).Scan(&userID)
	if err != nil {
		return "", nil, err
	}
	roles, err := s.roles(ctx, userID)
	return userID, roles, err
}

func (s *Service) roles(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.name FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1::uuid
		ORDER BY r.name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func (s *Service) writeVscode(w http.ResponseWriter, r *http.Request, userID string, roles []string) {
	ttl := s.cfg.JWTTTL
	if ttl == 0 {
		ttl = 8 * time.Hour
	}
	raw, err := auth.Sign(s.cfg.JWTSecret, s.cfg.JWTKey, userID, s.cfg.TenantID, roles, ttl)
	if err != nil {
		http.Error(w, `{"error":"sign_failed"}`, http.StatusInternalServerError)
		return
	}
	base := envOr(s.cfg.VSCodeRedirect, "vscode://yoyo-local.yoyo-code/enterprise/callback")
	target, err := url.Parse(base)
	if err != nil {
		http.Error(w, `{"error":"bad_vscode_redirect"}`, http.StatusInternalServerError)
		return
	}
	q := target.Query()
	q.Set("token", raw)
	target.RawQuery = q.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (s *Service) writeBrowser(w http.ResponseWriter, userID string, roles []string) {
	ttl := s.cfg.JWTTTL
	if ttl == 0 {
		ttl = 8 * time.Hour
	}
	raw, err := auth.Sign(s.cfg.JWTSecret, s.cfg.JWTKey, userID, s.cfg.TenantID, roles, ttl)
	if err != nil {
		http.Error(w, `{"error":"sign_failed"}`, http.StatusInternalServerError)
		return
	}
	next := envOr(s.cfg.BrowserRedirect, "/admin/")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录成功</title></head>
<body><p>登录成功，正在跳转…</p><script>
localStorage.setItem(%q,%q);
location.replace(%q);
</script></body></html>`, "ent_admin_token", raw, next)
}

func envOr(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

func (s *Service) writeToken(w http.ResponseWriter, userID string, roles []string) {
	ttl := s.cfg.JWTTTL
	if ttl == 0 {
		ttl = 8 * time.Hour
	}
	raw, err := auth.Sign(s.cfg.JWTSecret, s.cfg.JWTKey, userID, s.cfg.TenantID, roles, ttl)
	if err != nil {
		http.Error(w, `{"error":"sign_failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, tokenResp{
		AccessToken: raw,
		ExpiresIn:   int64(ttl.Seconds()),
		TokenType:   "Bearer",
	})
}

func (s *Service) popState(state string) (string, bool) {
	if state == "" {
		return "", false
	}
	ent, ok := s.states[state]
	if !ok {
		return "", false
	}
	delete(s.states, state)
	if time.Now().UTC().After(ent.exp) {
		return "", false
	}
	return ent.client, true
}

func randToken() string {
	buf := make([]byte, 24)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
