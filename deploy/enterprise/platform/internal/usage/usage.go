package usage

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"enterprise-platform/internal/auth"
)

type Service struct {
	db *sql.DB
}

type summary struct {
	LicenseUsage int `json:"licenseUsage"`
	Users        int `json:"users"`
}

type dailyRow struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type clientRow struct {
	Client    string `json:"client"`
	MachineID string `json:"machineId"`
	Count     int    `json:"count"`
	LastAt    string `json:"lastAt"`
}

type detail struct {
	Days    int         `json:"days"`
	Daily   []dailyRow  `json:"daily"`
	Clients []clientRow `json:"clients"`
}

func New(db *sql.DB) *Service {
	return &Service{db: db}
}

func parseDays(raw string) int {
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 7
	}
	if n > 90 {
		return 90
	}
	return n
}

func (s *Service) SummaryHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	sum, err := s.summary(r.Context(), claims.TenantID)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, sum)
}

func (s *Service) DetailHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	days := parseDays(r.URL.Query().Get("days"))
	out, err := s.detail(r.Context(), claims.TenantID, days)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

func (s *Service) summary(ctx context.Context, tenantID string) (summary, error) {
	var sum summary
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM license_usage lu
		JOIN licenses l ON l.id = lu.license_id
		WHERE l.tenant_id = $1::uuid
	`, tenantID).Scan(&sum.LicenseUsage)
	if err != nil {
		return sum, err
	}
	err = s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM users WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&sum.Users)
	return sum, err
}

func (s *Service) detail(ctx context.Context, tenantID string, days int) (detail, error) {
	since := time.Now().UTC().AddDate(0, 0, -days)
	daily, err := s.daily(ctx, tenantID, since)
	if err != nil {
		return detail{}, err
	}
	clients, err := s.clients(ctx, tenantID, since)
	if err != nil {
		return detail{}, err
	}
	return detail{Days: days, Daily: daily, Clients: clients}, nil
}

func (s *Service) daily(ctx context.Context, tenantID string, since time.Time) ([]dailyRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT (lu.created_at AT TIME ZONE 'UTC')::date, COUNT(*)
		FROM license_usage lu
		JOIN licenses l ON l.id = lu.license_id
		WHERE l.tenant_id = $1::uuid AND lu.created_at >= $2
		GROUP BY 1
		ORDER BY 1
	`, tenantID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []dailyRow
	for rows.Next() {
		var item dailyRow
		var day time.Time
		if err := rows.Scan(&day, &item.Count); err != nil {
			return nil, err
		}
		item.Date = day.Format("2006-01-02")
		items = append(items, item)
	}
	if items == nil {
		items = []dailyRow{}
	}
	return items, rows.Err()
}

func (s *Service) clients(ctx context.Context, tenantID string, since time.Time) ([]clientRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT COALESCE(lu.client, ''), COALESCE(lu.machine_id, ''), COUNT(*), MAX(lu.created_at)
		FROM license_usage lu
		JOIN licenses l ON l.id = lu.license_id
		WHERE l.tenant_id = $1::uuid AND lu.created_at >= $2
		GROUP BY lu.client, lu.machine_id
		ORDER BY COUNT(*) DESC
		LIMIT 50
	`, tenantID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []clientRow
	for rows.Next() {
		var item clientRow
		var last time.Time
		if err := rows.Scan(&item.Client, &item.MachineID, &item.Count, &last); err != nil {
			return nil, err
		}
		item.LastAt = last.UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	if items == nil {
		items = []clientRow{}
	}
	return items, rows.Err()
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
