# RUNSTR – Active Bug List & Fix-it Plan

_Last updated: 2025-05-14_

---

## ❗ Open Bugs / UX Issues

| ID | Title | Symptoms / Screenshots | Suspected Root Cause |
|----|-------|------------------------|----------------------|
| RUN-01 | Split time shown in decimal minutes | Splits like "8.85 minutes" instead of "8:51" | Formatting util converts seconds → minutes as float, not `mm:ss` string |
| RUN-02 | Personal-best 5 k pace absurd | Stats page shows PB 5k as `2431:06 min/mi` | Distance units mix-up: total seconds ÷ *meters* → huge value |
| STREAK-01 | Streak counter & sats reward fail | Ran 2 days; Settings shows streak 0, no Lightning sent | Streak calculation ignores most-recent run; payout trigger not fired |
| NOSTR-02 | Red-box error after posting run | RN red screen right after "Run posted" toast | Callback in Nostr publish flow throws when splits array undefined |
| FEED-01 | Feed avatars & profile names missing | User metadata shows "Loading…" forever; avatar circles stay black | Nostr metadata event (kind 0) not arriving / subscription not set on remount |
| FEED-02 | Feed doesn't reload after navigating away | Returning from another tab shows perpetual "Loading posts…" | Relay subscription is torn down on unmount and not re-established; local state stuck in `loading=true` |
| FEED-03 | Manual refresh button does nothing | ↻ icon performs no action | Button wired to stale handler; redundant once FEED-02 fixed |
| FEED-04 | Feed sometimes blank on first load | Occasional empty state until app restart | Race condition or relay connection delay; no local cache fallback |
| CACHE-01 | No local/offline cache for posts | Switching tabs or offline drops feed | Missing IndexedDB / localStorage layer |
| MUSIC-01 | "Liked Songs" playlist won't play | Tapping play does nothing | Selected playlist not passed to player context; track URLs missing |
| MUSIC-02 | Music player unstable / sketchy | Playback controls intermittently unresponsive | Event listeners duplicated between floating & header players |
| WORKOUT-01 | Caloric calculation errors on post | Workout posts succeed but server returns kcal error | API expects `intensity` or `MET` parameter that UI doesn't supply |
| ICON-01 | Launcher icon shows black corners | White circle with dark fringe on homescreen | Adaptive-icon foreground layer not sized to 108×108dp |

---

## 🛠️ Implementation Road-map (Easiest ➜ Hardest)

1. **Format run splits as mm:ss (RUN-01)**  
   – Pure formatting fix in util; unit test.
2. **Fix 5 km PB pace calculation (RUN-02)**  
   – Correct distance/time unit math; update stats selector.
3. **Repair streak counter & sats reward (STREAK-01)**  
   – Audit streak algorithm; ensure Lightning payout on streak increment.
4. **Investigate red-box after Nostr post (NOSTR-02)**  
   – Reproduce and capture stack trace; fix null-split handling.
5. **Remove / disable dead Feed refresh button (FEED-03)**  
   – Pure UI change; one component edit.
6. **Fix launcher adaptive icon asset (ICON-01)**  
   – Replace foreground PNG / XML mask; no code.
7. **Ensure Feed re-subscribes on remount (FEED-02)**  
   – Move Nostr subscription to global store or use `useEffect` with dependency on `isMounted`.
8. **Load user metadata reliably (FEED-01)**  
   – Confirm kind 0 subscription; add fallback request; ensure avatars fade-in.
9. **Local cache layer for posts (CACHE-01, supports FEED-04)**  
   – Use IndexedDB via `idb-keyval` or React Query `persistor`.
10. **Small music fixes**  
    a. Link "Liked Songs" playlist to player context (MUSIC-01).  
    b. Audit player event listeners for duplication (MUSIC-02).
11. **Workout post kcal / intensity (WORKOUT-01)**  
    – Add intensity selection UI (1–10) → send with POST payload; adjust server calc.
12. **Optional refinements & polish**  
    – Remove manual refresh button entirely after auto-reload + cache proved stable.  
    – Implement Service Worker for full offline support.

---

### Tracking Progress

```markdown
- [ ] RUN-01 – Split time mm:ss format
- [ ] RUN-02 – 5k PB pace correct
- [ ] STREAK-01 – Streak counter & sats reward
- [ ] NOSTR-02 – Red-box after Nostr post
- [ ] FEED-03 – Refresh button removed
- [x] ICON-01 – Adaptive icon fixed
- [x] FEED-02 – Feed re-subscribes on remount
- [x] FEED-01 – User metadata loads consistently
- [ ] CACHE-01 – Local cache for Feed posts
- [ ] MUSIC-01 – Liked Songs playlist plays
- [ ] MUSIC-02 – Music player stabilised
- [ ] WORKOUT-01 – Intensity input & kcal fix
```

Add check-marks as each fix lands in `main`.  Feel free to append new issues or details below. 