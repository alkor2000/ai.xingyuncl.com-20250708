// Read-only Go overlay in I03's test package; never copied into its working tree.
package provider

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

// Expected logical Identity operations per scenario: the held record never reaches Identity;
// the second lab owner has no Identity link and only proves isolation; every other scenario keeps one.
var p03IdentityOperations = map[string]int{"hold_retention": 0}

func TestP03MySQLSource(t *testing.T) {
	for _, scenario := range []string{"duplicates", "revoke", "version", "attachment", "rollback", "revoke_before_release", "release_before_revoke", "cancel_before_redeem", "lost_commit_restart", "kill_after_commit", "lock_connection_lost", "expiry_cleanup", "restricted_role", "multi_owner", "hold_retention"} {
		t.Run(scenario, func(t *testing.T) {
			l := setup(t)
			clock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var change struct {
					Seconds int64 `json:"seconds"`
				}
				if r.Method != "POST" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 64)).Decode(&change) != nil || change.Seconds < 1 || change.Seconds > 31*86400 {
					w.WriteHeader(400)
					return
				}
				l.clock.Add(change.Seconds)
				w.WriteHeader(200)
			}))
			defer clock.Close()
			var mysql map[string]any
			if json.Unmarshal([]byte(os.Getenv("P03_MYSQL_LAB")), &mysql) != nil {
				t.Fatal("isolated source DB required")
			}
			root := os.Getenv("I03_P03_ROOT")
			input, _ := json.Marshal(map[string]any{"practice_root": root, "case": scenario, "clock": epoch, "clock_url": clock.URL,
				"identity_url": l.server.URL, "mysql": mysql,
				"source_auth": "Basic " + base64.StdEncoding.EncodeToString([]byte("ai-platform-client:"+sourceSecret)),
				"target_auth": "Basic " + base64.StdEncoding.EncodeToString([]byte("tedna-client:"+targetSecret))})
			ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", filepath.Join(root, "dev/p03-durable-scenarios.py"))
			cmd.Stdin = bytes.NewReader(input)
			out, err := cmd.Output()
			if err != nil {
				// Driver diagnostics only contain fixed step/error identifiers, never body or credentials.
				if e, ok := err.(*exec.ExitError); ok {
					t.Log(string(e.Stderr))
				}
				t.Fatal("P03 durable-source scenario failed")
			}
			var result struct {
				Case   string `json:"case"`
				Passed bool   `json:"passed"`
			}
			if json.Unmarshal(out, &result) != nil || !result.Passed || result.Case != scenario {
				t.Fatal("incomplete durable-source result")
			}
			expected, known := p03IdentityOperations[scenario]
			if !known {
				expected = 1
			}
			if l.count("lab_operations") != expected {
				t.Fatal("logical Identity operation changed")
			}
			var metadata string
			if l.pool.QueryRow(context.Background(), "SELECT COALESCE(json_agg(t)::text, '[]') FROM lab_operations t").Scan(&metadata) != nil {
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
