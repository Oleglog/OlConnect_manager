package admin

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/openlibrecommunity/olcrtc/internal/logger"
)

const (
	// instanceHistoryTick is how often the recorder samples the units. The tick
	// is not the slot: a minute is finalised when the clock crosses into the next
	// one, so the ring always moves one slot per minute, not one per tick.
	instanceHistoryTick = 15 * time.Second
)

// historySignals is what the samples of one minute showed about one instance:
// what systemd said and what the unit's status file said.
type historySignals struct {
	Failed     bool // ActiveState=failed at some sample
	Inactive   bool // ActiveState=inactive at some sample (a clean stop)
	Restarted  bool // NRestarts grew or ActiveEnterTimestamp moved
	Restarts   int  // restart count seen in the minute
	Touched    bool // the unit rewrote its status file: a peer came or went
	Peers      int  // peer count at the last sample of the minute
	PeersKnown bool
}

// merge folds one sample into the minute. A minute is a whole: a death at second
// 5 is not cancelled by a restart at second 50, so the flags only ever go up.
// Peers do not accumulate — the slot reports the count at the end of the minute,
// so the last sample wins.
func (s *historySignals) merge(sample historySignals) {
	s.Failed = s.Failed || sample.Failed
	s.Inactive = s.Inactive || sample.Inactive
	s.Restarted = s.Restarted || sample.Restarted
	s.Restarts += sample.Restarts
	s.Touched = s.Touched || sample.Touched
	if sample.PeersKnown {
		s.PeersKnown = true
		s.Peers = sample.Peers
	}
}

// journalMinute is what one minute of a unit's journal said: carrier refusals,
// reconnects and the traffic the unit reported for the streams it closed.
type journalMinute struct {
	Known      bool  // the journal was readable, so Bytes is a real 0, not a gap
	Rejects    int   // carrier refusals in the minute
	Reconnects int   // reconnect lines in the minute
	Bytes      int64 // sum of in+out over the minute's traffic lines
}

