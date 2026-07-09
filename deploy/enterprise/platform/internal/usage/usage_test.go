package usage

import "testing"

func TestParseDays(t *testing.T) {
	if parseDays("") != 7 {
		t.Fatal("empty defaults to 7")
	}
	if parseDays("30") != 30 {
		t.Fatal("expected 30")
	}
	if parseDays("0") != 7 {
		t.Fatal("zero defaults to 7")
	}
	if parseDays("999") != 90 {
		t.Fatal("capped at 90")
	}
}
