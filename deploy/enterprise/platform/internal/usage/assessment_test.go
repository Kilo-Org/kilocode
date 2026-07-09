package usage

import "testing"

func TestLnNorm(t *testing.T) {
	if lnNorm(0, 100) != 0 {
		t.Fatal("zero value")
	}
	got := lnNorm(50, 100)
	if got <= 0 || got >= 100 {
		t.Fatalf("expected between 0 and 100, got %v", got)
	}
	if lnNorm(100, 100) != 100 {
		t.Fatalf("max should be 100, got %v", lnNorm(100, 100))
	}
}

func TestEfficiencyMultZeroOutput(t *testing.T) {
	if efficiencyMult(0, 100, 50, 0) != 0.82 {
		t.Fatal("high token zero output")
	}
	if efficiencyMult(0, 40, 50, 0) != 0.95 {
		t.Fatal("low token zero output")
	}
	if efficiencyMult(0, 0, 50, 0) != 1 {
		t.Fatal("no token")
	}
}

func TestEfficiencyMultPercentile(t *testing.T) {
	if efficiencyMult(1000, 100, 50, 0.85) != 1.15 {
		t.Fatal("p80+")
	}
	if efficiencyMult(1000, 100, 50, 0.70) != 1.08 {
		t.Fatal("p60-80")
	}
	if efficiencyMult(1000, 100, 50, 0.50) != 1.00 {
		t.Fatal("p40-60")
	}
	if efficiencyMult(1000, 100, 50, 0.30) != 0.95 {
		t.Fatal("p20-40")
	}
}

func TestGrade(t *testing.T) {
	if grade(85) != "A(优秀)" {
		t.Fatal("A")
	}
	if grade(65) != "B(良好)" {
		t.Fatal("B")
	}
	if grade(45) != "C(达标)" {
		t.Fatal("C")
	}
	if grade(25) != "D(待提升)" {
		t.Fatal("D")
	}
	if grade(10) != "E(需关注)" {
		t.Fatal("E")
	}
}

func TestScoreAssessmentOrder(t *testing.T) {
	cfg := defaultAssessmentConfig()
	rows := scoreAssessment([]assessInput{
		{name: "低", email: "low@test.com", active: 3, aiChars: 100, tokens: 1000, activeP: 5},
		{name: "高", email: "high@test.com", active: 5, aiChars: 10000, tokens: 50000, activeP: 50},
	}, cfg)
	if len(rows) != 2 {
		t.Fatal("expected 2 rows")
	}
	if rows[0].Email != "high@test.com" {
		t.Fatal("higher score should rank first")
	}
	if rows[0].Rank != 1 || rows[1].Rank != 2 {
		t.Fatal("rank assignment")
	}
}

func TestAssessmentFromSummary(t *testing.T) {
	in := assessmentFromSummary([]userSummaryRow{{
		Name:                    "测试",
		Email:                   "a@test.com",
		ActiveDays:              4,
		CompletionAcceptedChars: 100,
		AgentAcceptedChars:      200,
		Tokens:                  1000,
		AgentTriggered:          3,
		CompletionAccepted:      7,
	}})
	if in[0].aiChars != 300 {
		t.Fatalf("ai chars %d", in[0].aiChars)
	}
	if in[0].activeP != 10 {
		t.Fatalf("active %d", in[0].activeP)
	}
}
