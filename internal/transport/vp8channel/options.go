package vp8channel

import (
	"fmt"

	"github.com/openlibrecommunity/olcrtc/internal/transport"
)

const (
	defaultFPS       = 60
	defaultBatchSize = 64
	// defaultMaxBytesPerSec is disabled by default. Earlier defaults capped the
	// fake-VP8 wire rate around 1.2 MB/s, which protected some SFUs from bursts
	// but also throttled real tunnel throughput. Keep the knob for manual safe
	// mode, but do not limit speed unless the user explicitly configures it.
	//
	// Measured starting points for vp8.max_bytes_per_sec (2026-11-07, one client
	// in the room): Telemost sustains about 24 KB/s delivered at a 50 KB/s
	// budget with the control RTT under a second, and collapses back into a
	// 27-42 s control RTT with liveness teardowns at 90-120 KB/s. Both figures
	// are opt-in only: shipping the 50 KB/s budget by default made the
	// interactive page load slower than the unpaced default, and a default may
	// not cost interactivity.
	defaultMaxBytesPerSec = 0
)

// Options tunes the vp8channel transport. Zero values fall back to documented defaults.
type Options struct {
	FPS       int
	BatchSize int
	// MaxBytesPerSec caps the data rate handed to KCP. Zero means unset, which
	// keeps the package default (unlimited); a negative value means explicitly
	// unlimited as well, so an operator can turn a budget off from a config that
	// inherited one. The measured starting points live in defaultMaxBytesPerSec.
	MaxBytesPerSec int
	// MaxSampleBytes caps one sample (one VP8 frame on the wire). Zero keeps
	// the package default.
	MaxSampleBytes int
	// MTU is the KCP segment size. It caps the wire sample directly (a sample
	// is one KCP segment plus framing), so it decides whether a sample fits in
	// one RTP packet. Zero keeps the package default.
	MTU int
	// EnableCC turns KCP's loss-based congestion control on. It is off by
	// default because the carrier's policer, not the network, used to be the
	// constraint; on a genuinely lossy path it stops the retransmit storm.
	EnableCC bool
	// SndWnd overrides the KCP send window in segments. It bounds the queue the
	// control probe waits behind. Zero keeps the package default.
	SndWnd int
}

// TransportOptions marks Options as belonging to the transport options family.
func (Options) TransportOptions() {}

func optionsFrom(cfg transport.Config) (Options, error) {
	if cfg.Options == nil {
		return Options{}, nil
	}
	opts, ok := cfg.Options.(Options)
	if !ok {
		return Options{}, fmt.Errorf("%w: vp8channel: got %T", transport.ErrOptionsTypeMismatch, cfg.Options)
	}
	return opts, nil
}
