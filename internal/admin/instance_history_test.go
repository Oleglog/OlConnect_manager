package admin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// minuteAt is the ring's unit: the minute index of a wall-clock time.
func minuteAt(t time.Time) int64 { return t.Unix() / 60 }

func slotAt(t time.Time, state string) historySlot {
	return historySlot{Minute: minuteAt(t), State: state}
}

// The ribbon is a ring: after more than an hour the oldest minute falls out and
// the newest is last.
func TestInstanceHistoryRingRolls(t *testing.T) {
	h := newInstanceHistory("")
	start := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	for i := 0; i < instanceHistorySlots+5; i++ {
		minute := start.Add(time.Duration(i) * time.Minute)
		h.record(0, minuteAt(minute), slotAt(minute, historyStateAlive))
	}

	slots, since, complete := h.snapshot(0)
	if len(slots) != instanceHistorySlots {
		t.Fatalf("slots = %d, want the ring to hold %d", len(slots), instanceHistorySlots)
	}
	if !complete {
		t.Fatal("history_complete = false, want true once the ring is full")
	}
	wantFirst := start.Add(5 * time.Minute).Unix()
	if slots[0].At != wantFirst {
		t.Fatalf("first slot at = %d, want %d (the oldest minute still inside the hour)", slots[0].At, wantFirst)
	}
	wantLast := start.Add(time.Duration(instanceHistorySlots+4) * time.Minute).Unix()
	if slots[len(slots)-1].At != wantLast {
		t.Fatalf("last slot at = %d, want %d", slots[len(slots)-1].At, wantLast)
	}
	if since != wantFirst {
		t.Fatalf("history_since = %d, want the first slot's minute %d", since, wantFirst)
	}
	for _, slot := range slots {
		if slot.At%60 != 0 {
			t.Fatalf("slot at = %d, want a whole minute", slot.At)
		}
	}
}

// A ring that has not yet covered an hour reports it, and starts empty.
func TestInstanceHistoryStartsEmptyAndIncomplete(t *testing.T) {
	h := newInstanceHistory("")
	if slots, since, complete := h.snapshot(0); len(slots) != 0 || since != 0 || complete {
		t.Fatalf("empty ring = %d slots, since %d, complete %v; want 0, 0, false", len(slots), since, complete)
	}

	h.record(0, minuteAt(time.Now()), historySlot{State: historyStateAlive})
	slots, _, complete := h.snapshot(0)
	if len(slots) != 1 || complete {
		t.Fatalf("one slot = %d, complete %v; want 1, false", len(slots), complete)
	}
}

// A minute the panel never saw becomes a slot with no state, so the ribbon keeps
// one slot per minute instead of gluing two distant minutes together.
func TestInstanceHistoryFillsMissedMinutesWithNoData(t *testing.T) {
	h := newInstanceHistory("")
	first := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)
	h.record(0, minuteAt(first), slotAt(first, historyStateAlive))
	later := first.Add(5 * time.Minute)
	h.record(0, minuteAt(later), slotAt(later, historyStateLimited))

	slots, since, _ := h.snapshot(0)
	if len(slots) != 6 {
		t.Fatalf("slots = %d, want 6 (five minutes plus the two recorded ends)", len(slots))
	}
	if since != first.Unix() {
		t.Fatalf("history_since = %d, want %d", since, first.Unix())
	}
	for i := 1; i < 5; i++ {
		if slots[i].State != nil {
			t.Fatalf("slot %d state = %q, want null for a minute without data", i, *slots[i].State)
		}
	}
	if slots[0].State == nil || *slots[0].State != historyStateAlive {
		t.Fatalf("first slot = %v, want L", slots[0].State)
	}
	if slots[5].State == nil || *slots[5].State != historyStateLimited {
		t.Fatalf("last slot = %v, want P", slots[5].State)
	}
}

