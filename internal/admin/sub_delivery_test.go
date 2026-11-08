package admin

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The public /sub/{slug} path must proxy to the embedded subscription server
// and hand back its bundle: that is the path the phone polls, and a 502 here
// (Caddy pointing at a port nobody listens on) is exactly the outage this
// change is about.
func TestPublicSubServesBundleFromEmbeddedBackend(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sub/abc" {
			t.Errorf("backend path = %q, want /sub/abc", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("#bundle\n"))
	}))
	defer backend.Close()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "env"), []byte("OLCRTC_SUB_ENABLED=true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Server{cfg: Config{ConfigDir: dir}}
	s.subscriptions = newAdminSubscriptionBackend(s.cfg)
	s.subscriptions.endpoint = backend.URL

	rec := httptest.NewRecorder()
	s.handlePublicSub(rec, httptest.NewRequest(http.MethodGet, "https://myolcrtc.mooo.com/sub/abc", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); !strings.Contains(got, "#bundle") {
		t.Fatalf("body = %q, want the bundle from the embedded server", got)
	}
}

// The embedded server binds the subscription port by default: the live unit
// already passes -sub-port and Caddy already proxies /sub/* there, so the
// public path survives a restart without another knob.
func TestSubscriptionBackendDefaultsToSubPort(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, "env")
	if err := os.WriteFile(envPath, []byte("OLCRTC_SUB_ENABLED=true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	b := newAdminSubscriptionBackend(Config{ConfigDir: dir, SubPort: 2097})
	if cfg := b.readConfig(); cfg.listen != "127.0.0.1:2097" {
		t.Fatalf("listen = %q, want 127.0.0.1:2097", cfg.listen)
	}
	if err := os.WriteFile(envPath, []byte("OLCRTC_SUB_ENABLED=true\nOLCRTC_SUB_LISTEN=127.0.0.1:4097\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if cfg := b.readConfig(); cfg.listen != "127.0.0.1:4097" {
		t.Fatalf("explicit listen = %q, want 127.0.0.1:4097", cfg.listen)
	}
}

// A configured listen address is bound as is: Caddy points /sub/* at that exact
// address, so an ephemeral port would break the public path on every restart.
func TestSubscriptionBackendKeepsConfiguredAddress(t *testing.T) {	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()

	l, err := listenSubscriptionBackend(fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = l.Close() }()

	if got := l.Addr().(*net.TCPAddr).Port; got != port {
		t.Fatalf("bound port = %d, want the configured %d", got, port)
	}
}

// A taken address falls back to an ephemeral port instead of failing the admin:
// the embedded proxy hop keeps working, and the log says why the public path
// will not reach it.
func TestSubscriptionBackendFallsBackWhenAddressIsTaken(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = taken.Close() }()

	l, err := listenSubscriptionBackend(taken.Addr().String())
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = l.Close() }()
	if l.Addr().String() == taken.Addr().String() {
		t.Fatalf("bound the taken address %s", l.Addr())
	}
}

// mirror_errors in a refresh-linked reply is a success with a warning inside:
// the phone gets its list, the Yandex mirror does not. The panel has to say so.
func TestParseMirrorErrors(t *testing.T) {
	body := []byte(`{"updated_subscriptions":["r6fwr7786"],"mirror_errors":{"r6fwr7786":"Put https://cloud-api.yandex.net/v1/disk/resources?path=/olcrtc/subscriptions: context deadline exceeded"}}`)
	errs := parseMirrorErrors(body)
	if len(errs) != 1 || !strings.Contains(errs["r6fwr7786"], "context deadline exceeded") {
		t.Fatalf("parseMirrorErrors = %v", errs)
	}

	if errs := parseMirrorErrors([]byte(`{"updated_subscriptions":["x"]}`)); len(errs) != 0 {
		t.Fatalf("no mirror_errors should be empty, got %v", errs)
	}
	if errs := parseMirrorErrors(nil); errs != nil {
		t.Fatalf("late empty body should give nil, got %v", errs)
	}
	if errs := parseMirrorErrors([]byte("not json")); errs != nil {
		t.Fatalf("garbage body should give nil, got %v", errs)
	}
	_ = json.Marshal(errs)
}
