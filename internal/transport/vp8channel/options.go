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
	defaultMaxBytesPerSec = 0

	// defaultTelemostBytesPerSec is the data budget used for the Telemost
	// carrier when nothing is configured. Telemost shares one KCP session
	// between the tunnel data and the control ping/pong, and its SFU loses
	// roughly half of the packets under load, so an unpaced sender builds a
	// queue that the probe has to wait behind: measured 2026-11-07, control RTT
	// went from 226 ms idle to 9-45 s under bulk, four missed pongs tore the
	// session down mid-transfer, and the achieved rate swung between 3 and
	// 52 KB/s. At 50 KB/s the same link delivered ~24 KB/s with RTT under 1 s
	// and no liveness teardown; 90-120 KB/s brought the 27 s RTT and the
	// teardown back. Raise it with vp8.max_bytes_per_sec if a build is used
	// against a carrier that can take it.
	defaultTelemostBytesPerSec = 50_000
)

// Options tunes the vp8channel transport. Zero values fall back to documented defaults.
type Options struct {
	FPS       int
	BatchSize int
	// MaxBytesPerSec caps the wire byte-rate fed to the video track. Zero means
	// unlimited unless the package default is changed by a build.
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
