// Read-only Go overlay added to Identity's internal/artifacthandoff test package by `go test -overlay`
// (never copied into that working tree). Formal-wire same-version triad: the real provider with the
// rc3 formal candidate enabled (formal policy row + formal_pairs allow-list, Identity's own lab helpers),
// an injected lab clock exposed to the P03 driver through a loopback control endpoint, the request-ID
// middleware and native Basic authentication in front. Everything else (P03 MySQL source, unmodified
// T11 cmd/t11-lab) is driven by <I03_TRIAD_DRIVER>/scenarios.py, one process per case.
package artifacthandoff

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"pkuailab.com/pkuailab-id/internal/middleware"
)

// Logical Identity operations expected per case (default 1) and cases where the target must never redeem.
var p03FormalTriadOperations = map[string]int{"recycled_restore_purge": 2}
var p03FormalTriadNoRedeem = map[string]bool{"wire_gate_off": true}

func TestP03FormalTriad(t *testing.T) {
	var config map[string]any
	if json.Unmarshal([]byte(os.Getenv("I03_CURRENT_CONFIG")), &config) != nil {
		t.Fatal("missing isolated config")
	}
	cases, ok := config["cases"].([]any)
	if !ok || len(cases) == 0 {
		t.Fatal("missing case inventory")
	}
	for _, item := range cases {
		scenario := item.(string)
		t.Run(scenario, func(t *testing.T) {
			l := setup(t)
			l.server.Close()
			l.enableFormal()
			owner := uuid.NewString()
			l.sql(`UPDATE identity.platform_account_links SET status='unlinked',unlinked_at=clock_timestamp() WHERE local_account_id=$1`, targetLocal)
			l.sql(`INSERT INTO identity.platform_account_links(platform_client_id,global_person_id,local_account_id,created_at,linked_at) SELECT platform_client_id,global_person_id,$1,now(),now() FROM identity.platform_account_links WHERE local_account_id=$2`, owner, targetLocal)
			var mu sync.Mutex
			phases := []string{}
			redeemed, legacy := 0, 0
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.Use(middleware.RequestID())
			router.Any("/*path", func(c *gin.Context) {
				mu.Lock()
				defer mu.Unlock()
				r, w := c.Request, c.Writer
				if strings.HasPrefix(r.URL.Path, "/identity/") {
					legacy++
					w.WriteHeader(404)
					return
				}
				if r.Header.Get("Authorization") == "" {
					t.Error("native authentication absent")
				}
				if r.URL.Path == PathPrefix+"issue" {
					raw, e := io.ReadAll(io.LimitReader(r.Body, 16385))
					if e != nil {
						t.Error("request read")
						return
					}
					r.Body = io.NopCloser(bytes.NewReader(raw))
					var body struct {
						Phase string `json:"phase"`
					}
					_ = json.Unmarshal(raw, &body)
					phases = append(phases, body.Phase)
				}
				if r.URL.Path == PathPrefix+"redeem" {
					redeemed++
				}
				l.p.ServeHTTP(w, r)
				if len(w.Header().Get("X-Request-ID")) != 32 {
					t.Error("native request ID absent")
				}
			})
			l.server = httptest.NewServer(router) // plain loopback: the target's redeem path (its own transport)
			// Optional laboratory TLS front for the source's hops: the same provider handler behind a certificate
			// for the production hostname signed by the driver's isolated CA. Nothing about the provider changes.
			var secure *httptest.Server
			if spec, ok := config["tls"].(map[string]any); ok {
				pair, e := tls.LoadX509KeyPair(spec["cert"].(string), spec["key"].(string))
				if e != nil {
					t.Fatal("laboratory certificate unavailable")
				}
				secure = httptest.NewUnstartedServer(router)
				secure.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
				secure.StartTLS()
				defer secure.Close()
			}
			// Injected lab clock for the driver: whole seconds inside [epoch, epoch+40d]; nothing else is exposed.
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
			cfg := map[string]any{}
			for k, v := range config {
				cfg[k] = v
			}
			cfg["case"], cfg["owner"], cfg["identity_url"], cfg["clock_url"], cfg["epoch"] = scenario, owner, l.server.URL, clock.URL, epoch
			if secure != nil {
				cfg["identity_tls_url"] = secure.URL
			}
			cfg["source_auth"] = "Basic " + base64.StdEncoding.EncodeToString([]byte("ai-platform-client:"+sourceSecret))
			cfg["target_secret"] = targetSecret
			input, _ := json.Marshal(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", filepath.Join(os.Getenv("I03_TRIAD_DRIVER"), "scenarios.py"))
			cmd.Stdin = bytes.NewReader(input)
			out, e := cmd.Output()
			mu.Lock()
			diagnostic, _ := json.Marshal(map[string]any{"case": scenario, "issue_phases": phases, "redeemed": redeemed, "legacy_calls": legacy})
			_ = os.WriteFile(filepath.Join(os.Getenv("I03_TRIAD_EVIDENCE"), "observed-"+scenario+".json"), diagnostic, 0600)
			mu.Unlock()
			if e != nil {
				if ee, ok := e.(*exec.ExitError); ok {
					t.Log(string(ee.Stderr)) // fixed step/error identifiers only
				}
				t.Fatal("formal triad case failed; see sanitized case evidence")
			}
			var answer struct {
				Case   string `json:"case"`
				Passed bool   `json:"passed"`
			}
			if json.Unmarshal(out, &answer) != nil || answer.Case != scenario || !answer.Passed {
				t.Fatal("case not proven")
			}
			mu.Lock()
			defer mu.Unlock()
			if len(phases) == 0 || legacy != 0 {
				t.Fatal("native endpoints not exercised")
			}
			if p03FormalTriadNoRedeem[scenario] != (redeemed == 0) {
				t.Fatal("redeem expectation violated")
			}
			expected, known := p03FormalTriadOperations[scenario]
			if !known {
				expected = 1
			}
			if l.count("identity.artifact_handoff_operations") != expected {
				t.Fatal("operation inventory changed")
			}
			var wrongWire int
			if l.pool.QueryRow(context.Background(), "SELECT count(*) FROM identity.artifact_handoff_operations WHERE protocol_version<>$1", FormalVersion).Scan(&wrongWire) != nil || wrongWire != 0 {
				t.Fatal("operation recorded on another wire")
			}
			if scenario == "lost_commit_restart" && strings.Join(phases, ",") != "prepare,commit,status" {
				t.Fatal("restart wrote again")
			}
			encoded, _ := json.Marshal(map[string]any{"case": scenario, "issue_phases": phases, "redeemed": redeemed, "legacy_calls": legacy,
				"operation_count": expected, "wire": FormalVersion, "provider_role": "pku_identity_app", "formal_pairs": "practice-synthetic -> tedna-synthetic",
				"source_hops_tls": secure != nil})
			if os.WriteFile(filepath.Join(os.Getenv("I03_TRIAD_EVIDENCE"), "identity-"+scenario+".json"), encoded, 0600) != nil {
				t.Fatal("evidence write")
			}
		})
	}
}
