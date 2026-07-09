package usage

import (
	"testing"
	"time"
)

func TestParseRangeDefault(t *testing.T) {
	from, to, fromStr, toStr, err := parseRange("", "")
	if err != nil {
		t.Fatal(err)
	}
	if fromStr == "" || toStr == "" {
		t.Fatal("expected date strings")
	}
	if from.After(to) {
		t.Fatal("from after to")
	}
	days := int(to.Sub(from).Hours()/24) + 1
	if days != 7 {
		t.Fatalf("expected 7 days, got %d", days)
	}
}

func TestParseRangeExplicit(t *testing.T) {
	_, _, fromStr, toStr, err := parseRange("2026-06-22", "2026-06-26")
	if err != nil {
		t.Fatal(err)
	}
	if fromStr != "2026-06-22" || toStr != "2026-06-26" {
		t.Fatalf("got %s %s", fromStr, toStr)
	}
}

func TestRate(t *testing.T) {
	if rate(0, 0) != 0 {
		t.Fatal("zero denom")
	}
	if rate(3, 10) != 30 {
		t.Fatalf("got %v", rate(3, 10))
	}
}

func TestTrend(t *testing.T) {
	if trend(100, 0, 5) != "— 数据不足" {
		t.Fatal("prev zero")
	}
	if trend(100, 100, 1) != "— 数据不足" {
		t.Fatal("active < 2")
	}
	if trend(120, 100, 3) != "📈 上升" {
		t.Fatal("up")
	}
	if trend(80, 100, 3) != "📉 下降" {
		t.Fatal("down")
	}
	if trend(105, 100, 3) != "➡️ 平稳" {
		t.Fatal("flat")
	}
}

func TestFormatIDE(t *testing.T) {
	got := formatIDE(map[string]map[string]struct{}{
		"vscode":    {"2026-06-22": {}, "2026-06-23": {}},
		"jetbrains": {"2026-06-22": {}},
	})
	if got != "vscode(2天), jetbrains(1天)" {
		t.Fatalf("got %q", got)
	}
}

func TestDisplayName(t *testing.T) {
	if displayName("张三", "a@b.com") != "张三" {
		t.Fatal("name")
	}
	if displayName("", "dev@corp.com") != "dev" {
		t.Fatal("local")
	}
}

func TestApplyEventCompletion(t *testing.T) {
	u := &userMetrics{
		ActiveDates:        map[string]struct{}{},
		IDEDates:           map[string]map[string]struct{}{},
		AgentEditedByDay:   map[string]map[string]struct{}{},
		AgentAcceptedByDay: map[string]map[string]struct{}{},
	}
	d := &dailyMetrics{}
	ide := &ideSummaryRow{IDE: "vscode"}
	ev := eventRow{
		UserEmail:    "a@b.com",
		IDE:          "vscode",
		ShanghaiDate: "2026-06-22",
		Event:        "completion.accepted",
		Metrics:      map[string]any{"chars": float64(10), "lines": float64(2)},
	}
	applyEvent(ev, u, d, ide)
	if u.CompletionAccepted != 1 || u.CompletionAcceptedChars != 10 {
		t.Fatalf("user %+v", u)
	}
	if d.CompletionAcceptedLines != 2 {
		t.Fatal("lines")
	}
}

func TestShanghaiDate(t *testing.T) {
	at, err := time.Parse(time.RFC3339, "2026-06-21T18:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	date := at.In(shanghaiLoc).Format("2006-01-02")
	if date != "2026-06-22" {
		t.Fatalf("got %s", date)
	}
}