// Recording the same minute twice replaces it: a duplicated tick must not shift
// the ribbon.
func TestInstanceHistoryReplacesTheSameMinute(t *testing.T) {
	h := newInstanceHistory("")
	minute := minuteAt(time.Now())
	h.record(0, minute, historySlot{State: historyStateAlive, Peers: 1})
	h.record(0, minute, historySlot{State: historyStateLimited, Peers: 3})

	slots, _, _ := h.snapshot(0)
	if len(slots) != 1 {
		t.Fatalf("slots = %d, want 1", len(slots))
	}
	if slots[0].State == nil || *slots[0].State != historyStateLimited || slots[0].Peers != 3 {
		t.Fatalf("slot = %+v, want the second recording to win", slots[0])
	}
}

// The priority rule, in one table: the first true statement about the minute
// wins, because it explains the rest. "No data" is only for a minute in which
// nothing at all could be read - a quiet but running unit is alive.
func TestHistoryStatePriority(t *testing.T) {
	alive := historySignals{UnitKnown: true, Peers: 2, PeersKnown: true}
	cases := []struct {
		name string
		sig  historySignals
		jm   journalMinute
		want string
	}{
		{"dead beats everything", historySignals{Failed: true, Inactive: true, Restarted: true, Peers: 2, PeersKnown: true},
			journalMinute{Known: true, Rejects: 9, Reconnects: 9}, historyStateDead},
		{"stopped beats flapping", historySignals{UnitKnown: true, Inactive: true, Restarted: true},
			journalMinute{Known: true, Rejects: 1}, historyStateStopped},
		{"restart beats refusals", historySignals{UnitKnown: true, Restarted: true},
			journalMinute{Known: true, Rejects: 4}, historyStateFlapping},
		{"reconnect beats refusals", historySignals{UnitKnown: true},
			journalMinute{Known: true, Rejects: 4, Reconnects: 1}, historyStateFlapping},
		{"refusals beat alive", alive, journalMinute{Known: true, Rejects: 1}, historyStateLimited},
		{"alive with peers", alive, journalMinute{Known: true}, historyStateAlive},
		{"alive on a peer change", historySignals{Touched: true}, journalMinute{Known: true}, historyStateAlive},
		{"a running unit with no traffic is alive, not a hole", historySignals{UnitKnown: true},
			journalMinute{Known: true}, historyStateAlive},
		{"a status file alone with zero peers says nothing", historySignals{PeersKnown: true},
			journalMinute{Known: true}, ""},
		{"nothing known at all", historySignals{}, journalMinute{}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := historyState(c.sig, c.jm); got != c.want {
				t.Fatalf("historyState(%+v, %+v) = %q, want %q", c.sig, c.jm, got, c.want)
			}
		})
	}
}

// Two minutes of "clients connected, no traffic at all" are a stalled channel:
// the second minute is U. One such minute is still a pause, and an unknown byte
// counter cannot prove silence.
func TestStalledMinute(t *testing.T) {
	live := func(peers int) historySlot {
		return historySlot{Minute: 100, State: historyStateAlive, Peers: peers, Bytes: 0, BytesKnown: true}
	}
	cases := []struct {
		name string
		prev historySlot
		cur  historySlot
		want bool
	}{
		{"second idle minute with clients", live(1), live(1), true},
		{"previous minute had traffic", func() historySlot {
			s := live(1)
			s.Bytes = 500
			return s
		}(), live(1), false},
		{"previous minute had no clients", live(0), live(1), false},
		{"this minute has no clients", live(1), live(0), false},
		{"traffic unknown cannot prove silence", func() historySlot {
			s := live(1)
			s.BytesKnown = false
			return s
		}(), live(1), false},
		{"previous minute is not adjacent", func() historySlot {
			s := live(1)
			s.Minute = 95
			return s
		}(), live(1), false},
		{"previous minute was not alive", func() historySlot {
			s := live(1)
			s.State = historyStateLimited
			return s
		}(), live(1), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := stalledMinute(c.prev, 100, c.cur)
			if got != c.want {
				t.Fatalf("stalledMinute(%+v, 100, %+v) = %v, want %v", c.prev, c.cur, got, c.want)
			}
		})
	}
}

