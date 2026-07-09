package usage

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"time"

	"enterprise-platform/internal/auth"

	"github.com/xuri/excelize/v2"
)

type AssessmentConfig struct {
	WeightOutput float64 `json:"weightOutput"`
	WeightToken  float64 `json:"weightToken"`
	WeightActive float64 `json:"weightActive"`
}

func defaultAssessmentConfig() AssessmentConfig {
	return AssessmentConfig{WeightOutput: 0.40, WeightToken: 0.30, WeightActive: 0.30}
}

type assessmentRow struct {
	Rank               int     `json:"rank"`
	Name               string  `json:"name"`
	Email              string  `json:"email"`
	ActiveDays         int     `json:"activeDays"`
	AIAcceptedChars    int64   `json:"aiAcceptedChars"`
	Tokens             int64   `json:"tokens"`
	ActiveParticipation int    `json:"activeParticipation"`
	OutputScore        float64 `json:"outputScore"`
	TokenScore         float64 `json:"tokenScore"`
	ActiveScore        float64 `json:"activeScore"`
	BaseScore          float64 `json:"baseScore"`
	EfficiencyMult     float64 `json:"efficiencyMult"`
	CompositeScore     float64 `json:"compositeScore"`
	Grade              string  `json:"grade"`
}

type gradeCount struct {
	Grade string `json:"grade"`
	Count int    `json:"count"`
}

type assessmentReport struct {
	From         string           `json:"from"`
	To           string           `json:"to"`
	Config       AssessmentConfig `json:"config"`
	Rows         []assessmentRow  `json:"rows"`
	GradeSummary []gradeCount     `json:"gradeSummary"`
}

type assessInput struct {
	name    string
	email   string
	active  int
	aiChars int64
	tokens  int64
	activeP int
}

func scoreAssessment(rows []assessInput, cfg AssessmentConfig) []assessmentRow {
	if len(rows) == 0 {
		return nil
	}
	maxAI := int64(0)
	maxToken := int64(0)
	maxActive := 0
	tokensPos := make([]int64, 0)
	for _, row := range rows {
		if row.aiChars > maxAI {
			maxAI = row.aiChars
		}
		if row.tokens > maxToken {
			maxToken = row.tokens
		}
		if row.activeP > maxActive {
			maxActive = row.activeP
		}
		if row.tokens > 0 {
			tokensPos = append(tokensPos, row.tokens)
		}
	}
	tokenMedian := medianInt64(tokensPos)
	pct := efficiencyPercentiles(rows)

	out := make([]assessmentRow, len(rows))
	for i, row := range rows {
		out[i] = assessmentRow{
			Name:                row.name,
			Email:               row.email,
			ActiveDays:          row.active,
			AIAcceptedChars:     row.aiChars,
			Tokens:              row.tokens,
			ActiveParticipation: row.activeP,
			OutputScore:         round1(lnNorm(row.aiChars, maxAI)),
			TokenScore:          round1(lnNorm(row.tokens, maxToken)),
			ActiveScore:         round1(lnNormInt(row.activeP, maxActive)),
			EfficiencyMult:      efficiencyMult(row.aiChars, row.tokens, tokenMedian, pct[row.email]),
		}
		out[i].BaseScore = round1(
			out[i].OutputScore*cfg.WeightOutput +
				out[i].TokenScore*cfg.WeightToken +
				out[i].ActiveScore*cfg.WeightActive,
		)
		out[i].CompositeScore = round1(math.Min(100, out[i].BaseScore*out[i].EfficiencyMult))
		out[i].Grade = grade(out[i].CompositeScore)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CompositeScore != out[j].CompositeScore {
			return out[i].CompositeScore > out[j].CompositeScore
		}
		return out[i].ActiveDays > out[j].ActiveDays
	})
	for i := range out {
		out[i].Rank = i + 1
	}
	return out
}

func assessmentFromSummary(users []userSummaryRow) []assessInput {
	rows := make([]assessInput, len(users))
	for i, u := range users {
		rows[i] = assessInput{
			name:    u.Name,
			email:   u.Email,
			active:  u.ActiveDays,
			aiChars: int64(u.CompletionAcceptedChars + u.AgentAcceptedChars),
			tokens:  u.Tokens,
			activeP: u.AgentTriggered + u.CompletionAccepted,
		}
	}
	return rows
}

func gradeSummary(rows []assessmentRow) []gradeCount {
	order := []string{"A(优秀)", "B(良好)", "C(达标)", "D(待提升)", "E(需关注)"}
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.Grade]++
	}
	out := make([]gradeCount, 0, len(order))
	for _, g := range order {
		if counts[g] > 0 {
			out = append(out, gradeCount{Grade: g, Count: counts[g]})
		}
	}
	return out
}

