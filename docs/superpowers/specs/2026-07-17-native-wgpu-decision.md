# Scope decision: does the mask-paint GPU crash justify moving to native wgpu/Rust?

> ## ✅ RÉSOLU le 2026-07-18 — ce n'était PAS un problème GPU
>
> Root cause trouvée par A/B live sur la vraie fenêtre WebView2 (CDP, image
> synthétique 24MP) : **le crash vient du buffer `maskData` r8 pleine résolution
> (~26 Mo à 24MP) transitant par le state React**, qui fait hanger WebView2 au
> re-render déclenché par `setLayers()` en fin de stroke. Discriminateur prouvé :
> `setLayers()` SANS masque (ajout de calque) à 24MP ne crashe pas ; AVEC le
> buffer 26 Mo il crashe ; ne pas appeler `setLayers()` ne crashe pas. Ce n'est
> donc **ni le GPU** (le `requestRender` avec le masque complet est OK dans les
> deux cas) **ni le re-render en soi**, mais le buffer 26 Mo dans l'état React.
> Ça explique pourquoi les 3 fix précédents (dirty-rect, GPU-copy, wait-for-idle)
> échouaient : ils ciblaient le GPU/timing.
>
> **Fix livré** (`e3c7584`, `feature/design-system`) : `layersRef` = source de
> vérité complète (avec `maskData`) pour rendu/historique/export ; le state React
> n'est qu'une projection d'affichage SANS `maskData` (`src/layers/
> displayProjection.ts`, `toDisplayLayers`). `setLayers()` reste appelé (UI
> correcte) mais ne porte plus le buffer. Vérifié en live à 24MP : peinture au
> masque sans crash, UI correcte (screenshot CDP). +6 tests de régression.
>
> **Conclusion de scope confirmée** : le port natif wgpu/Rust n'était PAS
> pertinent — la cause était côté état React, pas côté rendu. Le reste de ce
> document (analyse GPU/compositeur) est conservé comme trace de l'investigation
> qui a mené à écarter la piste GPU.

Date: 2026-07-17. Updated same day after live CDP experimentation (see §1.5) —
the initial version of this document (compositor/driver hypothesis, category
C) is **superseded** by the findings below. No code changes remain from this
investigation: all diagnostic instrumentation added to test the hypotheses
was removed after use (`src/App.tsx`, `src/render/renderer.ts` are back to
their committed state).

## 1. Crash status now (resolving the 07-15 vs 07-16 contradiction)

**Status: OPEN**, and now root-caused (§2). `TECH_DEBT_AUDIT.md` (2026-07-15,
"root-caused and fixed") is **stale and superseded**:

- The dirty-rect fix (07-15) *did* test as fixed at the time; `1d5e129`
  (07-16, GPU-side `copyTextureToTexture` instead of a second CPU→GPU
  upload) was a second attempt after the dirty-rect fix turned out
  insufficient. Both are committed and present in the current tree.
- `.claude/learning-log.md` (2026-07-16/17) documents `1d5e129` re-tested
  live and still hanging.
- **This session re-reproduced the hang freshly, live, via CDP**, on the
  current `HEAD` (`1d5e129` included) — see §1.5. Not inherited from memory;
  independently re-confirmed today with a purpose-built repro script
  (synthetic 6240×4160 JPEG dropped onto the live app, a real layer added,
  mask-paint mode entered, a single `pointerdown`+`pointerup` with zero
  `pointermove` at the canvas center, then CDP responsiveness polling).

## 1.5 What was actually tested this session (live, not inherited)

Five live experiments, each changing exactly one variable relative to the
unmodified baseline, using temporary diagnostic flags removed after use:

| # | Variant | Result |
|---|---|---|
| 1 | **Baseline** — unmodified `handleMaskStrokeEnd` → `commit()` → resident mask texture → present to canvas | **HANGS.** rAF never fires again; page unresponsive to unrelated CDP calls (`1+1`) for the full 20s poll window. Confirms §1's status. |
| 2 | **Off-screen present** — same as baseline, but `Renderer.render()` targets a throwaway off-screen texture instead of the canvas (`getSrgbCanvasView` swapped out) | **STILL HANGS**, identically. Presenting to the canvas is not required to trigger it. |
| 3 | **Skip resident-texture creation** — `getMaskTexture()` aliases directly to the already-uploaded `liveMaskTexture` instead of creating/binding a *new* resident texture (zero new GPU allocation, zero new binding beyond what live-preview frames already did successfully during the stroke) | **STILL HANGS**, identically (including on a second stroke). Allocating/binding a fresh resident texture is not required to trigger it. |
| 4 | **Bypass `commit()`** — issue the exact same GPU frame (`renderer.requestRender(stack.layers)`, fresh mask via `updateMask`, normal resident-texture path, normal canvas present) but skip `historyRef.current.push(stack)` **and** `setLayers(stack.layers)` entirely | **SURVIVES.** Pointerup returns in 9ms, page stays responsive through the full poll window. |
| 5 | **`setLayers` alone** — same as #4, but call `setLayers(stack.layers)` (no `historyRef.push`) before the render request | **HANGS**, identically to baseline. |
| 6 | **Defer `setLayers` one macrotask** — render request and `historyRef.push` happen synchronously; `setLayers` is wrapped in `setTimeout(fn, 0)` | **STILL HANGS.** Delaying the state update by one tick does not avoid it — the hang manifests once the deferred `setLayers` actually runs. |
| 7 | **`historyRef.push` alone** — same as #4/#5 but issue `historyRef.current.push(stack)` (no `setLayers`) before the render request, closing the 2×2 bracket | **SURVIVES.** Pointerup returns in 12ms, fully responsive through the whole 20s poll. |

Experiments #4/#5/#7 form a complete 2×2 factorial over `commit()`'s two side
effects (`push` × `setLayers`), each cross-checked against the identical GPU
frame:

| | `setLayers` | no `setLayers` |
|---|---|---|
| **`push`** | hangs (baseline) | **survives** (#7) |
| **no `push`** | hangs (#5) | survives (#4) |

`setLayers` is the only factor whose presence flips the outcome in every row;
`push` never does. This is as conclusive as an in-app isolation gets without
instrumenting React's internals directly.

Experiments #2 and #3 were run against the **unmodified** `commit()` path
(i.e. `setLayers` still fired in both) — in hindsight this means they never
actually isolated presentation-target or resident-texture-creation from
`setLayers`; they only show that presentation-target and resident-texture-
creation don't change the outcome **given `setLayers` still runs**. That is
still a valid, useful result (§2), it just isn't the "compositor-present"
falsifier the first version of this document thought it was — the real
isolating experiments are #4/#5/#6.

## 2. Root cause: (A) — an in-app React-state/GPU-frame timing bug, not (B)/(C)

**Corrected from the first version of this document, which concluded (C).**
Experiments #4 and #5 bracket the trigger precisely:

- `{render + push + setLayers}` (baseline) → hangs.
- `{render only, no push, no setLayers}` (#4) → **survives**.
- `{render + setLayers, no push}` (#5) → **hangs**.

`setLayers` — the React state setter that triggers a re-render of
`App`/`Inspector`/`LayerPanel`/`ParamPanel` because `layers` is component
state — is therefore **necessary and sufficient** among the two `commit()`
side effects to reproduce the hang, confirmed by the full 2×2 factorial
(experiment #7 closes the last cell: `push` alone, no `setLayers`, survives).
`historyRef.current.push()` (cheap metadata-only work — see
`src/layers/history.ts`, its `clone()` shares the mask buffer reference and
only touches a `Map<Uint8Array, number>` refcount) is fully exonerated: its
presence never changes the outcome in any of the four combinations tested.

This is squarely **category (A)** per this document's own original
definitions: "an app-architecture cause... fixable in current stack. wgpu
native would NOT help; you'd rewrite the same bug in Rust." Specifically:
some interaction between this app's React re-render (triggered by a `layers`
state update) and an in-flight/recently-submitted large WebGPU frame
(24MP resident mask texture, `runPipeline` → `device.queue.submit`) puts the
browser process's frame-scheduling into a state where `requestAnimationFrame`
never fires again. Experiment #2 (off-screen present still hangs) and #3
(skip-resident-creation still hangs) are consistent with this: neither
presentation nor fresh-texture-allocation is the trigger, `setLayers` running
around the same time as this specific GPU frame is.

**What rules out a simple "same synchronous tick" reentrancy explanation**:
experiment #6 deferred `setLayers` to a separate macrotask (`setTimeout(fn, 0)`,
which in Chromium generally runs *after* the next `requestAnimationFrame`
callback, i.e. after the render's rAF would have already fired) — it still
hung, just once the deferred callback ran. So this isn't purely "don't call
`setState` in the same call stack as `requestRender`" — the re-render itself
is toxic whenever it happens in reasonably close proximity to this large
frame, not just when it races it synchronously. **The precise mechanism
(what exactly in the `Inspector`/`LayerPanel`/`ParamPanel` re-render
interacts badly with the GPU frame) was not identified this session** — only
that removing the state update removes the hang, and a one-tick defer isn't
enough of a fix on its own.

**Falsifier for this being category (A) after all**: if a *longer* defer
(e.g. `requestIdleCallback`, or waiting on `device.queue.onSubmittedWorkDone()`
before calling `setLayers`) still hangs, that would weaken "it's a timing
window" in favor of "any re-render touching this specific DOM/state shape is
independently broken regardless of timing." **This was tested — see §2.5 —
and it still hangs.**

## 2.5 Fix-attempt #3 this session: waiting for real GPU completion — also failed

Tested the strongest version of the "defer `setLayers`" idea: render
immediately (not coalesced through `FrameScheduler`), `await
device.queue.onSubmittedWorkDone()` (genuine GPU-queue-idle confirmation, not
a fixed tick), and only then `historyRef.push` + `setLayers`. **Still hangs**,
identically to every other variant tried.

Attempting to instrument *where exactly* it stalls (log markers at "render()
returned", "waitForIdle() resolved", "setLayers called") produced a more
important finding than the fix attempt itself: **once triggered, the page's
CDP `Runtime.evaluate` cannot execute *anything*, including a trivial read of
a plain JS array already sitting on `window`.** Every earlier "unresponsive"
result in this document was a 3-4s `Runtime.evaluate` timeout on `1+1` — this
is the same signature, but here it means the log-read attempts are equally
frozen, so **it could not be determined whether the freeze happens inside
`onSubmittedWorkDone()`'s promise itself (i.e. the GPU queue genuinely never
reports done) or only after it resolves, inside/after the deferred
`setLayers` call.** No white-box tool (WinDbg, ETW) was used to break this
tie — CDP is the only instrumentation available in this environment, and CDP
itself is what stops working.

This matters for the category call: a *total* freeze this complete (not
"slow", not "one API stalls" — the entire JS main thread stops accepting new
V8 execution contexts from the debugger for 18-20+ seconds straight, with no
`device.lost`, no uncaptured error, ever) is a stronger symptom than "an
expensive React re-render." Section 2's bracket experiments (#4/#5/#7) are
airtight on *which app-level trigger* (`setLayers`) is necessary and
sufficient — that finding stands. What's now less certain is whether the
*mechanism* by which `setLayers` causes this is itself a pure JS/React-level
problem (an infinite loop or synchronous deadlock somewhere in the
reconciliation or its effects — none identified by inspection of
`ParamPanel.tsx`/`Inspector.tsx`/`LayerPanel.tsx`/`Select.tsx`, none of which
touch the GPU, the canvas, or do forced-layout reads), or whether `setLayers`
is merely the *trigger* for a genuine WebView2/Dawn/D3D12-level stall that
only manifests when a DOM paint is forced shortly after this specific class
of GPU submission (a real compositor-synchronization bug, exposed only by —
not located in — the app code).

**Practically, this distinction doesn't change the recommendation** (§4):
either way, the trigger is a specific, avoidable *app-level pattern*
(committing a `layers`-array state update in proximity to a first-of-its-kind
resident 24MP mask-texture GPU submission), and avoiding that pattern is an
in-stack fix regardless of which theory of the underlying mechanism is
correct. It does mean **three independent fix attempts across three sessions
have now failed** (07-15 dirty-rect, 07-16 GPU-copy `1d5e129`, 07-17
wait-for-idle) — per this project's own systematic-debugging convention, 3+
failed fix attempts is the threshold to stop attempting further blind fixes
and discuss the approach with a human partner rather than try a fourth. See
§4.

## 3. Native-wgpu option: not relevant to this crash

The premise for even scoping native wgpu was that the crash lived at the
browser/driver/compositor layer (category B/C), where a native render
surface could plausibly bypass the fault. §2/§2.5 show the crash's *trigger*
is this app's own React state management (`setLayers`) — not GPU presentation,
not resident-texture allocation, not data volume. Whether the underlying
*mechanism* is a pure JS-level problem or a WebView2/Dawn/D3D12
compositor-synchronization bug exposed by that trigger is not fully settled
(§2.5) — but that ambiguity doesn't change this conclusion: **a native
wgpu/Rust port would not reliably fix this crash either way.** If the
mechanism is JS-level, it obviously has no WebGPU-backend dependency at all.
If the mechanism is a genuine compositor-level stall exposed by a
DOM-paint-near-large-GPU-submit pattern, a native renderer still shares a
process and a window with whatever UI layer replaces React's role — the
exact same category of "don't force a UI update right when the GPU layer is
mid-transition" discipline would be needed there too, just under a different
name. Native wgpu solves problems this crash does not clearly have: explicit
device-loss/allocation-error handling as `Result`s, and genuine
off-JS-thread render-loop control. Neither is confirmed to be what's broken
here, and pursuing a port on the *chance* it dodges an unconfirmed mechanism
is exactly the kind of premature, unproven rewrite this project's principles
warn against.

**The IPC-boundary and presentation costs scoped in the original version of
this document (mask data crossing webview↔native every stroke, no clean way
to get a native-rendered frame back onto the webview's canvas without either
an expensive per-frame readback or fragile native-window-overlay plumbing)
remain accurate as general costs of a native port, for future reference if
this question is reopened for an unrelated reason** — but they are moot for
*this* decision, since the problem they'd be paying that cost to solve isn't
the problem that's actually occurring.

## 4. Recommendation

**Stay on browser-WebGPU — native wgpu is closed for this specific crash
(§2/§3).** On the crash itself: **three independent fix attempts have now
failed across three sessions** (07-15 dirty-rect scoping, 07-16 GPU-side
`copyTextureToTexture` reuse `1d5e129`, 07-17 wait-for-real-GPU-idle before
`setLayers`). Per this project's own systematic-debugging convention, that is
the threshold to stop attempting further fixes blind and discuss the
approach with Antoine rather than try a fourth unreviewed guess — this
document stops here rather than proposing a fourth fix attempt.

**What's established, solid enough to build on:**
- The trigger is precisely `setLayers(stack.layers)` in `commit()`
  (`src/App.tsx`) — proven by a complete 2×2 factorial (§1.5), not a guess.
- It is not about canvas presentation, not about resident-texture allocation,
  not about data volume, not about single-tick timing (§2, §2.5).
- It reliably reproduces with one exact repro sequence: a synthetic 6240×4160
  image, one layer added, mask-paint mode, a single `pointerdown`+`pointerup`
  with zero `pointermove` — useful as a deterministic regression check for
  whatever fix is eventually chosen.

**What's still open, and needs a decision from Antoine rather than another
autonomous attempt:**
- Whether the underlying mechanism is JS/React-level or a genuine
  WebView2/Dawn/D3D12 compositor stall exposed by the `setLayers` trigger
  (§2.5) — undetermined, because CDP itself stops responding once the freeze
  starts, so black-box testing from this environment has hit its ceiling.
  Answering this would need either a different diagnostic channel (attach a
  native debugger to the WebView2 process, or get a fresh minidump — see
  `[[minidump-forensics-technique]]`/`scripts/parse-minidump.mjs` from the
  prior investigation) or accepting the mechanism stays unknown while
  fixing the trigger.
- A structural fix direction that avoids the trigger without knowing the
  exact mechanism: don't update the `layers` array-identity state
  (`setLayers`) synchronously around a mask-paint commit at all — e.g. keep
  `layers` state for the mask-paint case behind a ref until a safer moment
  (next user-initiated action, idle callback measured in seconds not one
  tick, or explicit "flush" button), or restructure so `Inspector`/
  `LayerPanel`/`ParamPanel` don't need to re-render on every mask commit
  (`React.memo` against a stable `layers` reference, updating the mask
  through a side-channel ref the canvas alone reads). Neither was
  implemented or tested this session — that's the next decision point.
- Whether to reproduce on a second machine/GPU before investing further —
  still the single highest-leverage unresolved question in this whole
  investigation (everything above is evidence from one machine).

## 5. Measurable trigger for reopening the native-wgpu question

Not this crash. Reopen it only if a *separate*, genuinely browser/driver-
level GPU problem is found later (e.g. a real `device.lost`/D3D12 error, or
a hang confirmed to persist with **all** of `{React re-render, presentation,
resident-texture creation}** removed as variables) — none of which is the
case here.
