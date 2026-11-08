package admin

// One hour of one instance's channel state, one slot per minute.
//
// The panel draws the last hour as a ribbon of 60 ticks, so every slot has to
// answer one question: what was that minute like? A slot carries the state letter
// and the counters that explain it (traffic, peers, restarts, carrier refusals).
//
// States, and the rule when several signals apply at once (the first match wins):
//
//	D  юнит мёртв: ActiveState=failed — падение, в том числе когда systemd уже
//	   пытается его перезапустить.
//	I  юнит остановлен: ActiveState=inactive и не failed — его выключили руками.
//	U  канал рвался: юнит перезапускался в эту минуту (NRestarts вырос или
//	   сменился ActiveEnterTimestamp) либо в журнале минуты есть reconnect.
//	P  канал на пределе: в журнале минуты есть отказ носителя — RATE_LIMITED,
//	   «write refused» или 429.
//	L  канал жив: юнит активен, и в эту минуту были подключённые пиры или юнит
//	   переписывал свой status.json (пир пришёл/ушёл).
//	null  данных нет: панель не работала, только поднялась, либо источник
//	   (systemd/журнал/status.json) недоступен.
//
// Why this order: a dead unit is the most specific true statement about the
// minute, and it also explains the other signals — a unit that dies may log
// refusals and reconnects while it dies, and D says the cause. I beats U and P
// for the same reason: a unit that was stopped by hand is not "flapping" and is
// not being rate-limited, it is simply off. U before P because a restart produces
// both (the old link was refused, then the unit came back) and the restart is the
// bigger event. L is the "nothing was wrong" answer, so it comes last among the
// real signals. A missing state is not a signal at all, only the absence of one,
// and it must stay distinct from "0 traffic": the ribbon draws them differently.
//
// The buffer holds at most 60 consecutive minutes, oldest first. It starts empty
// and grows one slot per minute; a minute the panel missed while it was running
// is stored with an empty state (null) so the ribbon keeps its one-slot-one-minute
// meaning instead of silently concatenating two far-apart minutes.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// instanceHistorySlots is the ribbon length: one hour, one minute per slot.
	instanceHistorySlots = 60

	// instanceHistoryFile sits next to subscriptions.db in the data dir, so a
	// panel restart does not erase the hour the operator is looking at.
	instanceHistoryFile = "instance-history.json"
	// instanceHistoryDefaultDB mirrors the subscription backend's default: the
	// history lives wherever the subscription database lives.
	instanceHistoryDefaultDB = "/var/lib/olcrtc/subscriptions.db"
)

// Instance state letters recorded into the ring, in priority order D > I > U > P > L.
const (
	historyStateDead     = "D"
	historyStateStopped  = "I"
	historyStateFlapping = "U"
	historyStateLimited  = "P"
	historyStateAlive    = "L"
)

// historySlot is one minute of one instance as it is kept and persisted: the
// state letter plus the counters that explain it. State is "" when the minute
// has no data; the API turns that into JSON null, never into "L" or "0".
type historySlot struct {
	Minute int64 `json:"minute"`
	State  string `json:"state,omitempty"`
	// Bytes is the traffic growth over the minute; BytesKnown is false when the
	// counter could not be read, which is what the API reports as null.
	Bytes      int64 `json:"bytes"`
	BytesKnown bool  `json:"bytes_known"`
	Peers      int   `json:"peers"`
	Restarts   int   `json:"restarts"`
	Rejects    int   `json:"rejects"`
}

// InstanceHistorySlot is one minute of the ribbon as /api/instances returns it.
// State is a pointer because "no data" has to survive JSON as null: the ribbon
// draws it differently from a minute of zero traffic.
type InstanceHistorySlot struct {
	At       int64   `json:"at"`
	State    *string `json:"state"`
	Bytes    *int64  `json:"bytes"`
	Peers    int     `json:"peers"`
	Restarts int     `json:"restarts"`
	Rejects  int     `json:"rejects"`
}

// instanceHistoryFileVersion is the on-disk document.
type instanceHistoryFileVersion struct {
	Instances map[string][]historySlot `json:"instances"`
}

// instanceHistory is the ring of slots per instance plus its file.
type instanceHistory struct {
	mu   sync.Mutex
	path string
	byID map[int][]historySlot
}

// newInstanceHistory returns a store backed by path ("" keeps it in memory) and
// loads whatever a previous process saved.
func newInstanceHistory(path string) *instanceHistory {
	h := &instanceHistory{path: path, byID: map[int][]historySlot{}}
	h.load(time.Now())
	return h
}