func lnNorm(v, max int64) float64 {
	if v <= 0 || max <= 0 {
		return 0
	}
	return math.Log(float64(v)+1) / math.Log(float64(max)+1) * 100
}

func lnNormInt(v, max int) float64 {
	if v <= 0 || max <= 0 {
		return 0
	}
	return math.Log(float64(v)+1) / math.Log(float64(max)+1) * 100
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func medianInt64(vals []int64) int64 {
	if len(vals) == 0 {
		return 0
	}
	cp := append([]int64(nil), vals...)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	mid := len(cp) / 2
	if len(cp)%2 == 1 {
		return cp[mid]
	}
	return (cp[mid-1] + cp[mid]) / 2
}

func efficiencyPercentiles(rows []assessInput) map[string]float64 {
	type pair struct {
		email string
		eff   float64
	}
	pos := make([]pair, 0)
	for _, row := range rows {
		if row.tokens <= 0 || row.aiChars <= 0 {
			continue
		}
		pos = append(pos, pair{
			email: row.email,
			eff:   float64(row.aiChars) / float64(row.tokens),
		})
	}
	sort.Slice(pos, func(i, j int) bool { return pos[i].eff < pos[j].eff })
	out := map[string]float64{}
	n := len(pos)
	if n == 0 {
		return out
	}
	if n == 1 {
		out[pos[0].email] = 1
		return out
	}
	for i, p := range pos {
		out[p.email] = float64(i) / float64(n-1)
	}
	return out
}

func efficiencyMult(aiChars, tokens, tokenMedian int64, pctRank float64) float64 {
	if tokens <= 0 {
		return 1
	}
	if aiChars <= 0 {
		if tokens <= tokenMedian {
			return 0.95
		}
		return 0.82
	}
	if pctRank > 0.80 {
		return 1.15
	}
	if pctRank > 0.60 {
		return 1.08
	}
	if pctRank > 0.40 {
		return 1.00
	}
	return 0.95
}

func grade(score float64) string {
	if score >= 80 {
		return "A(优秀)"
	}
	if score >= 60 {
		return "B(良好)"
	}
	if score >= 40 {
		return "C(达标)"
	}
	if score >= 20 {
		return "D(待提升)"
	}
	return "E(需关注)"
}

func (s *Service) buildAssessment(ctx context.Context, tenantID string, from, to time.Time, fromStr, toStr string) (assessmentReport, error) {
	rep, err := s.buildReport(ctx, tenantID, from, to, fromStr, toStr)
	if err != nil {
		return assessmentReport{}, err
	}
	cfg := defaultAssessmentConfig()
	rows := scoreAssessment(assessmentFromSummary(rep.UserSummary), cfg)
	return assessmentReport{
		From:         fromStr,
		To:           toStr,
		Config:       cfg,
		Rows:         rows,
		GradeSummary: gradeSummary(rows),
	}, nil
}

func (s *Service) AssessmentConfigHTTP(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, defaultAssessmentConfig())
}

func (s *Service) AssessmentReportHTTP(w http.ResponseWriter, r *http.Request) {
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
	rep, err := s.buildAssessment(r.Context(), claims.TenantID, from, to, fromStr, toStr)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	writeJSON(w, rep)
}

func (s *Service) AssessmentExportHTTP(w http.ResponseWriter, r *http.Request) {
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
	rep, err := s.buildAssessment(r.Context(), claims.TenantID, from, to, fromStr, toStr)
	if err != nil {
		http.Error(w, `{"error":"db_error"}`, http.StatusInternalServerError)
		return
	}
	data, err := exportAssessmentXLSX(rep)
	if err != nil {
		http.Error(w, `{"error":"export_failed"}`, http.StatusInternalServerError)
		return
	}
	name := fmt.Sprintf("assessment_report-%s-%s.xlsx", fromStr, toStr)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	_, _ = w.Write(data)
}

func exportAssessmentXLSX(rep assessmentReport) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	sheet := "考核评分结果"
	_ = f.SetSheetName("Sheet1", sheet)
	headers := []string{
		"排名", "姓名", "邮箱", "活跃天数", "AI总采纳字符", "Token使用量",
		"活跃参与(触发+采纳)", "有效产出(40%)", "交互深度(30%)", "活跃参与(30%)",
		"基础得分", "效率乘数", "综合得分", "考核等级",
	}
	writeRow(f, sheet, 1, stringRow(headers))
	for i, row := range rep.Rows {
		writeRow(f, sheet, i+2, []any{
			row.Rank, row.Name, row.Email, row.ActiveDays, row.AIAcceptedChars, row.Tokens,
			row.ActiveParticipation, row.OutputScore, row.TokenScore, row.ActiveScore,
			row.BaseScore, row.EfficiencyMult, row.CompositeScore, row.Grade,
		})
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
