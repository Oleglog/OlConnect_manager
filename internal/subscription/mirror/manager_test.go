package mirror

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestDeleteRemovesMirrorWhilePublishingDisabled(t *testing.T) {	manager := New(Config{
		Enabled:    false,
		Provider:   "yandex_disk",
		OAuthToken: "secret",
		BasePath:   "/custom/subscriptions",
	})
	manager.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodDelete {
			t.Fatalf("method = %s, want DELETE", req.Method)
		}
		if got := req.URL.Query().Get("path"); got != "/custom/subscriptions/example.json" {
			t.Fatalf("path = %q", got)
		}
		if got := req.URL.Query().Get("permanently"); got != "true" {
			t.Fatalf("permanently = %q", got)
		}
		if got := req.Header.Get("Authorization"); got != "OAuth secret" {
			t.Fatalf("authorization = %q", got)
		}
		return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody, Header: make(http.Header)}, nil
	})}

	if err := manager.Delete(context.Background(), "example"); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptLinesPreservesSubscriptionProfiles(t *testing.T) {
	key, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	profiles := []string{
		"olcrtc://wbstream@r/room-one?k=one&c=client-one",
		"olcrtc://telemost@r/room-two?k=two&c=client-two",
	}
	data, err := EncryptLines(profiles, key)
	if err != nil {
		t.Fatal(err)
	}
	var encrypted envelope
	if err := json.Unmarshal(data, &encrypted); err != nil {
		t.Fatal(err)
	}
	keyBytes, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := base64.RawURLEncoding.DecodeString(encrypted.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(encrypted.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(plain), strings.Join(profiles, "\n")+"\n"; got != want {
		t.Fatalf("mirror plaintext = %q, want %q", got, want)
	}
}

// A mirror without a proxy is the stand's silent failure: the upload dies on a
// blocked egress and the operator only sees a timeout. With a proxy the client
// dials through SOCKS; without one the default transport stays in place and the
// error says what is missing.
func TestProxyTransport(t *testing.T) {
	if tr := proxyTransport(""); tr != nil {
		t.Fatalf("no proxy should keep the default transport, got %T", tr)
	}
	for _, raw := range []string{"127.0.0.1:40000", "socks5://127.0.0.1:40000", "socks5h://127.0.0.1:40000"} {
		tr := proxyTransport(raw)
		if tr == nil {
			t.Fatalf("proxy %q produced no transport", raw)
		}
		if _, ok := tr.(*http.Transport); !ok {
			t.Fatalf("proxy %q transport = %T, want *http.Transport", raw, tr)
		}
	}
}

func TestProxyHintOnlyWithoutProxy(t *testing.T) {
	base := errors.New("context deadline exceeded")
	if got := New(Config{Proxy: "127.0.0.1:40000"}).proxyHint(base); got != base {
		t.Fatalf("hint changed the error although a proxy is set: %v", got)
	}
	plain := New(Config{}).proxyHint(base)
	if !strings.Contains(plain.Error(), "OLCRTC_SUB_MIRROR_PROXY") {
		t.Fatalf("hint without a proxy = %q", plain)
	}
}
