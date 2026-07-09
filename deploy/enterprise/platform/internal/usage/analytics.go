package usage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"enterprise-platform/internal/auth"

	"github.com/xuri/excelize/v2"
)

var shanghaiLoc *time.Location

var validEvents = map[string]bool{
	"completion.suggested":       true,
	"completion.accepted":        true,
	"comment.line.generated":     true,
	"comment.line.accepted":      true,
	"comment.func.generated":     true,
	"comment.func.accepted":      true,
	"optimize.generated":         true,
	"optimize.accepted":          true,
	"agent.task.triggered":       true,
	"agent.file.edited":          true,
	"agent.file.edit_accepted":   true,
	"inline.accepted":            true,
	"human.chars":                true,
	"llm.tokens":                 true,
}

var validIDE = map[string]bool{
	"vscode":    true,
	"jetbrains": true,
	"android":   true,
}

func init() {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	shanghaiLoc = loc
}

type ingestItem struct {
	IDE        string         `json:"ide"`
	OccurredAt string         `json:"occurred_at"`
	Event      string         `json:"event"`
	Metrics    map[string]any `json:"metrics"`
}

type ingestReq struct {
	Events []ingestItem `json:"events"`
}

type eventRow struct {
	UserEmail   string
	IDE         string
	ShanghaiDate string
	Event       string
	Metrics     map[string]any
}

type userMetrics struct {
	Email                   string
	Name                    string
	ActiveDates             map[string]struct{}
	IDEDates                map[string]map[string]struct{}
	CompletionSuggested     int
	CompletionAccepted      int
	CompletionAcceptedLines int
	CompletionAcceptedChars int
	AgentTriggered          int
	AgentEditedByDay        map[string]map[string]struct{}
	AgentAcceptedByDay      map[string]map[string]struct{}
	AgentAcceptedChars      int
	InlineChars             int
	Tokens                  int64
}

type dailyMetrics struct {
	Date                    string
	Email                   string
	Name                    string
	IDE                     string
	CompletionSuggested     int
	CompletionAccepted      int
	CompletionAcceptedLines int
	CompletionAcceptedChars int
	AgentTriggered          int
	AgentEdited             int
	AgentAccepted           int
	AgentAcceptedChars      int
	InlineChars             int
	Tokens                  int64
}

type report struct {
	From           string           `json:"from"`
	To             string           `json:"to"`
	UserSummary    []userSummaryRow `json:"userSummary"`
	IDESummary     []ideSummaryRow  `json:"ideSummary"`
	DailyDetail    []dailyDetailRow `json:"dailyDetail"`
	InactiveUsers  []inactiveRow    `json:"inactiveUsers"`
}

type userSummaryRow struct {
	Rank                    int     `json:"rank"`
	Name                    string  `json:"name"`
	Email                   string  `json:"email"`
	IDE                     string  `json:"ide"`
	ActiveDays              int     `json:"activeDays"`
	Trend                   string  `json:"trend"`
	CompletionSuggested     int     `json:"completionSuggested"`
	CompletionAccepted      int     `json:"completionAccepted"`
	CompletionAcceptedLines int     `json:"completionAcceptedLines"`
	CommentLineGenerated    int     `json:"commentLineGenerated"`
	CommentLineAccepted     int     `json:"commentLineAccepted"`
	CommentFuncGenerated    int     `json:"commentFuncGenerated"`
	CommentFuncAccepted     int     `json:"commentFuncAccepted"`
	OptimizeGenerated       int     `json:"optimizeGenerated"`
	OptimizeAccepted        int     `json:"optimizeAccepted"`
	AgentTriggered          int     `json:"agentTriggered"`
	AgentFileEdited         int     `json:"agentFileEdited"`
	AgentFileEditAccepted   int     `json:"agentFileEditAccepted"`
	CompletionAcceptedChars int     `json:"completionAcceptedChars"`
	InlineChars             int     `json:"inlineChars"`
	AgentAcceptedChars      int     `json:"agentAcceptedChars"`
	HumanChars              int     `json:"humanChars"`
	Tokens                  int64   `json:"tokens"`
	CompletionAcceptRate    float64 `json:"completionAcceptRate"`
	CommentLineAcceptRate   float64 `json:"commentLineAcceptRate"`
	CommentFuncAcceptRate   float64 `json:"commentFuncAcceptRate"`
	OptimizeAcceptRate      float64 `json:"optimizeAcceptRate"`
	AgentEditAcceptRate     float64 `json:"agentEditAcceptRate"`
}