// The journal is where P and U come from: count the refusals, the reconnects and
// the traffic the unit reported, and do not trip on numbers that are not 429.
func TestClassifyJournalCountsWhatTheUnitLogged(t *testing.T) {
	text := strings.Join([]string{
		`[BOARDS] event ack error: {"error":{"code":200,"securityCode":"RATE_LIMITED"}}`,
		`traffic: session=abc addr=1.2.3.4:443 in=100 out=200`,
		`429 Too Many Requests from the carrier`,
		`server reconnect reason=carrier - tearing down smux session`,
		`control alive session=xyz rtt=12ms seq=4290`,
		``,
	}, "\n")

	jm := classifyJournal(text)
	if !jm.Known {
		t.Fatal("Known = false, want true for a journal that was read")
	}
	if jm.Rejects != 2 {
		t.Fatalf("Rejects = %d, want 2 (RATE_LIMITED and 429)", jm.Rejects)
	}
	if jm.Reconnects != 1 {
		t.Fatalf("Reconnects = %d, want 1", jm.Reconnects)
	}
	if jm.Bytes != 300 {
		t.Fatalf("Bytes = %d, want 300 (in+out of the traffic line)", jm.Bytes)
	}
}

// /api/instances has to answer history: [] and never null, and a slot without
// data must serialize its state as null while a known zero traffic stays 0.
func TestInstanceHistoryJSONShape(t *testing.T) {
	instance := Instance{History: []InstanceHistorySlot{}}
	data, err := json.Marshal(instance)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	body := string(data)
	for _, want := range []string{`"history":[]`, `"history_since":0`, `"history_complete":false`} {
		if !strings.Contains(body, want) {
			t.Fatalf("json = %s, want it to contain %s", body, want)
		}
	}

	zero := int64(0)
	alive := historyStateAlive
	withSlots := Instance{History: []InstanceHistorySlot{
		{At: 1_700_000_040, State: &alive, Bytes: &zero, Peers: 2, Restarts: 0, Rejects: 1},
		{At: 1_700_000_100, State: nil, Peers: 0, Restarts: 0, Rejects: 0},
	}}
	data, err = json.Marshal(withSlots)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	body = string(data)
	if !strings.Contains(body, `"state":"L"`) || !strings.Contains(body, `"bytes":0`) {
		t.Fatalf("json = %s, want a live slot with a known zero traffic", body)
	}
	if !strings.Contains(body, `"state":null`) {
		t.Fatalf("json = %s, want the empty slot's state to be null", body)
	}
}

// A tick that arrives late with numbers for a minute already closed must not
// overwrite the newest slot: that slot belongs to the minute after it.
func TestInstanceHistoryLateMinuteDoesNotOverwriteTheNewest(t *testing.T) {
	h := newInstanceHistory("")
	newer := time.Date(2026, 11, 8, 10, 5, 0, 0, time.UTC)
	h.record(0, minuteAt(newer), historySlot{State: historyStateAlive, Peers: 2})
	h.record(0, minuteAt(newer.Add(-time.Minute)), historySlot{State: historyStateDead, Peers: 9})

	slots, _, _ := h.snapshot(0)
	if len(slots) != 1 {
		t.Fatalf("slots = %d, want 1: a stale minute is not a new slot", len(slots))
	}
	if slots[0].State == nil || *slots[0].State != historyStateAlive || slots[0].Peers != 2 {
		t.Fatalf("slot = %+v, want the newer recording untouched", slots[0])
	}
}

