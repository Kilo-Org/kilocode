package tenant

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"enterprise-platform/internal/auth"
	"enterprise-platform/internal/license"
)

type Service struct {
	db *sql.DB
}

type row struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Status             string `json:"status"`
	CreatedAt          string `json:"createdAt,omitempty"`
	LicenseExpiresAt   string `json:"licenseExpiresAt,omitempty"`
	LicenseDaysLeft    int    `json:"licenseDaysLeft,omitempty"`
	LicenseExpiringSoon bool  `json:"licenseExpiringSoon,omitempty"`
}

type createReq struct {
	Name string `json:"name"`
}

type patchReq struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

func New(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) RouteHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/api/v1/tenants" {
		switch r.Method {
		case http.MethodGet:
			s.listHTTP(w, r)
		case http.MethodPost:
			s.createHTTP(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	if strings.HasPrefix(path, "/api/v1/tenants/") {
		id := strings.Trim(strings.TrimPrefix(path, "/api/v1/tenants/"), "/")
		if id == "" {
			http.Error(w, `{"error":"missing_id"}`, http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodPatch {
			s.patchHTTP(w, r, id)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.NotFound(w, r)
}

func (s *Service) listHTTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	all := hasRole(claims.Roles, "sys_admin")
	items, err := s.list(r.Context(), claims.TenantID, all)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"items": items})
}

func (s *Service) createHTTP(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if !hasRole(claims.Roles, "sys_admin") {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		http.Error(w, `{"error":"missing_name"}`, http.StatusBadRequest)
		return
	}
	var id string
	err := s.db.QueryRowContext(r.Context(), `
		INSERT INTO tenants (name, status) VALUES ($1, 'active')
		RETURNING id::text
	`, name).Scan(&id)
	if err != nil {
		http.Error(w, `{"error":"create_failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"id": id, "status": "ok"})
}

func (s *Service) patchHTTP(w http.ResponseWriter, r *http.Request, id string) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if claims.TenantID != id && !hasRole(claims.Roles, "sys_admin") {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	if !hasRole(claims.Roles, "sys_admin", "tenant_admin") {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	status := strings.TrimSpace(req.Status)
	if name == "" && status == "" {
		http.Error(w, `{"error":"empty_patch"}`, http.StatusBadRequest)
		return
	}
	if status != "" && status != "active" && status != "suspended" {
		http.Error(w, `{"error":"invalid_status"}`, http.StatusBadRequest)
		return
	}
	if name != "" && status != "" {
		_, err := s.db.ExecContext(r.Context(), `
			UPDATE tenants SET name = $1, status = $2 WHERE id = $3::uuid
		`, name, status, id)
		if err != nil {
			http.Error(w, `{"error":"update_failed"}`, http.StatusInternalServerError)
			return
		}
	} else if name != "" {
		_, err := s.db.ExecContext(r.Context(), `
			UPDATE tenants SET name = $1 WHERE id = $2::uuid
		`, name, id)
		if err != nil {
			http.Error(w, `{"error":"update_failed"}`, http.StatusInternalServerError)
			return
		}
	} else {
		_, err := s.db.ExecContext(r.Context(), `
			UPDATE tenants SET status = $1 WHERE id = $2::uuid
		`, status, id)
		if err != nil {
			http.Error(w, `{"error":"update_failed"}`, http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Service) list(ctx context.Context, tenantID string, all bool) ([]row, error) {
	var rows *sql.Rows
	var err error
	if all {
		rows, err = s.db.QueryContext(ctx, `
			SELECT t.id::text, t.name, t.status, t.created_at::text,
				(SELECT MIN(l.expires_at) FROM licenses l WHERE l.tenant_id = t.id)
			FROM tenants t ORDER BY t.name
		`)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT t.id::text, t.name, t.status, t.created_at::text,
				(SELECT MIN(l.expires_at) FROM licenses l WHERE l.tenant_id = t.id)
			FROM tenants t
			WHERE t.id = $1::uuid ORDER BY t.name
		`, tenantID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []row
	for rows.Next() {
		var item row
		var expires sql.NullTime
		if err := rows.Scan(&item.ID, &item.Name, &item.Status, &item.CreatedAt, &expires); err != nil {
			return nil, err
		}
		if expires.Valid {
			item.LicenseExpiresAt = expires.Time.UTC().Format(time.RFC3339)
			days, soon := license.Notice(expires.Time, time.Now().UTC())
			if soon {
				item.LicenseExpiringSoon = true
				item.LicenseDaysLeft = days
			}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func hasRole(roles []string, names ...string) bool {
	for _, role := range roles {
		for _, want := range names {
			if role == want {
				return true
			}
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