type ideSummaryRow struct {
	IDE                     string  `json:"ide"`
	CompletionSuggested     int     `json:"completionSuggested"`
	CompletionAccepted      int     `json:"completionAccepted"`
	CompletionAcceptedLines int     `json:"completionAcceptedLines"`
	CommentLineGenerated    int     `json:"commentLineGenerated"`
	CommentLineAccepted     int     `json:"commentLineAccepted"`
	CommentFuncGenerated    int     `json:"commentFuncGenerated"`
	CommentFuncAccepted     int     `json:"commentFuncAccepted"`
	OptimizeGenerated       int     `json:"optimizeGenerated"`
	OptimizeAccepted        int     `json:"optimizeAccepted"`
	AgentTriggered          int     `json:"agentTriggered"`
	AgentFileEdited         int     `json:"agentFileEdited"`
	AgentFileEditAccepted   int     `json:"agentFileEditAccepted"`
	CompletionAcceptedChars int     `json:"completionAcceptedChars"`
	InlineChars             int     `json:"inlineChars"`
	AgentAcceptedChars      int     `json:"agentAcceptedChars"`
	HumanChars              int     `json:"humanChars"`
	Tokens                  int64   `json:"tokens"`
}

type dailyDetailRow struct {
	Date                    string `json:"date"`
	Name                    string `json:"name"`
	Email                   string `json:"email"`
	IDE                     string `json:"ide"`
	CompletionSuggested     int    `json:"completionSuggested"`
	CompletionAccepted      int    `json:"completionAccepted"`
	CompletionAcceptedLines int    `json:"completionAcceptedLines"`
	CommentLineGenerated    int    `json:"commentLineGenerated"`
	CommentLineAccepted     int    `json:"commentLineAccepted"`
	CommentFuncGenerated    int    `json:"commentFuncGenerated"`
	CommentFuncAccepted     int    `json:"commentFuncAccepted"`
	OptimizeGenerated       int    `json:"optimizeGenerated"`
	OptimizeAccepted        int    `json:"optimizeAccepted"`
	AgentTriggered          int    `json:"agentTriggered"`
	AgentFileEdited         int    `json:"agentFileEdited"`
	AgentFileEditAccepted   int    `json:"agentFileEditAccepted"`
	CompletionAcceptedChars int    `json:"completionAcceptedChars"`
	InlineChars             int    `json:"inlineChars"`
	AgentAcceptedChars      int    `json:"agentAcceptedChars"`
	HumanChars              int    `json:"humanChars"`
	Tokens                  int64  `json:"tokens"`
}

