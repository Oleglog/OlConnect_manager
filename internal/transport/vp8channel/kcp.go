// Package vp8channel provides byte transport over VP8 video frames using KCP.
/*
ЯНДЕКС РАБ ИЛИ КТО ТЫ НАУЙ СУКА КАРОЧЕ ХУЙЛО КЕБАНОГЕ ИЗ ЯНДЕКС ЧИТАЮЩИЙ ЭТО
МЫ ОСЕМЕНИМ ВТОЮ МАМАШКУ МЕРТВУЮ
*/
package vp8channel

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"

	kcp "github.com/xtaci/kcp-go/v5"
)

// Both peers establish a KCP session with the same convid. KCP does not
// require a handshake - packets are matched by conv field, so a static
// constant gives us a symmetrical P2P setup.
const kcpConvID = 0xC0FFEE01

// KCP tuning targets a lossy, bursty carrier (VP8 over an SFU). The defaults
// are TCP-like and recover slowly after burst losses.
const (
	// kcp-go hardcodes mtuLimit=1500, so SetMtu() above this is silently
	// clamped. Stay below that with headroom for KCP overhead (24 bytes).
	kcpMTU = 1400

	// Send/receive window in segments, sized to the bandwidth-delay product of
	// the policed video path, NOT to "as much as possible". A large send window
	// let the upper layer dump megabytes into KCP instantly; with the wire paced
	// to the carrier's real capacity those segments then sat queued for seconds,
	// so KCP's RTO fired over a standing backlog and every loss turned into a
	// retransmit storm that starved the control plane. 128 segments at a
	// 1080-byte MTU bounds in-flight data to ~138 KB — about one RTT of wire at
	// 600 KB/s, well above the ~130 KB/s a one-sample-per-tick writer emits — so
	// the window never becomes a queue. Measured 2026-11-07: 768 segments left a
	// ~830 KB standing queue and 149 KB/s of pure retransmissions with nothing
	// for the application.
	kcpSndWnd = 128
	kcpRcvWnd = 1024

	// Length prefix for our message framing on top of KCP stream mode.
	// We use stream mode because UDPSession.Write fragments messages > MSS
	// outside of kcp.Send, which destroys the frg field that message mode
	// relies on for boundary preservation. Adding our own length-prefix
	// framing sidesteps that bug entirely.
	kcpLenPrefix = 4

	// defaultSegMTU is the segment size the transport asks for when the
	// operator sets no vp8.mtu. KCP in stream mode coalesces queued writes into
	// segments up to the MTU, so this — not the application payload cap — is
	// what decides the size of one wire sample: a sample is one segment plus
	// epochHdrLen + batch framing, and 1080 + 38 stays inside one RTP packet at
	// a 1200-byte path MTU. A sample that fragments is all-or-nothing at the
	// peer's reassembler: one lost packet discards the whole frame, so every
	// fragmented sample costs a full KCP retransmission round.
	defaultSegMTU = 1080

	// Hard cap on a single message. Anything larger would require an
	// unbounded reassembly buffer on the receiver and is almost certainly
	// a protocol error upstream.
	kcpMaxMessage = 8 * 1024 * 1024
)

// ErrKCPMessageTooLarge is returned by send when the message exceeds
// kcpMaxMessage.
var ErrKCPMessageTooLarge = errors.New("vp8channel: kcp message exceeds maximum size")

// Application-level send counters. appSendBytes is what the tunnel actually
// asked the transport to move, before KCP fragmentation, batching and
// retransmission; wireOutBytes (kcpconn.go) is what went out on the wire. The
// ratio names a stalled sender versus a retransmit storm without needing KCP
// internals.
//nolint:gochecknoglobals // diagnostics counters, read by the stats line
var (
	appSendPkts  atomic.Int64
	appSendBytes atomic.Int64
)

// kcpRuntime owns the KCP session and the goroutine that pumps reassembled
// messages from KCP up to cfg.OnData.
type kcpRuntime struct {
	conn      *kcpConn
	sess      *kcp.UDPSession
	readDone  chan struct{}
	writeMu   sync.Mutex // serializes framed writes; also guards writeBuf
	writeBuf  []byte     // framing scratch, reused under writeMu
	closeOnce sync.Once
}

// kcpParams carries the per-session tuning the transport configures. Zero
// fields keep the package defaults, so callers that only need the wire format
// (tests) can leave them out.
type kcpParams struct {
	out      chan<- []byte
	onData   func([]byte)
	epochHdr [epochHdrLen]byte
	// mtu caps one KCP segment and therefore one wire sample.
	mtu int
	// enableCC turns KCP's loss-based congestion control on.
	enableCC bool
}