var (
	// historyLimitedPatterns are the carrier refusals the ribbon calls "на
	// пределе". They are the lines the unit already prints: the boards carrier
	// answers RATE_LIMITED, HTTP carriers answer 429, and a refused write says so.
	// 429 is matched as a whole token so byte counts and ports do not trip it.
	historyLimitedPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)rate[_ -]?limited`),
		regexp.MustCompile(`(?i)write refused`),
		regexp.MustCompile(`\b429\b`),
	}
	// historyReconnectPattern is the line the exit prints when it reinstalls a
	// session: "server reconnect reason=carrier" / "... reason=liveness".
	historyReconnectPattern = regexp.MustCompile(`(?i)reconnect`)
	// historyTrafficPattern is the per-stream traffic line the exit logs when a
	// relayed stream closes: "traffic: session=... addr=... in=N out=M". It is
	// the only byte counter the exit exposes, so the slot sums it per minute and
	// the report says so: bytes are credited when a stream closes.
	historyTrafficPattern = regexp.MustCompile(`traffic: .*\bin=(\d+) out=(\d+)`)
)

// classifyJournal reads one minute of a unit's journal: how many carrier
// refusals, how many reconnects, and how many bytes the unit reported. All three
// come from the same lines the operator reads in the unit log, so the ribbon
// agrees with the journal.
func classifyJournal(text string) journalMinute {
	jm := journalMinute{Known: true}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		for _, pattern := range historyLimitedPatterns {
			if pattern.MatchString(line) {
				jm.Rejects++
				break
			}
		}
		if historyReconnectPattern.MatchString(line) {
			jm.Reconnects++
		}
		if match := historyTrafficPattern.FindStringSubmatch(line); match != nil {
			in, _ := strconv.ParseInt(match[1], 10, 64)
			out, _ := strconv.ParseInt(match[2], 10, 64)
			jm.Bytes += in + out
		}
	}
	return jm
}

// historyState collapses one minute of signals into one state letter, or "" when
// there is nothing to say. The order is the priority rule documented on the ring
// (D > I > U > P > L > no data): the first true statement wins, because it
// explains the others.
func historyState(sig historySignals, jm journalMinute) string {
	switch {
	case sig.Failed:
		return historyStateDead
	case sig.Inactive:
		return historyStateStopped
	case sig.Restarted || jm.Reconnects > 0:
		return historyStateFlapping
	case jm.Rejects > 0:
		return historyStateLimited
	case sig.PeersKnown && (sig.Peers > 0 || sig.Touched):
		return historyStateAlive
	}
	return ""
}

// historyUnitState is the part of `systemctl show` the ribbon needs. Active is
// ActiveState ("active", "inactive", "failed", "activating"...). Restarts and
// EnterAt exist because ActiveState alone cannot show a restart: a unit that
// crash-loops is "active" at every sample.
type historyUnitState struct {
	Active   string
	Restarts int
	EnterAt  int64
	Known    bool
}

// historyRecorder turns the live sources into one slot per minute. The sources
// are fields, not calls, so the rollover is testable without systemd or a journal.
type historyRecorder struct {
	history *instanceHistory
	ids     func() []int
	unit    func(service string) historyUnitState
	peers   func(id int, running bool) (peers int, updatedAt time.Time, known bool)
	journal func(service string, since, until time.Time) (string, error)
	now     func() time.Time

	// start is the minute being accumulated, sig is what its samples said per
	// instance, and last is the previous sample of each unit.
	start time.Time
	sig   map[int]*historySignals
	last  map[int]historyUnitState
}

// newHistoryRecorder wires the real sources: systemd, the instance's status file
// and its journal.
func newHistoryRecorder(history *instanceHistory, ids func() []int) *historyRecorder {
	return &historyRecorder{
		history: history,
		ids:     ids,
		unit: func(service string) historyUnitState {
			st, err := SystemctlStatusInfo(service)
			if err != nil || st == nil {
				return historyUnitState{}
			}
			return historyUnitState{
				Active:   st.Active,
				Restarts: st.Restarts,
				EnterAt:  st.EnterUnix,
				Known:    true,
			}
		},
		peers: func(id int, running bool) (int, time.Time, bool) {
			usage := readInstanceUsage(id, running)
			if !usage.UsageKnown {
				return 0, time.Time{}, false
			}
			updatedAt, _ := time.Parse(time.RFC3339, usage.UpdatedAt)
			return usage.ActivePeers, updatedAt, true
		},
		journal: journalBetween,
		now:     time.Now,
		sig:     map[int]*historySignals{},
		last:    map[int]historyUnitState{},
	}
}

// run samples until the panel shuts down. The first tick is immediate so the
// ribbon starts filling as soon as the panel is up.
func (r *historyRecorder) run(ctx context.Context) {
	ticker := time.NewTicker(instanceHistoryTick)
	defer ticker.Stop()
	r.tick(r.now())
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.tick(r.now())
		}
	}
}

// tick finalises the minute that just ended, then samples the new one.
func (r *historyRecorder) tick(now time.Time) {
	minute := now.Truncate(time.Minute)
	if r.start.IsZero() {
		r.start = minute
	} else if minute.After(r.start) {
		r.finalize()
		r.start = minute
		r.sig = map[int]*historySignals{}
	}
	r.sample(minute)
}

// sample records what the sources say right now into the current minute.
func (r *historyRecorder) sample(minute time.Time) {
	for _, id := range r.ids() {
		sig := r.sig[id]
		if sig == nil {
			sig = &historySignals{}
			r.sig[id] = sig
		}
		state := r.unit(InstanceService(id))
		sample := historySignals{}
		if state.Known {
			switch strings.ToLower(strings.TrimSpace(state.Active)) {
			case "failed":
				sample.Failed = true
			case "inactive":
				sample.Inactive = true
			}
			if prev, ok := r.last[id]; ok && prev.Known {
				if state.Restarts > prev.Restarts {
					sample.Restarted = true
					sample.Restarts = state.Restarts - prev.Restarts
				}
				if prev.EnterAt > 0 && state.EnterAt > 0 && state.EnterAt != prev.EnterAt {
					// A manual restart or a systemd restart does not always bump
					// NRestarts on every systemd version, but the enter timestamp
					// always moves on a fresh start.
					sample.Restarted = true
					if sample.Restarts == 0 {
						sample.Restarts = 1
					}
				}
			}
			r.last[id] = state
		}
		running := strings.EqualFold(strings.TrimSpace(state.Active), "active")
		if peers, updatedAt, known := r.peers(id, running); known {
			sample.PeersKnown = true
			sample.Peers = peers
			// The exit rewrites status.json whenever a peer connects or leaves;
			// a write inside this minute is the "channel was used" signal.
			if !updatedAt.IsZero() && updatedAt.After(minute) {
				sample.Touched = true
			}
		}
		sig.merge(sample)
	}
}

// finalize writes one slot per instance for the minute that just ended: the
// sampled signals plus the journal of exactly that minute. The journal window is
// [start, start+1min), so a minute is never charged with a neighbour's lines.
func (r *historyRecorder) finalize() {
	minute := r.start
	since, until := minute, minute.Add(time.Minute)
	minuteIndex := minute.Unix() / 60
	for _, id := range r.ids() {
		sig := historySignals{}
		if acc, ok := r.sig[id]; ok && acc != nil {
			sig = *acc
		}
		jm := journalMinute{}
		if text, err := r.journal(InstanceService(id), since, until); err == nil {
			jm = classifyJournal(text)
		} else {
			logger.Debugf("instance history: journal for %s: %v", InstanceService(id), err)
		}
		r.history.record(id, minuteIndex, historySlot{
			State:      historyState(sig, jm),
			Bytes:      jm.Bytes,
			BytesKnown: jm.Known,
			Peers:      sig.Peers,
			Restarts:   sig.Restarts,
			Rejects:    jm.Rejects,
		})
	}
	if err := r.history.save(); err != nil {
		logger.Errorf("instance history: write %s: %v", r.history.path, err)
	}
}

// journalBetween reads one minute of a unit's journal. The window is formatted
// without a zone because journalctl reads such a timestamp as local time, the
// same clock the panel runs on.
func journalBetween(service string, since, until time.Time) (string, error) {
	cmd := exec.Command("journalctl", "-u", service, "--no-pager", "-o", "cat",
		"--since", since.Format("2006-01-02 15:04:05"),
		"--until", until.Format("2006-01-02 15:04:05"))
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// startInstanceHistory runs the recorder for the lifetime of the panel.
func (s *Server) startInstanceHistory(ctx context.Context) {
	if s.history == nil {
		return
	}
	recorder := newHistoryRecorder(s.history, func() []int {
		ids, err := ListInstances(s.cfg.ConfigDir)
		if err != nil {
			logger.Errorf("instance history: list instances: %v", err)
			return nil
		}
		return ids
	})
	go recorder.run(ctx)
}
