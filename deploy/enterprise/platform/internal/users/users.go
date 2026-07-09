package users

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"enterprise-platform/internal/auth"
	"enterprise-platform/internal/rbac"
)

type Service struct {
	db *sql.DB
}

type row struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName,omitempty"`
	Status      string   `json:"status"`
	Roles       []string `json:"roles"`
	SsoBound    bool     `json:"ssoBound"`
}

type detailRow struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName,omitempty"`
	Status      string   `json:"status"`
	Roles       []string `json:"roles"`
	OidcSub     string   `json:"oidcSub,omitempty"`
	CreatedAt   string   `json:"createdAt,omitempty"`
}

type assignReq struct {
	Role string `json:"role"`
}

func New(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ListHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	items, err := s.list(r.Context(), claims.TenantID)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"items": items})
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
	userID := parseUserID(r.URL.Path)
	if userID == "" {
		http.Error(w, `{"error":"missing_user"}`, http.StatusBadRequest)
		return
	}
	item, err := s.get(r.Context(), claims.TenantID, userID)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, item)
}

func (s *Service) AssignRoleHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID := parseUserID(r.URL.Path)
	if userID == "" {
		http.Error(w, `{"error":"missing_user"}`, http.StatusBadRequest)
		return
	}
	var req assignReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	role := strings.TrimSpace(req.Role)
	if role == "" {
		http.Error(w, `{"error":"missing_role"}`, http.StatusBadRequest)
		return
	}
	if err := s.assign(r.Context(), claims.TenantID, userID, role); err != nil {
		if strings.Contains(err.Error(), "three_admin_mutex") {
			http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusConflict)
			return
		}
		if err == sql.ErrNoRows {
			http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"assign_failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (s *Service) UnassignRoleHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID := parseUserID(r.URL.Path)
	if userID == "" {
		http.Error(w, `{"error":"missing_user"}`, http.StatusBadRequest)
		return
	}
	var req assignReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	role := strings.TrimSpace(req.Role)
	if role == "" {
		http.Error(w, `{"error":"missing_role"}`, http.StatusBadRequest)
		return
	}
	if err := s.unassign(r.Context(), claims.TenantID, userID, role); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"unassign_failed"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func parseUserID(path string) string {
	userID := strings.TrimPrefix(path, "/api/v1/users/")
	userID = strings.TrimSuffix(userID, "/roles")
	return strings.Trim(userID, "/")
}

func (s *Service) list(ctx context.Context, tenantID string) ([]row, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id::text, u.email, COALESCE(u.display_name, ''), u.status,
			COALESCE(u.oidc_sub, '') <> ''
		FROM users u
		WHERE u.tenant_id = $1::uuid
		ORDER BY u.email
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.ID, &item.Email, &item.DisplayName, &item.Status, &item.SsoBound); err != nil {
			return nil, err
		}
		roles, err := s.roles(ctx, item.ID)
		if err != nil {
			return nil, err
		}
		item.Roles = roles
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) get(ctx context.Context, tenantID, userID string) (detailRow, error) {
	var item detailRow
	var oidcSub sql.NullString
	var created sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id::text, u.email, COALESCE(u.display_name, ''), u.status,
			u.oidc_sub, u.created_at
		FROM users u
		WHERE u.tenant_id = $1::uuid AND u.id = $2::uuid
	`, tenantID, userID).Scan(
		&item.ID, &item.Email, &item.DisplayName, &item.Status, &oidcSub, &created,
	)
	if err != nil {
		return item, err
	}
	if oidcSub.Valid {
		item.OidcSub = oidcSub.String
	}
	if created.Valid {
		item.CreatedAt = created.Time.UTC().Format(time.RFC3339)
	}
	item.Roles, err = s.roles(ctx, item.ID)
	return item, err
}

func (s *Service) assign(ctx context.Context, tenantID, userID, roleName string) error {
	var roleID, kind string
	err := s.db.QueryRowContext(ctx, `
		SELECT id::text, kind FROM roles
		WHERE tenant_id = $1::uuid AND name = $2
	`, tenantID, roleName).Scan(&roleID, &kind)
	if err != nil {
		return err
	}
	kinds, err := s.roleKinds(ctx, userID)
	if err != nil {
		return err
	}
	if err := rbac.CanAssign(kinds, kind); err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO user_roles (user_id, role_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING
	`, userID, roleID)
	return err
}

func (s *Service) unassign(ctx context.Context, tenantID, userID, roleName string) error {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM user_roles ur
		USING roles r
		WHERE ur.role_id = r.id
		  AND ur.user_id = $1::uuid
		  AND r.tenant_id = $2::uuid
		  AND r.name = $3
	`, userID, tenantID, roleName)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
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

func (s *Service) roleKinds(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.kind FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1::uuid
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return nil, err
		}
		kinds = append(kinds, kind)
	}
	return kinds, rows.Err()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
