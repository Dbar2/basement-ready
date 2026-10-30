# Practice harness: scoring single photos

Scores a folder of labelled basement photos through the app's own photo path, so a change to SAM's concepts, its confidence bars or the merge can be judged on numbers instead of a look. It works on any photos: real takes, stills from a video, or renders.

| File | What it does |
|---|---|
| `score.ts` | Runs each photo the way an upload does (upright, 1280 px, `server/photoInput.ts`), SAM 3.1 for every concept with the app's bars (`server/photoFinds.ts`), the merge, and optionally Spark's reading (`server/assess.ts`). Compares all of it with the labels and writes a Markdown report and a JSON of every find and SAM's raw boxes |
| `sweep.ts` | Tries other confidence bars on SAM answers `score.ts` already saved. No calls |
| `scoring.ts` | The scoring itself: when a find lands on a labelled thing, hits, misses and false finds, and Spark's grade per rule |

## Labels

A `labels.json` next to the photos, written by looking at each photo:

```json
{ "photos": { "furnace-room-1": {
  "file": "furnace-room-1.jpg", "keep": true, "split": "train",
  "objects": { "furnace": [[0.55, 0.4, 0.2, 0.3]], "window": [[0.1, 0.2, 0.15, 0.08]] },
  "unsure": ["duct"],
  "spark": { "egress": "fix?", "service": "fix", "fire": "fix" }
} } }
```

- `objects`: every thing really in the photo, by key (`window`, `stairs`, `duct`, `beam`, `furnace`, `panel`, `heater`, `roughin`, `drain`, `bulkhead`, `door`), each box `[x, y, w, h]` as fractions of the photo. Boxes are drawn by eye, so a find counts when its centre lands in the box (with a little slack) or they overlap by a fifth.
- `unsure`: keys not scored on this photo.
- `split`: `train` to tune on, `holdout` to judge a change on.
- `spark`: what Spark should say from this photo alone, per rule group in `SPARK_RULES`. `fix`/`ok` means that claim is due; `fix?`/`ok?` means that claim or a hedge is fine; `none` means nothing in the photo settles it. Never ask for an escape-window claim by eye: a small window is `fix?`, not `fix`.

## Run it

Every Meta call is recorded and replayed (`server/replay.ts`), so only the first run of a photo costs anything. Keep `REPLAY_DIR` private.

```bash
REPLAY_DIR=media/private/replay/practice tsx --env-file=.env scripts/practice/score.ts --dir media/private/my-photos --dry
```

- `--dry` counts the calls that aren't saved yet and what they'd cost, and calls nothing
- `--split train|holdout`, `--ids a,b`
- `--spark labelled` has Spark read the photos whose label says what it should find (about $0.03 a photo)
- `--concepts file.json` tries other SAM wordings: a list of `{ concept, kind, label }`
- `--budget 10` stops before new calls would take the ledger (`practice-spend.jsonl` in `REPLAY_DIR`) past that many dollars
- `--out`, `--report` save the JSON and the Markdown

Then, for free: `tsx scripts/practice/sweep.ts --from out.json --labels labels.json`.

Never publish the scores: they go in private notes, not this repo.