func startKCP(out chan<- []byte, onData func([]byte), epochHdr [epochHdrLen]byte) (*kcpRuntime, error) {
	return startKCPWith(kcpParams{out: out, onData: onData, epochHdr: epochHdr})
}

func startKCPWith(p kcpParams) (*kcpRuntime, error) {
	out, onData, epochHdr := p.out, p.onData, p.epochHdr
	mtu := p.mtu
	if mtu <= 0 {
		mtu = kcpMTU
	}
	noCongestionControl := 1
	if p.enableCC {
		noCongestionControl = 0
	}
	c := newKCPConn(out, inboundQueueSize, epochHdr)

	sess, err := kcp.NewConn3(kcpConvID, fakeUDPAddr(), nil, 0, 0, c)
	if err != nil {
		_ = c.Close()
		return nil, fmt.Errorf("kcp new conn: %w", err)
	}

	// nodelay=1, interval=5ms, fast resend=2, congestion control OFF by default.
	// KCP does not regulate the send rate here — the writer paces the frames.
	// KCP's own loss-based congestion control is the wrong controller when the
	// constraint is a policer rather than the network: with cc on, the
	// unavoidable drops collapsed cwnd and starved the wire. With cc off KCP
	// keeps the window full and retransmits the losses.
	sess.SetNoDelay(1, 5, 2, noCongestionControl)
	sess.SetWindowSize(kcpSndWnd, kcpRcvWnd)
	sess.SetMtu(mtu)
	// Upstream marked SetStreamMode deprecated without providing a replacement;
	// stream framing is still required for our wire format.
	sess.SetStreamMode(true) //nolint:staticcheck // SA1019: no replacement upstream.
	sess.SetACKNoDelay(true)
	sess.SetWriteDelay(false)

	rt := &kcpRuntime{
		conn:     c,
		sess:     sess,
		readDone: make(chan struct{}),
	}

	go rt.readLoop(onData)

	return rt, nil
}

func (r *kcpRuntime) readLoop(onData func([]byte)) {
	defer close(r.readDone)

	var hdr [kcpLenPrefix]byte
	for {
		if _, err := io.ReadFull(r.sess, hdr[:]); err != nil {
			return
		}
		size := binary.BigEndian.Uint32(hdr[:])
		if size == 0 {
			continue
		}
		if size > kcpMaxMessage {
			// Stream framing is now corrupted - there is no safe way to
			// resync without a session reset. Bail and let the upper layer
			// reconnect.
			return
		}
		payload := make([]byte, size)
		if _, err := io.ReadFull(r.sess, payload); err != nil {
			return
		}
		if onData != nil {
			onData(payload)
		}
	}
}

// deliver hands a wire payload (already reassembled out of VP8 RTP) to KCP.
func (r *kcpRuntime) deliver(payload []byte) {
	r.conn.deliver(payload)
}

// send queues an application message for reliable delivery. The length prefix
// and the payload go out in ONE write: two writes under a mutex stop
// concurrent senders interleaving, but do not make the pair atomic against
// failure. If the header lands and the payload does not, the stream carries a
// prefix for bytes that were never sent and the reader cannot resynchronise -
// every message boundary after it is wrong while the bytes themselves arrive
// intact and in order, so KCP reports nothing and the tunnel silently stops
// working.
func (r *kcpRuntime) send(msg []byte) error {
	if len(msg) > kcpMaxMessage {
		return ErrKCPMessageTooLarge
	}

	r.writeMu.Lock()
	defer r.writeMu.Unlock()

	need := kcpLenPrefix + len(msg)
	if cap(r.writeBuf) < need {
		r.writeBuf = make([]byte, need)
	}
	buf := r.writeBuf[:need]
	binary.BigEndian.PutUint32(buf[:kcpLenPrefix], uint32(len(msg))) //nolint:gosec,lll // G115: bounded conversion verified by surrounding logic
	copy(buf[kcpLenPrefix:], msg)

	if _, err := r.sess.Write(buf); err != nil {
		return fmt.Errorf("kcp write framed message: %w", err)
	}
	appSendPkts.Add(1)
	appSendBytes.Add(int64(len(msg)))
	return nil
}

func (r *kcpRuntime) close() {
	r.closeOnce.Do(func() {
		_ = r.sess.Close()
		_ = r.conn.Close()
	})
}