// A data dir the panel cannot write must produce an error, never a panic: the
// history is a nicety, not a reason to fall over.
func TestInstanceHistorySaveFailureIsReturnedNotFatal(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	// Its parent "directory" is a file, so creating the data dir must fail on
	// every platform - the same shape as an unwritable /var/lib/olcrtc.
	h := newInstanceHistory(filepath.Join(blocker, instanceHistoryFile))
	h.record(0, minuteAt(time.Now()), historySlot{State: historyStateAlive})
	if err := h.save(); err == nil {
		t.Fatal("save() = nil, want an error for a data dir that cannot be created")
	}
}

// The hour has to survive a panel restart: the file is written atomically and a
// slot older than the window is not shown as if it were the newest one.
func TestInstanceHistorySurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), instanceHistoryFile)
	h := newInstanceHistory(path)
	now := time.Now()
	for i := 5; i >= 0; i-- {
		minute := now.Add(-time.Duration(i) * time.Minute)
		h.record(0, minuteAt(minute), historySlot{State: historyStateAlive, Peers: i, Bytes: 10, BytesKnown: true})
	}
	if err := h.save(); err != nil {
		t.Fatalf("save() = %v", err)
	}

	reloaded := newInstanceHistory(path)
	before, beforeSince, beforeComplete := h.snapshot(0)
	after, afterSince, afterComplete := reloaded.snapshot(0)
	if len(before) != len(after) || beforeSince != afterSince || beforeComplete != afterComplete {
		t.Fatalf("reloaded ring = %d slots since %d complete %v, want %d/%d/%v",
			len(after), afterSince, afterComplete, len(before), beforeSince, beforeComplete)
	}
	for i := range before {
		if before[i].At != after[i].At || before[i].Peers != after[i].Peers {
			t.Fatalf("slot %d = %+v, want %+v", i, after[i], before[i])
		}
	}

	// A slot from two hours ago must not survive the next load.
	stale := instanceHistoryFileVersion{Instances: map[string][]historySlot{
		"1": {
			{Minute: minuteAt(now.Add(-2 * time.Hour)), State: historyStateAlive},
			{Minute: minuteAt(now), State: historyStateDead},
		},
	}}
	raw, err := json.Marshal(stale)
	if err != nil {
		t.Fatalf("Marshal() = %v", err)
	}
	stalePath := filepath.Join(t.TempDir(), instanceHistoryFile)
	if err := os.WriteFile(stalePath, raw, 0o644); err != nil {
		t.Fatalf("WriteFile() = %v", err)
	}
	pruned := newInstanceHistory(stalePath)
	slots, _, _ := pruned.snapshot(1)
	if len(slots) != 1 || slots[0].State == nil || *slots[0].State != historyStateDead {
		t.Fatalf("pruned ring = %+v, want only the fresh slot", slots)
	}
}

// A channel with clients that stops carrying traffic is "рвётся" from the second
// silent minute: the first quiet minute is still a pause (L), the next one is U.
func TestHistoryRecorderMarksTheSecondIdleMinuteAsFlapping(t *testing.T) {
	history := newInstanceHistory("")
	now := time.Date(2026, 11, 8, 10, 0, 5, 0, time.UTC)
	recorder := &historyRecorder{
		history: history,
		ids:     func() []int { return []int{0} },
		unit: func(string) historyUnitState {
			return historyUnitState{Active: "active", EnterAt: 1_700_000_000, Known: true}
		},
		peers:   func(int, bool) (int, time.Time, bool) { return 1, now, true },
		journal: func(string, time.Time, time.Time) (string, error) { return "", nil },
		now:     func() time.Time { return now },
		sig:     map[int]*historySignals{},
		last:    map[int]historyUnitState{},
	}

	recorder.tick(now) // 10:00:05
	now = time.Date(2026, 11, 8, 10, 1, 5, 0, time.UTC)
	recorder.tick(now) // finalises 10:00
	slots, _, _ := history.snapshot(0)
	if len(slots) != 1 || slots[0].State == nil || *slots[0].State != historyStateAlive {
		t.Fatalf("first quiet minute = %+v, want L: one silent minute is a pause", slots)
	}

	now = time.Date(2026, 11, 8, 10, 2, 5, 0, time.UTC)
	recorder.tick(now) // finalises 10:01
	slots, _, _ = history.snapshot(0)
	if len(slots) != 2 {
		t.Fatalf("slots = %d, want 2", len(slots))
	}
	if slots[1].State == nil || *slots[1].State != historyStateFlapping {
		t.Fatalf("second quiet minute = %+v, want U (clients present, no traffic)", slots[1])
	}
	if slots[1].Peers != 1 {
		t.Fatalf("peers = %d, want the client count kept in the slot", slots[1].Peers)
	}
}