type inactiveRow struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (s *Service) EventsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	var req ingestReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
		return
	}
	if len(req.Events) == 0 {
		http.Error(w, `{"error":"empty_events"}`, http.StatusBadRequest)
		return
	}
	if len(req.Events) > 100 {
		http.Error(w, `{"error":"too_many_events"}`, http.StatusBadRequest)
		return
	}
	email, err := s.userEmail(r.Context(), claims.TenantID, claims.Subject)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"user_not_found"}`, http.StatusForbidden)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	n, err := s.ingest(r.Context(), claims.TenantID, email, req.Events)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]any{"accepted": n})
}

func (s *Service) ReportHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if !canViewAnalytics(claims.Roles) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	from, to, fromStr, toStr, err := parseRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		http.Error(w, `{"error":"bad_range"}`, http.StatusBadRequest)
		return
	}
	rep, err := s.buildReport(r.Context(), claims.TenantID, from, to, fromStr, toStr)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, rep)
}

func (s *Service) ExportHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if !canViewAnalytics(claims.Roles) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	from, to, fromStr, toStr, err := parseRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		http.Error(w, `{"error":"bad_range"}`, http.StatusBadRequest)
		return
	}
	rep, err := s.buildReport(r.Context(), claims.TenantID, from, to, fromStr, toStr)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	data, err := exportXLSX(rep)
	if err != nil {
		http.Error(w, `{"error":"export_failed"}`, http.StatusInternalServerError)
		return
	}
	name := fmt.Sprintf("analysis_report-%s-%s.xlsx", fromStr, toStr)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	_, _ = w.Write(data)
}

func canViewAnalytics(roles []string) bool {
	for _, role := range roles {
		switch role {
		case "sys_admin", "tenant_admin", "audit_admin":
			return true
		}
	}
	return false
}

func (s *Service) userEmail(ctx context.Context, tenantID, userID string) (string, error) {
	var email string
	err := s.db.QueryRowContext(ctx, `
		SELECT email FROM users WHERE id = $1::uuid AND tenant_id = $2::uuid
	`, userID, tenantID).Scan(&email)
	return email, err
}

func (s *Service) ingest(ctx context.Context, tenantID, email string, items []ingestItem) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	n := 0
	for _, item := range items {
		ide := strings.TrimSpace(item.IDE)
		event := strings.TrimSpace(item.Event)
		if !validIDE[ide] {
			return 0, fmt.Errorf("bad_ide")
		}
		if !validEvents[event] {
			return 0, fmt.Errorf("bad_event")
		}
		at, err := time.Parse(time.RFC3339, strings.TrimSpace(item.OccurredAt))
		if err != nil {
			return 0, fmt.Errorf("bad_occurred_at")
		}
		metrics := item.Metrics
		if metrics == nil {
			metrics = map[string]any{}
		}
		raw, err := json.Marshal(metrics)
		if err != nil {
			return 0, fmt.Errorf("bad_metrics")
		}
		date := at.In(shanghaiLoc).Format("2006-01-02")
		_, err = tx.ExecContext(ctx, `
			INSERT INTO usage_events (tenant_id, user_email, ide, occurred_at, shanghai_date, event, metrics)
			VALUES ($1::uuid, $2, $3, $4, $5::date, $6, $7::jsonb)
		`, tenantID, email, ide, at.UTC(), date, event, raw)
		if err != nil {
			return 0, err
		}
		n++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

func parseRange(fromStr, toStr string) (time.Time, time.Time, string, string, error) {
	now := time.Now().In(shanghaiLoc)
	toDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, shanghaiLoc)
	fromDay := toDay.AddDate(0, 0, -6)
	if toStr != "" {
		t, err := time.ParseInLocation("2006-01-02", toStr, shanghaiLoc)
		if err != nil {
			return time.Time{}, time.Time{}, "", "", err
		}
		toDay = t
	}
	if fromStr != "" {
		t, err := time.ParseInLocation("2006-01-02", fromStr, shanghaiLoc)
		if err != nil {
			return time.Time{}, time.Time{}, "", "", err
		}
		fromDay = t
	}
	if fromDay.After(toDay) {
		return time.Time{}, time.Time{}, "", "", fmt.Errorf("from after to")
	}
	from := fromDay
	to := toDay.Add(24*time.Hour - time.Nanosecond)
	return from, to, fromDay.Format("2006-01-02"), toDay.Format("2006-01-02"), nil
}

func (s *Service) loadEvents(ctx context.Context, tenantID string, from, to time.Time) ([]eventRow, error) {
	fromDate := from.In(shanghaiLoc).Format("2006-01-02")
	toDate := to.In(shanghaiLoc).Format("2006-01-02")
	rows, err := s.db.QueryContext(ctx, `
		SELECT user_email, ide, shanghai_date::text, event, metrics
		FROM usage_events
		WHERE tenant_id = $1::uuid AND shanghai_date >= $2::date AND shanghai_date <= $3::date
	`, tenantID, fromDate, toDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []eventRow
	for rows.Next() {
		var item eventRow
		var raw []byte
		if err := rows.Scan(&item.UserEmail, &item.IDE, &item.ShanghaiDate, &item.Event, &raw); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &item.Metrics)
		if item.Metrics == nil {
			item.Metrics = map[string]any{}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) loadNames(ctx context.Context, tenantID string) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT email, COALESCE(NULLIF(display_name, ''), '')
		FROM users WHERE tenant_id = $1::uuid
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var email, name string
		if err := rows.Scan(&email, &name); err != nil {
			return nil, err
		}
		names[email] = displayName(name, email)
	}
	return names, rows.Err()
}

func displayName(name, email string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	if i := strings.Index(email, "@"); i > 0 {
		return email[:i]
	}
	return email
}

func (s *Service) sumTokens(ctx context.Context, tenantID string, from, to time.Time) (int64, error) {
	fromDate := from.In(shanghaiLoc).Format("2006-01-02")
	toDate := to.In(shanghaiLoc).Format("2006-01-02")
	var total sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(
			COALESCE((metrics->>'input')::bigint, 0) + COALESCE((metrics->>'output')::bigint, 0)
		), 0)
		FROM usage_events
		WHERE tenant_id = $1::uuid AND event = 'llm.tokens'
		  AND shanghai_date >= $2::date AND shanghai_date <= $3::date
	`, tenantID, fromDate, toDate).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total.Int64, nil
}

