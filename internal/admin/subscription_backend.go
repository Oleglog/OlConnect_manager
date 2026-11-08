package admin

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/user"
	"strconv"
	"strings"
	"sync"

	"github.com/openlibrecommunity/olcrtc/internal/logger"
	"github.com/openlibrecommunity/olcrtc/internal/subscription/mirror"
	subserver "github.com/openlibrecommunity/olcrtc/internal/subscription/server"
	"github.com/openlibrecommunity/olcrtc/internal/subscription/store"
)

type adminSubscriptionBackend struct {
	cfg Config

	mu       sync.RWMutex
	endpoint string
	apiToken string
	server   *subserver.Server
}

type adminSubscriptionConfig struct {
	enabled  bool
	dbPath   string
	apiToken string
	listen   string
	mirror   *mirror.Manager
}

// listenSubscriptionBackend binds the embedded subscription server. A
// configured address is bound as is, because the public /sub path is routed to
// that exact address: an ephemeral port changes on every restart and Caddy
// would keep answering 502. If the address is already taken (an external
// subscription server owns it), the backend falls back to an ephemeral port and
// says so in the log - the admin proxy hop keeps working, and the operator sees
// why the public path stopped reaching it.
func listenSubscriptionBackend(addr string) (net.Listener, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return net.Listen("tcp", "127.0.0.1:0")
	}
	if !strings.Contains(addr, ":") {
		addr = "127.0.0.1:" + addr
	}
	l, err := net.Listen("tcp", addr)
	if err == nil {
		logger.Infof("subscription server bound to the configured address %s", addr)
		return l, nil
	}
	logger.Errorf("subscription server cannot bind %s: %v; falling back to an ephemeral port, the public /sub path will keep answering 502 until -sub-listen points at a free address", addr, err)
	return net.Listen("tcp", "127.0.0.1:0")
}

func newAdminSubscriptionBackend(cfg Config) *adminSubscriptionBackend {
	return &adminSubscriptionBackend{cfg: cfg}
}

func (b *adminSubscriptionBackend) start(ctx context.Context) error {
	cfg := b.readConfig()
	b.mu.Lock()
	b.apiToken = cfg.apiToken
	b.mu.Unlock()
	if !cfg.enabled {
		return nil
	}

	st, err := store.Open(cfg.dbPath)
	if err != nil {
		return fmt.Errorf("open subscription db: %w", err)
	}
	shareSubscriptionDBWithLegacyServer(cfg.dbPath)
	listener, err := listenSubscriptionBackend(cfg.listen)
	if err != nil {
		_ = st.Close()
		return fmt.Errorf("listen for subscription backend: %w", err)
	}

	srv := subserver.New(st, 0, cfg.apiToken, cfg.mirror)
	b.mu.Lock()
	b.endpoint = "http://" + listener.Addr().String()
	b.server = srv
	b.mu.Unlock()

	go func() {
		defer func() { _ = listener.Close() }()
		err := srv.Serve(ctx, listener)
		_ = st.Close()
		b.mu.Lock()
		if b.server == srv {
			b.endpoint = ""
			b.server = nil
		}
		b.mu.Unlock()
		if err != nil && ctx.Err() == nil {
			logger.Errorf("admin subscription backend stopped: %v", err)
		}
	}()
	return nil
}

func shareSubscriptionDBWithLegacyServer(dbPath string) {
	account, err := user.Lookup("olcrtc")
	if err != nil {
		return
	}
	uid, uidErr := strconv.Atoi(account.Uid)
	gid, gidErr := strconv.Atoi(account.Gid)
	if uidErr != nil || gidErr != nil {
		return
	}
	for _, path := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		_ = os.Chown(path, uid, gid)
		_ = os.Chmod(path, 0660)
	}
}

func (b *adminSubscriptionBackend) readConfig() adminSubscriptionConfig {
	vals := ReadInstanceEnv(InstanceEnvPath(b.cfg.ConfigDir, 0))
	rawEnabled, configured := vals["OLCRTC_SUB_ENABLED"]
	enabled := true
	if configured {
		switch strings.ToLower(strings.TrimSpace(rawEnabled)) {
		case "", "0", "false", "no", "n":
			enabled = false
		}
	}
	dbPath := strings.TrimSpace(vals["OLCRTC_SUB_DB"])
	if dbPath == "" {
		dbPath = "/var/lib/olcrtc/subscriptions.db"
	}
	mEnabled, mProvider, mToken, mBase := ReadMirrorConfig(b.cfg.ConfigDir)
	mProxy := ReadMirrorProxy(b.cfg.ConfigDir)
	if mEnabled && mProxy == "" {
		logger.Warnf("subscription mirror is on but OLCRTC_SUB_MIRROR_PROXY is empty: uploads to cloud-api.yandex.net go out over the direct egress, which is blocked here, and will time out. Set OLCRTC_SUB_MIRROR_PROXY=127.0.0.1:40000")
	}
	return adminSubscriptionConfig{
		enabled:  enabled,
		dbPath:   dbPath,
		apiToken: strings.TrimSpace(vals["OLCRTC_SUB_API_TOKEN"]),
		listen:   strings.TrimSpace(vals["OLCRTC_SUB_LISTEN"]),
		mirror: mirror.New(mirror.Config{
			Enabled:    mEnabled,
			Provider:   mProvider,
			OAuthToken: mToken,
			BasePath:   mBase,
			Proxy:      mProxy,
		}),
	}
}

func (b *adminSubscriptionBackend) endpointURL(path string) (string, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.endpoint == "" {
		return "", false
	}
	return b.endpoint + path, true
}

func (b *adminSubscriptionBackend) token() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.apiToken
}

func (b *adminSubscriptionBackend) running() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.endpoint != ""
}

func (b *adminSubscriptionBackend) enabled() bool {
	return b.readConfig().enabled
}

func (b *adminSubscriptionBackend) reloadMirror() {
	cfg := b.readConfig()
	b.mu.RLock()
	srv := b.server
	b.mu.RUnlock()
	if srv != nil {
		srv.SetMirror(cfg.mirror)
	}
}
