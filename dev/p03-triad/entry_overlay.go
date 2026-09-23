// Read-only Go overlay added to Identity's internal/artifacthandoff test package by `go test -overlay`
// (never copied into that working tree). Browser acceptance of the practice save entry: the real provider with
// the formal candidate enabled (formal policy row + formal_pairs allow-list, Identity's own lab helpers), its
// clock following wall time, the request-ID middleware and native Basic authentication in front, and a
// laboratory TLS front for id.pkuailab.com signed by the driver's isolated CA. The practice accounts named by
// the configuration (numeric users.id values of the isolated practice database) replace the fixture's
// 'p-teacher' source link so the real server's sessions can be issued tickets. Everything else (real practice
// server + Vite + Playwright, unmodified T11 cmd/t11-lab) is driven by <I03_TRIAD_DRIVER>/scenarios.py.
package artifacthandoff

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
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

func TestP03EntryTriad(t *testing.T) {
	var config map[string]any
	if json.Unmarshal([]byte(os.Getenv("I03_CURRENT_CONFIG")), &config) != nil {
		t.Fatal("missing isolated config")
	}
	cases, ok := config["cases"].([]any)
	if !ok || len(cases) == 0 {
		t.Fatal("missing case inventory")
	}
	linked, _ := config["linked_source_accounts"].([]any)
	if len(linked) == 0 {
		t.Fatal("missing practice account inventory")
	}
	spec, ok := config["tls"].(map[string]any)
	if !ok {
		t.Fatal("laboratory TLS front required for the production transport")
	}
	for _, item := range cases {
		scenario := item.(string)
		t.Run(scenario, func(t *testing.T) {
			l := setup(t)
			l.server.Close()
			l.enableFormal()
			// The provider's clock follows wall time (whole seconds): the real practice server and the browser run on
			// the wall clock, so no side is moved in this laboratory.
			l.clock.Store(time.Now().Unix())
			stopClock := make(chan struct{})
			go func() {
				ticker := time.NewTicker(200 * time.Millisecond)
				defer ticker.Stop()
				for {
					select {
					case <-stopClock:
						return
					case <-ticker.C:
						l.clock.Store(time.Now().Unix())
					}
				}
			}()
			defer close(stopClock)
			owner := uuid.NewString()
			l.sql(`UPDATE identity.platform_account_links SET status='unlinked',unlinked_at=clock_timestamp() WHERE local_account_id=$1`, targetLocal)
			l.sql(`INSERT INTO identity.platform_account_links(platform_client_id,global_person_id,local_account_id,created_at,linked_at) SELECT platform_client_id,global_person_id,$1,now(),now() FROM identity.platform_account_links WHERE local_account_id=$2`, owner, targetLocal)
			// Source side: the fixture's synthetic 'p-teacher' gives way to the isolated practice database's real
			// numeric account ids (one global person, one target account). Accounts absent here stay unlinked, so
			// Identity refuses them at issue exactly as it would in production.
			l.sql(`UPDATE identity.platform_account_links SET status='unlinked',unlinked_at=clock_timestamp() WHERE local_account_id='p-teacher'`)
			for _, account := range linked {
				l.sql(`INSERT INTO identity.platform_account_links(platform_client_id,global_person_id,local_account_id,created_at,linked_at) VALUES($1,$2,$3,now(),now())`, sourceID, personID, account.(string))
			}
			var mu sync.Mutex
			phases := []string{}
			redeemed, legacy, unauthenticated := 0, 0, 0
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
					unauthenticated++
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
			pair, e := tls.LoadX509KeyPair(spec["cert"].(string), spec["key"].(string))
			if e != nil {
				t.Fatal("laboratory certificate unavailable")
			}
			secure := httptest.NewUnstartedServer(router)
			secure.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
			secure.StartTLS()
			defer secure.Close()
			cfg := map[string]any{}
			for k, v := range config {
				cfg[k] = v
			}
			cfg["case"], cfg["owner"], cfg["identity_url"], cfg["identity_tls_url"], cfg["epoch"] = scenario, owner, l.server.URL, secure.URL, epoch
			cfg["source_auth"] = "Basic " + base64.StdEncoding.EncodeToString([]byte("ai-platform-client:"+sourceSecret))
			cfg["source_secret"] = sourceSecret // the real server derives the same Basic credential from its Identity configuration
			cfg["target_secret"] = targetSecret
			input, _ := json.Marshal(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", filepath.Join(os.Getenv("I03_TRIAD_DRIVER"), "scenarios.py"))
			cmd.Stdin = bytes.NewReader(input)
			out, e := cmd.Output()
			mu.Lock()
			diagnostic, _ := json.Marshal(map[string]any{"case": scenario, "issue_phases": phases, "redeemed": redeemed, "legacy_calls": legacy, "unauthenticated_calls": unauthenticated})
			_ = os.WriteFile(filepath.Join(os.Getenv("I03_TRIAD_EVIDENCE"), "observed-"+scenario+".json"), diagnostic, 0600)
			mu.Unlock()
			if e != nil {
				if ee, ok := e.(*exec.ExitError); ok {
					t.Log(string(ee.Stderr)) // fixed step/error identifiers only
				}
				t.Fatal("entry acceptance case failed; see sanitized case evidence")
			}
			var answer struct {
				Case       string `json:"case"`
				Passed     bool   `json:"passed"`
				Operations int    `json:"operations"`
			}
			if json.Unmarshal(out, &answer) != nil || answer.Case != scenario || !answer.Passed || answer.Operations < 1 {
				t.Fatal("case not proven")
			}
			mu.Lock()
			defer mu.Unlock()
			if len(phases) == 0 || legacy != 0 || unauthenticated != 0 {
				t.Fatal("native endpoints not exercised with native authentication")
			}
			if redeemed == 0 {
				t.Fatal("target never redeemed")
			}
			// Every Identity operation the browser session created is accounted for by the driver: no hidden extra
			// operation from a duplicate click, a retry or a reload, and none from a refused account.
			if l.count("identity.artifact_handoff_operations") != answer.Operations {
				t.Fatal("operation inventory differs from the driver's account")
			}
			var wrongWire int
			if l.pool.QueryRow(context.Background(), "SELECT count(*) FROM identity.artifact_handoff_operations WHERE protocol_version<>$1", FormalVersion).Scan(&wrongWire) != nil || wrongWire != 0 {
				t.Fatal("operation recorded on another wire")
			}
			encoded, _ := json.Marshal(map[string]any{"case": scenario, "issue_phases": phases, "redeemed": redeemed, "legacy_calls": legacy,
				"operation_count": answer.Operations, "wire": FormalVersion, "provider_role": "pku_identity_app", "formal_pairs": "practice-synthetic -> tedna-synthetic",
				"source_hops_tls": true, "linked_source_accounts": len(linked), "clock": "wall time (whole seconds)"})
			if os.WriteFile(filepath.Join(os.Getenv("I03_TRIAD_EVIDENCE"), "identity-"+scenario+".json"), encoded, 0600) != nil {
				t.Fatal("evidence write")
			}
		})
	}
}