func (s *Service) buildReport(ctx context.Context, tenantID string, from, to time.Time, fromStr, toStr string) (report, error) {
	events, err := s.loadEvents(ctx, tenantID, from, to)
	if err != nil {
		return report{}, err
	}
	names, err := s.loadNames(ctx, tenantID)
	if err != nil {
		return report{}, err
	}
	users := map[string]*userMetrics{}
	daily := map[string]*dailyMetrics{}
	ideAgg := map[string]*ideSummaryRow{
		"vscode":    {IDE: "vscode"},
		"jetbrains": {IDE: "jetbrains"},
		"android":   {IDE: "android"},
	}
	active := map[string]struct{}{}

	for _, ev := range events {
		active[ev.UserEmail] = struct{}{}
		u := users[ev.UserEmail]
		if u == nil {
			u = &userMetrics{
				Email:            ev.UserEmail,
				Name:             names[ev.UserEmail],
				ActiveDates:      map[string]struct{}{},
				IDEDates:         map[string]map[string]struct{}{},
				AgentEditedByDay: map[string]map[string]struct{}{},
				AgentAcceptedByDay: map[string]map[string]struct{}{},
			}
			if u.Name == "" {
				u.Name = displayName("", ev.UserEmail)
			}
			users[ev.UserEmail] = u
		}
		u.ActiveDates[ev.ShanghaiDate] = struct{}{}
		if u.IDEDates[ev.IDE] == nil {
			u.IDEDates[ev.IDE] = map[string]struct{}{}
		}
		u.IDEDates[ev.IDE][ev.ShanghaiDate] = struct{}{}

		dkey := ev.ShanghaiDate + "\x00" + ev.UserEmail + "\x00" + ev.IDE
		d := daily[dkey]
		if d == nil {
			d = &dailyMetrics{
				Date:  ev.ShanghaiDate,
				Email: ev.UserEmail,
				Name:  u.Name,
				IDE:   ev.IDE,
			}
			daily[dkey] = d
		}

		applyEvent(ev, u, d, ideAgg[ev.IDE])
	}

	days := int(to.Sub(from).Hours()/24) + 1
	prevTo := from.Add(-24 * time.Hour)
	prevFrom := prevTo.AddDate(0, 0, -(days - 1))
	prevTokens, _ := s.sumTokens(ctx, tenantID, prevFrom, prevTo)

	userRows := make([]userSummaryRow, 0, len(users))
	for _, u := range users {
		agentEdited := 0
		for _, paths := range u.AgentEditedByDay {
			agentEdited += len(paths)
		}
		agentAccepted := 0
		for _, paths := range u.AgentAcceptedByDay {
			agentAccepted += len(paths)
		}
		row := userSummaryRow{
			Name:                    u.Name,
			Email:                   u.Email,
			IDE:                     formatIDE(u.IDEDates),
			ActiveDays:              len(u.ActiveDates),
			Trend:                   trend(u.Tokens, prevTokens, len(u.ActiveDates)),
			CompletionSuggested:     u.CompletionSuggested,
			CompletionAccepted:      u.CompletionAccepted,
			CompletionAcceptedLines: u.CompletionAcceptedLines,
			AgentTriggered:          u.AgentTriggered,
			AgentFileEdited:         agentEdited,
			AgentFileEditAccepted:   agentAccepted,
			CompletionAcceptedChars: u.CompletionAcceptedChars,
			InlineChars:             u.InlineChars,
			AgentAcceptedChars:      u.AgentAcceptedChars,
			Tokens:                  u.Tokens,
			CompletionAcceptRate:    rate(u.CompletionAccepted, u.CompletionSuggested),
			AgentEditAcceptRate:     rate(agentAccepted, agentEdited),
		}
		userRows = append(userRows, row)
	}
	sort.Slice(userRows, func(i, j int) bool {
		if userRows[i].Tokens != userRows[j].Tokens {
			return userRows[i].Tokens > userRows[j].Tokens
		}
		return userRows[i].ActiveDays > userRows[j].ActiveDays
	})
	for i := range userRows {
		userRows[i].Rank = i + 1
	}

	dailyRows := make([]dailyDetailRow, 0, len(daily))
	for _, d := range daily {
		dailyRows = append(dailyRows, dailyDetailRow{
			Date:                    d.Date,
			Name:                    d.Name,
			Email:                   d.Email,
			IDE:                     d.IDE,
			CompletionSuggested:     d.CompletionSuggested,
			CompletionAccepted:      d.CompletionAccepted,
			CompletionAcceptedLines: d.CompletionAcceptedLines,
			AgentTriggered:          d.AgentTriggered,
			AgentFileEdited:         d.AgentEdited,
			AgentFileEditAccepted:   d.AgentAccepted,
			CompletionAcceptedChars: d.CompletionAcceptedChars,
			InlineChars:             d.InlineChars,
			AgentAcceptedChars:      d.AgentAcceptedChars,
			Tokens:                  d.Tokens,
		})
	}
	sort.Slice(dailyRows, func(i, j int) bool {
		if dailyRows[i].Date != dailyRows[j].Date {
			return dailyRows[i].Date < dailyRows[j].Date
		}
		if dailyRows[i].Email != dailyRows[j].Email {
			return dailyRows[i].Email < dailyRows[j].Email
		}
		return dailyRows[i].IDE < dailyRows[j].IDE
	})

	ideRows := []ideSummaryRow{*ideAgg["vscode"], *ideAgg["jetbrains"], *ideAgg["android"]}

	inactive, err := s.inactiveUsers(ctx, tenantID, active, names)
	if err != nil {
		return report{}, err
	}

	return report{
		From:          fromStr,
		To:            toStr,
		UserSummary:   userRows,
		IDESummary:    ideRows,
		DailyDetail:   dailyRows,
		InactiveUsers: inactive,
	}, nil
}

