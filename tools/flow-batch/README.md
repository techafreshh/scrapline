# flow-batch — prompt runner for the UI art

Drives Google Flow's project agent to generate the prompts in
[`docs/ui-prompts/`](../../docs/ui-prompts/README.md), then exports each result at
1024 px straight off Flow's CDN and files it in
[`docs/ui-prompts/results/`](../../docs/ui-prompts/results/).

Paused 24 Nov with **22 of 66 prompts done**. Resume with:

```bash
python -I tools/flow-batch/run.py
```

It skips any prompt whose `results/<ID>-v1.jpg` already exists, so it picks up
exactly where it stopped. Pass specific IDs to regenerate one:
`python -I tools/flow-batch/run.py IC-04 SC-02`.

## Requirements

- `browse` CLI paired to Chrome (`browse status`), logged into the Flow account
  that owns the project in `PROJECT` below.
- The `flow` agent tab; the runner reopens it if it disappears.

## How it works (and why it isn't just clicking the UI)

| Step | Mechanism |
|---|---|
| Prompt into composer | `execCommand('insertText')` on the ProseMirror div — `fill` does not work on contenteditable |
| Submit | click `button[aria-label="Start generation"]` |
| Know it finished | wait for the **Stop** button to appear, then disappear |
| Export | fetch the CDN URL at `=s1024` in the page, base64 it, read back in 80k slices over the DevTools bridge |

Three failure modes this design exists to avoid:

1. **Snapshot refs go stale.** Once a session passes `browse`'s 80-line snapshot
   cap, the composer falls out of the snapshot entirely. Everything here is
   selector- or DOM-based instead.
2. **The tab closes.** Agent tabs get closed under us; `ensure_page()` reopens and
   reloads as needed.
3. **Counting new images races the previous prompt.** A generation's second output
   often renders late, so "image count went up" is satisfied by the *previous*
   prompt's art — which silently mislabels every file by one. That is why
   completion is keyed to the Stop button, and why `wait_idle()` runs before each
   post.

## State

- Prompts: 65 extracted from the markdown pack (`SH-03` is a meta entry that
  points at `IC-01..04`, so nothing to generate).
- Done: `CH-01..07, CH-10, CH-11, CH-15`, `HU-01, HU-03..06, HU-10`,
  `IC-01, IC-05, IC-06`, `ME-01`, `SC-07`, `SH-01a`.
- Note: `SH-01a` was a manual 12-piece split of `SH-01`; the full `SH-01` sheet is
  still queued and may supersede it.
- `log*.txt` from each run is kept beside the runner in the temp workspace, not
  here; results are the source of truth.