// load reads the file and drops slots that are already older than the window: a
// ribbon is a claim about the last hour, so an hour-old slot must not be shown as
// if it were the newest one.
func (h *instanceHistory) load(now time.Time) {
	if h.path == "" {
		return
	}
	data, err := os.ReadFile(h.path)
	if err != nil {
		return
	}
	var doc instanceHistoryFileVersion
	if err := json.Unmarshal(data, &doc); err != nil {
		return
	}
	cutoff := now.Truncate(time.Minute).Unix()/60 - instanceHistorySlots
	for key, slots := range doc.Instances {
		id, err := strconv.Atoi(key)
		if err != nil {
			continue
		}
		kept := make([]historySlot, 0, len(slots))
		for _, s := range slots {
			if s.Minute <= cutoff || !validHistoryState(s.State) {
				continue
			}
			kept = append(kept, s)
		}
		if len(kept) == 0 {
			continue
		}
		if len(kept) > instanceHistorySlots {
			kept = kept[len(kept)-instanceHistorySlots:]
		}
		h.byID[id] = kept
	}
}

// validHistoryState accepts the letters and the empty (no data) state, so a
// corrupted or older file cannot put an unknown letter on the ribbon.
func validHistoryState(state string) bool {
	switch state {
	case "", historyStateDead, historyStateStopped, historyStateFlapping,
		historyStateLimited, historyStateAlive:
		return true
	}
	return false
}

// record appends the slot for one minute. Recording the same minute twice
// replaces it instead of adding a slot, so a duplicated tick cannot shift the
// ribbon.
func (h *instanceHistory) record(id int, minute int64, slot historySlot) {
	if h == nil || !validHistoryState(slot.State) {
		return
	}
	slot.Minute = minute
	h.mu.Lock()
	defer h.mu.Unlock()
	slots := h.byID[id]
	if n := len(slots); n > 0 && minute <= slots[n-1].Minute {
		slots[n-1] = slot
		h.byID[id] = slots
		return
	}
	if n := len(slots); n > 0 {
		// Fill the minutes this process did not see, as "no data". Clamp to the
		// window: older minutes fall out of the ring anyway.
		start := slots[n-1].Minute + 1
		if minute-start > instanceHistorySlots {
			start = minute - instanceHistorySlots
		}
		for m := start; m < minute; m++ {
			slots = append(slots, historySlot{Minute: m})
		}
	}
	slots = append(slots, slot)
	if len(slots) > instanceHistorySlots {
		slots = slots[len(slots)-instanceHistorySlots:]
	}
	h.byID[id] = slots
}

// snapshot returns the ribbon oldest first, the timestamp its oldest slot is at,
// and whether the ring already covers a full hour. The slice is never nil: the
// API has to answer "history": [] before the first minute is recorded.
func (h *instanceHistory) snapshot(id int) ([]InstanceHistorySlot, int64, bool) {
	out := make([]InstanceHistorySlot, 0, instanceHistorySlots)
	if h == nil {
		return out, 0, false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	raw := h.byID[id]
	for _, s := range raw {
		slot := InstanceHistorySlot{
			At:       s.Minute * 60,
			Peers:    s.Peers,
			Restarts: s.Restarts,
			Rejects:  s.Rejects,
		}
		if s.State != "" {
			state := s.State
			slot.State = &state
		}
		if s.BytesKnown {
			traffic := s.Bytes
			slot.Bytes = &traffic
		}
		out = append(out, slot)
	}
	var since int64
	if len(raw) > 0 {
		since = raw[0].Minute * 60
	}
	return out, since, len(raw) == instanceHistorySlots
}

// save writes the ring atomically: another process (or the operator reading the
// file) never sees a half-written document, the same tmp+rename the exit uses for
// its status file.
func (h *instanceHistory) save() error {
	if h == nil || h.path == "" {
		return nil
	}
	h.mu.Lock()
	doc := instanceHistoryFileVersion{Instances: make(map[string][]historySlot, len(h.byID))}
	for id, slots := range h.byID {
		if len(slots) == 0 {
			continue
		}
		doc.Instances[strconv.Itoa(id)] = append([]historySlot(nil), slots...)
	}
	h.mu.Unlock()

	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(h.path), 0o750); err != nil {
		return err
	}
	tmp := h.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, h.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// instanceHistoryPath puts the history next to subscriptions.db: same data dir,
// same OLCRTC_SUB_DB override the subscription backend honours.
func instanceHistoryPath(cfg Config) string {
	vals := ReadInstanceEnv(InstanceEnvPath(cfg.ConfigDir, 0))
	dbPath := strings.TrimSpace(vals["OLCRTC_SUB_DB"])
	if dbPath == "" {
		dbPath = instanceHistoryDefaultDB
	}
	return filepath.Join(filepath.Dir(dbPath), instanceHistoryFile)
}

// instanceHistoryFor answers one instance's ribbon: the slots, the timestamp of
// the window's first minute (0 when there is none), and whether it is complete.
func (s *Server) instanceHistoryFor(id int) ([]InstanceHistorySlot, int64, bool) {
	if s.history == nil {
		return []InstanceHistorySlot{}, 0, false
	}
	return s.history.snapshot(id)
}
