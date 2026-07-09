package license

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
	"enterprise-platform/internal/auth"
)

type Service struct {
	db        *sql.DB
	publicKey string
}

type row struct {
	id      string
	status  string
	expires time.Time
}

type verifyReq struct {
	Key       string `json:"key"`
	MachineID string `json:"machineId"`
	Client    string `json:"client"`
}

type verifyResp struct {
	Valid     bool   `json:"valid"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	Readonly  bool   `json:"readonly,omitempty"`
	Message   string `json:"message,omitempty"`
}

type listItem struct {
	ID           string `json:"id"`
	LicenseKey   string `json:"licenseKey"`
	ExpiresAt    string `json:"expiresAt"`
	Status       string `json:"status"`
	UsageCount   int    `json:"usageCount"`
	CreatedAt    string `json:"createdAt"`
	DaysLeft     int    `json:"daysLeft,omitempty"`
	ExpiringSoon bool   `json:"expiringSoon,omitempty"`
}

func maskKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

func New(db *sql.DB, publicKey string) *Service {
	return &Service{db: db, publicKey: publicKey}
}

func (s *Service) ListHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	items, err := s.list(r.Context(), claims.TenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Service) list(ctx context.Context, tenantID string) ([]listItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id::text, l.license_key, l.expires_at, l.status, l.created_at,
			(SELECT COUNT(*) FROM license_usage lu WHERE lu.license_id = l.id)
		FROM licenses l
		WHERE l.tenant_id = $1::uuid
		ORDER BY l.expires_at DESC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []listItem
	for rows.Next() {
		var item listItem
		var key string
		var expires, created time.Time
		if err := rows.Scan(&item.ID, &key, &expires, &item.Status, &created, &item.UsageCount); err != nil {
			return nil, err
		}
		item.LicenseKey = maskKey(key)
		item.ExpiresAt = expires.UTC().Format(time.RFC3339)
		item.CreatedAt = created.UTC().Format(time.RFC3339)
		days, soon := Notice(expires, time.Now().UTC())
		if soon {
			item.DaysLeft = days
			item.ExpiringSoon = true
		}
		items = append(items, item)
	}
	if items == nil {
		items = []listItem{}
	}
	return items, rows.Err()
}

func (s *Service) VerifyHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req verifyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, verifyResp{Valid: false, Message: "bad_json"})
		return
	}
	resp, code := s.Verify(r.Context(), req.Key, req.Client, req.MachineID)
	writeJSON(w, code, resp)
}

func (s *Service) Verify(ctx context.Context, key, client, machine string) (verifyResp, int) {
	key = strings.TrimSpace(key)
	if key == "" {
		return verifyResp{Valid: false, Message: "missing_key"}, http.StatusBadRequest
	}

	var item row
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, status, expires_at
		FROM licenses
		WHERE license_key = $1
	`, key).Scan(&item.id, &item.status, &item.expires)
	if err == sql.ErrNoRows {
		return verifyResp{Valid: false, Message: "invalid_key"}, http.StatusForbidden
	}
	if err != nil {
		return verifyResp{Valid: false, Message: "db_error"}, http.StatusInternalServerError
	}

	resp, readonly := Decide(item.status, item.expires, time.Now().UTC())
	if !resp.Valid {
		return resp, http.StatusForbidden
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO license_usage (license_id, client, machine_id)
		VALUES ($1::uuid, $2, $3)
	`, item.id, client, machine)
	if err != nil {
		return verifyResp{Valid: false, Message: "usage_error"}, http.StatusInternalServerError
	}

	token := fmt.Sprintf("ent-%s", key)
	return verifyResp{
		Valid:     true,
		Token:     token,
		ExpiresAt: item.expires.UTC().Format(time.RFC3339Nano),
		Readonly:  readonly,
	}, http.StatusOK
}

func Decide(status string, expires, now time.Time) (verifyResp, bool) {
	if status == "frozen" {
		return verifyResp{Valid: false, Message: "frozen"}, false
	}
	expired := !expires.After(now)
	readonly := status == "readonly" || expired
	if status != "active" && status != "readonly" {
		return verifyResp{Valid: false, Message: "invalid_status"}, false
	}
	return verifyResp{Valid: true}, readonly
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