func applyEvent(ev eventRow, u *userMetrics, d *dailyMetrics, ide *ideSummaryRow) {
	switch ev.Event {
	case "completion.suggested":
		u.CompletionSuggested++
		d.CompletionSuggested++
		ide.CompletionSuggested++
	case "completion.accepted":
		u.CompletionAccepted++
		d.CompletionAccepted++
		chars := metricInt(ev.Metrics, "chars")
		lines := metricInt(ev.Metrics, "lines")
		if lines < 1 {
			lines = 1
		}
		u.CompletionAcceptedChars += chars
		u.CompletionAcceptedLines += lines
		d.CompletionAcceptedChars += chars
		d.CompletionAcceptedLines += lines
		ide.CompletionAccepted++
		ide.CompletionAcceptedChars += chars
		ide.CompletionAcceptedLines += lines
	case "agent.task.triggered":
		u.AgentTriggered++
		d.AgentTriggered++
		ide.AgentTriggered++
	case "agent.file.edited":
		path := metricStr(ev.Metrics, "path")
		key := ev.IDE + "\x00" + path
		if u.AgentEditedByDay[ev.ShanghaiDate] == nil {
			u.AgentEditedByDay[ev.ShanghaiDate] = map[string]struct{}{}
		}
		if _, ok := u.AgentEditedByDay[ev.ShanghaiDate][key]; !ok {
			u.AgentEditedByDay[ev.ShanghaiDate][key] = struct{}{}
			d.AgentEdited++
			ide.AgentFileEdited++
		}
	case "agent.file.edit_accepted":
		path := metricStr(ev.Metrics, "path")
		key := ev.IDE + "\x00" + path
		if u.AgentAcceptedByDay[ev.ShanghaiDate] == nil {
			u.AgentAcceptedByDay[ev.ShanghaiDate] = map[string]struct{}{}
		}
		if _, ok := u.AgentAcceptedByDay[ev.ShanghaiDate][key]; !ok {
			u.AgentAcceptedByDay[ev.ShanghaiDate][key] = struct{}{}
			d.AgentAccepted++
			ide.AgentFileEditAccepted++
		}
		chars := metricInt(ev.Metrics, "chars")
		u.AgentAcceptedChars += chars
		d.AgentAcceptedChars += chars
		ide.AgentAcceptedChars += chars
	case "inline.accepted":
		chars := metricInt(ev.Metrics, "chars")
		u.InlineChars += chars
		d.InlineChars += chars
		ide.InlineChars += chars
	case "llm.tokens":
		tokens := metricInt64(ev.Metrics, "input") + metricInt64(ev.Metrics, "output")
		u.Tokens += tokens
		d.Tokens += tokens
		ide.Tokens += tokens
	}
}

