package roles

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"enterprise-platform/internal/auth"
)

type Service struct {
	db *sql.DB
}

type row struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Level int    `json:"level"`
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

func (s *Service) list(ctx context.Context, tenantID string) ([]row, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT name, kind, level FROM roles
		WHERE tenant_id = $1::uuid
		ORDER BY level, name
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []row
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.Name, &item.Kind, &item.Level); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
