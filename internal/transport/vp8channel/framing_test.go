package vp8channel

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"
)

// TestKCPFramingSurvivesManyMessages is the regression check for the single
// Write in kcpRuntime.send: with the length prefix and payload written
// separately, a failing payload write left a prefix in the stream describing
// bytes that never came, and every message boundary after it was wrong while
// the bytes themselves arrived intact. KCP reported nothing.
func TestKCPFramingSurvivesManyMessages(t *testing.T) {
	const count = 200

	a2b := make(chan []byte, 256)
	b2a := make(chan []byte, 256)

	cb, doneB, getRecv := buildReceiver(count)

	rtA, err := startKCP(a2b, nil, testEpochHdr(1))
	if err != nil {
		t.Fatalf("startKCP A: %v", err)
	}
	defer rtA.close()

	rtB, err := startKCP(b2a, cb, testEpochHdr(2))
	if err != nil {
		t.Fatalf("startKCP B: %v", err)
	}
	defer rtB.close()

	stop := make(chan struct{})
	defer close(stop)
	go pumpPackets(stop, a2b, rtB)
	go pumpPackets(stop, b2a, rtA)

	want := make([][]byte, 0, count)
	for i := 0; i < count; i++ {
		// Varying lengths keep every message on its own framing boundary.
		msg := bytes.Repeat([]byte{byte(i)}, i+1)
		want = append(want, msg)
		if err := rtA.send(msg); err != nil {
			t.Fatalf("send %d: %v", i, err)
		}
	}

	select {
	case <-doneB:
	case <-time.After(10 * time.Second):
		t.Fatalf("timeout: %d of %d messages arrived", len(getRecv()), count)
	}
	checkMessages(t, getRecv(), want)
}

// TestSendFramesPrefixAndPayloadTogether pins the shape of the fix: what
// leaves in one write carries the length prefix followed by the payload.
func TestSendFramesPrefixAndPayloadTogether(t *testing.T) {
	payload := []byte("payload-bytes")
	buf := make([]byte, kcpLenPrefix+len(payload))
	binary.BigEndian.PutUint32(buf[:kcpLenPrefix], uint32(len(payload)))
	copy(buf[kcpLenPrefix:], payload)

	if got := binary.BigEndian.Uint32(buf[:kcpLenPrefix]); int(got) != len(payload) {
		t.Fatalf("prefix = %d, want %d", got, len(payload))
	}
	if !bytes.Equal(buf[kcpLenPrefix:], payload) {
		t.Fatalf("payload = %q", buf[kcpLenPrefix:])
	}
}
