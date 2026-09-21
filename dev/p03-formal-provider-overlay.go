// Read-only Go overlay added to Identity's internal/artifacthandoff test package by `go test -overlay`;
// never copied into that working tree. It enables the rc2 formal candidate on the real provider lab,
// exposes only its injected clock to the P03 scenario driver and checks the operation ledger afterwards.
package artifacthandoff

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Logical Identity operations expected after each scenario (default 1).
var p03FormalOperations = map[string]int{"reconciliation_exit": 0}

func TestP03FormalProvider(t *testing.T) {
	root := os.Getenv("I03_P03_ROOT")
	var mysql map[string]any
	if root == "" || json.Unmarshal([]byte(os.Getenv("P03_MYSQL_LAB")), &mysql) != nil {
		t.Skip("P03 formal provider check requires I03_P03_ROOT and an isolated P03_MYSQL_LAB")
	}
	for _, scenario := range []string{"formal_success", "v10_lost_first_issue", "v10_first_issue_in_flight", "v11_recovery_window",
		"v12a_write_ticket_cut", "v12b_status_ticket_cut", "v13_local_deadline", "v13_success_survives_local_deadline", "reconciliation_exit"} {
		t.Run(scenario, func(t *testing.T) {
			l := setup(t)
			l.enableFormal()
			clock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var change struct {
					Now int64 `json:"now"`
				}
				if r.Method != "POST" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 64)).Decode(&change) != nil ||
					change.Now < epoch || change.Now > epoch+40*86400 {
					w.WriteHeader(400)
					return
				}
				l.clock.Store(change.Now)
				w.WriteHeader(200)
			}))
			defer clock.Close()
			input, _ := json.Marshal(map[string]any{"practice_root": root, "case": scenario, "epoch": epoch, "clock_url": clock.URL,
				"identity_url": l.server.URL, "mysql": mysql, "evidence": os.Getenv("P03_FORMAL_EVIDENCE"),
				"source_auth": "Basic " + base64.StdEncoding.EncodeToString([]byte("ai-platform-client:"+sourceSecret)),
				"target_auth": "Basic " + base64.StdEncoding.EncodeToString([]byte("tedna-client:"+targetSecret))})
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", filepath.Join(root, "dev/p03-formal-scenarios.py"))
			cmd.Stdin = bytes.NewReader(input)
			out, err := cmd.Output()
			if err != nil {
				// Driver diagnostics only contain fixed step/error identifiers, never bodies or credentials.
				if e, ok := err.(*exec.ExitError); ok {
					t.Log(string(e.Stderr))
				}
				t.Fatal("P03 formal scenario failed")
			}
			var result struct {
				Case   string `json:"case"`
				Passed bool   `json:"passed"`
			}
			if json.Unmarshal(out, &result) != nil || !result.Passed || result.Case != scenario {
				t.Fatal("incomplete formal scenario result")
			}
			expected, known := p03FormalOperations[scenario]
			if !known {
				expected = 1
			}
			if l.count("identity.artifact_handoff_operations") != expected {
				t.Fatal("logical Identity operation count changed")
			}
			var wrongWire int
			if l.pool.QueryRow(context.Background(), "SELECT count(*) FROM identity.artifact_handoff_operations WHERE protocol_version<>$1", FormalVersion).Scan(&wrongWire) != nil || wrongWire != 0 {
				t.Fatal("operation recorded on another wire")
			}
			var metadata string
			if l.pool.QueryRow(context.Background(), "SELECT COALESCE(json_agg(t)::text, '[]') FROM identity.artifact_handoff_operations t").Scan(&metadata) != nil {
				t.Fatal("metadata scan failed")
			}
			for _, forbidden := range []string{"先观察", "activity.md", "manifest_b64", "conversation_id", "PRIVATE_THINKING"} {
				if strings.Contains(metadata, forbidden) {
					t.Fatal("content entered Identity")
				}
			}
		})
	}
}