func formatIDE(ideDates map[string]map[string]struct{}) string {
	order := []string{"vscode", "jetbrains", "android"}
	parts := []string{}
	for _, ide := range order {
		dates := ideDates[ide]
		if len(dates) == 0 {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s(%d天)", ide, len(dates)))
	}
	return strings.Join(parts, ", ")
}

func trend(tokens, prevTokens int64, activeDays int) string {
	if activeDays < 2 || prevTokens == 0 {
		return "— 数据不足"
	}
	delta := float64(tokens-prevTokens) / float64(prevTokens)
	if delta >= 0.1 {
		return "📈 上升"
	}
	if delta <= -0.1 {
		return "📉 下降"
	}
	return "➡️ 平稳"
}

func rate(num, den int) float64 {
	if den == 0 {
		return 0
	}
	return math.Round(float64(num)/float64(den)*10000) / 100
}

func metricInt(m map[string]any, key string) int {
	return int(metricInt64(m, key))
}

func metricInt64(m map[string]any, key string) int64 {
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	default:
		return 0
	}
}

func metricStr(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

func (s *Service) inactiveUsers(ctx context.Context, tenantID string, active map[string]struct{}, names map[string]string) ([]inactiveRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT email, COALESCE(NULLIF(display_name, ''), '')
		FROM users WHERE tenant_id = $1::uuid ORDER BY email
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []inactiveRow
	for rows.Next() {
		var email, name string
		if err := rows.Scan(&email, &name); err != nil {
			return nil, err
		}
		if _, ok := active[email]; ok {
			continue
		}
		items = append(items, inactiveRow{
			Name:  displayName(name, email),
			Email: email,
		})
	}
	if items == nil {
		items = []inactiveRow{}
	}
	return items, rows.Err()
}

func exportXLSX(rep report) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	_ = f.SetSheetName("Sheet1", "用户汇总")
	writeUserSheet(f, "用户汇总", rep.UserSummary)
	_, _ = f.NewSheet("IDE分类统计")
	writeIDESheet(f, "IDE分类统计", rep.IDESummary)
	_, _ = f.NewSheet("每日明细")
	writeDailySheet(f, "每日明细", rep.DailyDetail)
	_, _ = f.NewSheet("未使用用户")
	writeInactiveSheet(f, "未使用用户", rep.InactiveUsers)
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeUserSheet(f *excelize.File, sheet string, rows []userSummaryRow) {
	headers := []string{
		"排名", "姓名", "邮箱", "IDE", "活跃天数", "趋势",
		"补全建议次数", "补全采纳次数", "补全采纳行数",
		"逐行注释生成次数", "逐行注释采纳次数", "函数注释生成次数", "函数注释采纳次数",
		"代码优化生成次数", "代码优化采纳次数",
		"智能体任务触发次数", "智能体任务编辑文件次数", "采纳智能体任务编辑文件次数",
		"代码补全采纳字符", "inline采纳字符", "智能体编程采纳字符", "人工产生字符",
		"Token使用量",
		"补全采纳率", "逐行注释采纳率", "函数注释采纳率", "代码优化采纳率", "智能体编辑采纳率",
	}
	writeRow(f, sheet, 1, stringRow(headers))
	for i, row := range rows {
		writeRow(f, sheet, i+2, []any{
			row.Rank, row.Name, row.Email, row.IDE, row.ActiveDays, row.Trend,
			row.CompletionSuggested, row.CompletionAccepted, row.CompletionAcceptedLines,
			0, 0, 0, 0, 0, 0,
			row.AgentTriggered, row.AgentFileEdited, row.AgentFileEditAccepted,
			row.CompletionAcceptedChars, row.InlineChars, row.AgentAcceptedChars, 0,
			row.Tokens,
			fmt.Sprintf("%.2f%%", row.CompletionAcceptRate),
			"0.00%", "0.00%", "0.00%",
			fmt.Sprintf("%.2f%%", row.AgentEditAcceptRate),
		})
	}
}

func writeIDESheet(f *excelize.File, sheet string, rows []ideSummaryRow) {
	headers := []string{
		"IDE",
		"补全建议次数", "补全采纳次数", "补全采纳行数",
		"逐行注释生成次数", "逐行注释采纳次数", "函数注释生成次数", "函数注释采纳次数",
		"代码优化生成次数", "代码优化采纳次数",
		"智能体任务触发次数", "智能体任务编辑文件次数", "采纳智能体任务编辑文件次数",
		"代码补全采纳字符", "inline采纳字符", "智能体编程采纳字符", "人工产生字符",
		"Token使用量",
	}
	writeRow(f, sheet, 1, stringRow(headers))
	for i, row := range rows {
		writeRow(f, sheet, i+2, []any{
			row.IDE,
			row.CompletionSuggested, row.CompletionAccepted, row.CompletionAcceptedLines,
			0, 0, 0, 0, 0, 0,
			row.AgentTriggered, row.AgentFileEdited, row.AgentFileEditAccepted,
			row.CompletionAcceptedChars, row.InlineChars, row.AgentAcceptedChars, 0,
			row.Tokens,
		})
	}
}

func writeDailySheet(f *excelize.File, sheet string, rows []dailyDetailRow) {
	headers := []string{
		"日期", "姓名", "邮箱", "IDE",
		"补全建议次数", "补全采纳次数", "补全采纳行数",
		"逐行注释生成次数", "逐行注释采纳次数", "函数注释生成次数", "函数注释采纳次数",
		"代码优化生成次数", "代码优化采纳次数",
		"智能体任务触发次数", "智能体任务编辑文件次数", "采纳智能体任务编辑文件次数",
		"代码补全采纳字符", "inline采纳字符", "智能体编程采纳字符", "人工产生字符",
		"Token使用量",
	}
	writeRow(f, sheet, 1, stringRow(headers))
	for i, row := range rows {
		writeRow(f, sheet, i+2, []any{
			row.Date, row.Name, row.Email, row.IDE,
			row.CompletionSuggested, row.CompletionAccepted, row.CompletionAcceptedLines,
			0, 0, 0, 0, 0, 0,
			row.AgentTriggered, row.AgentFileEdited, row.AgentFileEditAccepted,
			row.CompletionAcceptedChars, row.InlineChars, row.AgentAcceptedChars, 0,
			row.Tokens,
		})
	}
}

func writeInactiveSheet(f *excelize.File, sheet string, rows []inactiveRow) {
	writeRow(f, sheet, 1, stringRow([]string{"姓名", "邮箱"}))
	for i, row := range rows {
		writeRow(f, sheet, i+2, []any{row.Name, row.Email})
	}
}

func writeRow(f *excelize.File, sheet string, row int, vals []any) {
	for i, v := range vals {
		cell, _ := excelize.CoordinatesToCellName(i+1, row)
		_ = f.SetCellValue(sheet, cell, v)
	}
}

func stringRow(vals []string) []any {
	out := make([]any, len(vals))
	for i, v := range vals {
		out[i] = v
	}
	return out
}
