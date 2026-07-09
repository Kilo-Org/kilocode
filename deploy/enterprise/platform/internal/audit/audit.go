package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"enterprise-platform/internal/auth"
)

type Service struct {
	db *sql.DB
}

type row struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Summary   string `json:"summary"`
	ActorID   string `json:"actorId,omitempty"`
	CreatedAt string `json:"createdAt"`
}

type listQuery struct {
	Kind     string
	From     *time.Time
	To       *time.Time
	Page     int
	PageSize int
}

func New(db *sql.DB) *Service {
	return &Service{db: db}
}

func parseListQuery(r *http.Request) (listQuery, error) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("pageSize"))
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	from, err := parseTime(q.Get("from"))
	if err != nil {
		return listQuery{}, err
	}
	to, err := parseTime(q.Get("to"))
	if err != nil {
		return listQuery{}, err
	}
	if to != nil && len(strings.TrimSpace(q.Get("to"))) == 10 {
		end := to.Add(24*time.Hour - time.Nanosecond)
		to = &end
	}
	return listQuery{
		Kind:     strings.TrimSpace(q.Get("kind")),
		From:     from,
		To:       to,
		Page:     page,
		PageSize: size,
	}, nil
}

func parseTime(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		utc := t.UTC()
		return &utc, nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		utc := t.UTC()
		return &utc, nil
	}
	return nil, fmt.Errorf("bad_time")
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
	query, err := parseListQuery(r)
	if err != nil {
		http.Error(w, `{"error":"bad_query"}`, http.StatusBadRequest)
		return
	}
	items, total, err := s.list(r.Context(), claims.TenantID, query)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"items": items, "total": total})
}

func (s *Service) list(ctx context.Context, tenantID string, query listQuery) ([]row, int, error) {
	args := []any{tenantID}
	where := "WHERE tenant_id = $1::uuid"
	n := 2
	if query.Kind != "" {
		where += fmt.Sprintf(" AND kind = $%d", n)
		args = append(args, query.Kind)
		n++
	}
	if query.From != nil {
		where += fmt.Sprintf(" AND created_at >= $%d", n)
		args = append(args, *query.From)
		n++
	}
	if query.To != nil {
		where += fmt.Sprintf(" AND created_at <= $%d", n)
		args = append(args, *query.To)
		n++
	}

	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM config_revisions "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (query.Page - 1) * query.PageSize
	listSQL := fmt.Sprintf(`
		SELECT id, kind, COALESCE(summary, ''), COALESCE(actor_id::text, ''), created_at
		FROM config_revisions %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, where, n, n+1)
	args = append(args, query.PageSize, offset)

	rows, err := s.db.QueryContext(ctx, listSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []row
	for rows.Next() {
		var item row
		var at time.Time
		if err := rows.Scan(&item.ID, &item.Kind, &item.Summary, &item.ActorID, &at); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = at.UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	if items == nil {
		items = []row{}
	}
	return items, total, rows.Err()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