// The recorder writes exactly one slot per minute and folds the samples of that
// minute together: a restart at second 50 of the minute makes it U even though
// every sample said "active" and the peer count looked healthy.
func TestHistoryRecorderRollsExactlyOneSlotPerMinute(t *testing.T) {
	history := newInstanceHistory("")
	now := time.Date(2026, 11, 8, 10, 0, 5, 0, time.UTC)
	state := historyUnitState{Active: "active", EnterAt: 1_700_000_000, Known: true}
	peers := 2
	journal := ""

	recorder := &historyRecorder{
		history: history,
		ids:     func() []int { return []int{0} },
		unit:    func(string) historyUnitState { return state },
		peers: func(int, bool) (int, time.Time, bool) {
			return peers, now, true
		},
		journal: func(string, time.Time, time.Time) (string, error) { return journal, nil },
		now:     func() time.Time { return now },
		sig:     map[int]*historySignals{},
		last:    map[int]historyUnitState{},
	}

	recorder.tick(now) // 10:00:05 — the minute starts here
	if slots, _, _ := history.snapshot(0); len(slots) != 0 {
		t.Fatalf("slots after the first tick = %d, want 0: a minute is written when it ends", len(slots))
	}

	// A restart inside the minute: from now on the unit is on a new incarnation.
	state = historyUnitState{Active: "active", Restarts: 1, EnterAt: 1_700_000_050, Known: true}
	now = now.Add(45 * time.Second) // 10:00:50
	recorder.tick(now)

	// The next minute starts: 10:00 is finalised, and its journal has a refusal.
	journal = "traffic: session=a addr=1.1.1.1:443 in=1000 out=2000\n429 Too Many Requests\n"
	now = time.Date(2026, 11, 8, 10, 1, 5, 0, time.UTC)
	recorder.tick(now)

	slots, since, complete := history.snapshot(0)
	if len(slots) != 1 {
		t.Fatalf("slots = %d, want exactly one finished minute", len(slots))
	}
	if want := time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC).Unix(); slots[0].At != want || since != want {
		t.Fatalf("slot at = %d (since %d), want %d", slots[0].At, since, want)
	}
	if complete {
		t.Fatal("history_complete = true after one minute, want false")
	}
	if slots[0].State == nil || *slots[0].State != historyStateFlapping {
		t.Fatalf("state = %v, want U (the restart outranks the refusal)", slots[0].State)
	}
	if slots[0].Restarts != 1 {
		t.Fatalf("restarts = %d, want 1", slots[0].Restarts)
	}
	if slots[0].Rejects != 1 {
		t.Fatalf("rejects = %d, want 1", slots[0].Rejects)
	}
	if slots[0].Peers != 2 {
		t.Fatalf("peers = %d, want 2", slots[0].Peers)
	}
	if slots[0].Bytes == nil || *slots[0].Bytes != 3000 {
		t.Fatalf("bytes = %v, want 3000", slots[0].Bytes)
	}

	// The next rollover writes the 10:01 slot, and the ring keeps both.
	now = time.Date(2026, 11, 8, 10, 2, 5, 0, time.UTC)
	recorder.tick(now)
	if slots, _, _ := history.snapshot(0); len(slots) != 2 {
		t.Fatalf("slots = %d, want 2 after the second rollover", len(slots))
	}
}
