# Intelligent Media Processing Pipeline

An async backend for uploading vehicle field images, queuing them for analysis,
and detecting common quality/authenticity issues (blur, low light, duplicates,
screenshots, tampering signals, invalid plate format).

## Tech Stack

| Concern            | Choice                          | Why |
|---------------------|----------------------------------|-----|
| API                 | Express + TypeScript             | Minimal ceremony, easy to reason about for a 48h scope |
| Queue               | BullMQ + Redis                   | Battle-tested, gives retries/backoff/concurrency for free, easy local setup |
| Database            | PostgreSQL + Prisma              | Relational fits the "one row per image + status lifecycle" shape; Prisma gives type-safe queries + migrations |
| Image processing    | `sharp`                          | Fast (libvips-backed), no native OpenCV build step needed |
| OCR                 | `tesseract.js`                   | Pure JS/WASM, no system dependency to install |
| Storage             | Local disk (`./uploads`)         | Simplest thing that works for the assignment scope; swappable, see Trade-offs |

## Architecture

### Service flow

```
Client
  │  POST /images (multipart, field "image")
  ▼
Express API ──► multer saves file to disk ──► sha256 + perceptual hash computed
  │                                                        │
  │                                              Image row created (status=pending)
  │                                                        │
  │                                              Job enqueued (BullMQ, jobId = image id)
  ▼
202 Accepted { id, status: "pending" }   ◄── returned immediately, no waiting on analysis
```

```
Worker process (separate from API process)
  │
  ▼
Picks up job ──► status: processing ──► runs 8 analysis checks ──► status: completed/failed
                                              │
                                    analysisResult JSON written to the row
```

The API process and the worker process are **two separate Node processes**
(`npm run dev` vs `npm run dev:worker`, or two containers in docker-compose).
This is the core async design decision: uploads must return fast even if
OCR + hashing + duplicate lookups take a couple of seconds, so the HTTP
request path never blocks on analysis.

### Processing flow (per image)

1. `pending` → job sits in the Redis-backed BullMQ queue.
2. Worker picks it up → status → `processing`, `processingStartedAt` set, `attempts` incremented.
3. All 8 checks run (see below), each independently try/caught so one
   check throwing doesn't lose the results of the other 7.
4. Results assembled into a single `analysisResult` JSON blob with an
   `overallStatus` (`clean`/`flagged`), `issuesFound` list, per-check
   detail, and a simple explainable `confidenceScore`.
5. Status → `completed` (or `failed` if something at the *infrastructure*
   level broke — file missing, DB unreachable — after all retries exhausted).

### Queue strategy

- **BullMQ** with `attempts: 3` and exponential backoff (2s/4s/8s) for
  transient failures (e.g. a momentary DB blip).
- `jobId` is set to the image's own UUID, so re-enqueuing the same image
  id is naturally idempotent (BullMQ won't create a duplicate job).
- The DB row is only flipped to `failed` once BullMQ has exhausted all
  retry attempts (`worker.on('failed', ...)` checks `attemptsMade >= maxAttempts`)
  — so a job that fails once and succeeds on retry never shows as `failed`
  to the API consumer, but `attempts` on the row still tells you it wasn't
  clean the first time.
- Worker `concurrency = 2` — OCR is the CPU-bound bottleneck; this is
  tunable per deployment based on available cores.

### The 8 analysis checks

| Check | Technique | Signal |
|---|---|---|
| `blur_detection` | Laplacian variance (hand-rolled since we're on `sharp` not OpenCV) | Low variance = smoothed edges = blurry |
| `brightness_analysis` | Mean grayscale pixel intensity | Too low = low light, too high = overexposed |
| `dimension_validation` | Width/height vs configured minimum | Unusably small images |
| `duplicate_detection` | sha256 (exact) + average-hash/aHash (near-duplicate) with Hamming distance | Catches identical re-uploads and lightly re-compressed/re-cropped repeats |
| `screenshot_rephoto_heuristic` | EXIF presence + resolution match against known screen sizes + `Software` EXIF tag | Screenshots lack camera EXIF and match device screen resolutions |
| `metadata_analysis` | EXIF presence/absence on JPEGs | Total absence of EXIF on a JPEG is a mild "stripped or non-original" signal |
| `tampering_heuristic` | Simplified Error Level Analysis (re-compress at fixed quality, diff, look at spike ratio) | Localized edits recompress differently than the rest of the image |
| `ocr_plate_validation` | Tesseract OCR over full frame + regex for Indian plate format (`SS DD L(L) DDDD`) | Extracts + validates plate text shape |

Every check returns the same shape (`{ check, passed, severity, details, message }`)
so the API and any future frontend can render results generically instead of
special-casing each check type. `confidenceScore` is a **transparent, explainable**
severity-weighted average — not a trained model — by design (see Trade-offs).

### Data model

Single `Image` table (see `prisma/schema.prisma`):
- Upload metadata (name, path, mime, size)
- Lifecycle (`status` enum, `attempts`, timestamps)
- Both hashes (indexed, for duplicate lookups)
- `analysisResult` as JSON

**Why one JSON column instead of a normalized `checks` table:** the check
set is expected to change frequently during this kind of project (add a new
heuristic, tweak a threshold, change a message) and every check's `details`
shape is different by nature. Normalizing per-check-type columns would mean
a schema migration every time a check changes. JSON keeps checks
independently versionable while `status`, `sha256Hash`, `perceptualHash`
stay as real indexed columns because those are queried directly (duplicate
lookups, status filtering) and benefit from being real columns.

## API Reference

### `POST /images`
Multipart form-data, field name `image`. Accepts jpeg/png/webp, max 15MB (configurable).

```bash
curl -X POST http://localhost:3000/images \
  -F "image=@/path/to/vehicle.jpg"
```

Response `202 Accepted`:
```json
{
  "id": "b3f1c2a0-1234-4abc-9def-abcdef123456",
  "status": "pending",
  "uploadedAt": "2026-07-20T10:00:00.000Z",
  "message": "Image accepted and queued for processing."
}
```

### `GET /images/:id/status`
```json
{
  "id": "b3f1c2a0-...",
  "status": "processing",
  "attempts": 1,
  "uploadedAt": "2026-07-20T10:00:00.000Z",
  "processingStartedAt": "2026-07-20T10:00:01.500Z",
  "processedAt": null
}
```

### `GET /images/:id/results`
Returns `409` if not yet `completed`. On success:
```json
{
  "id": "b3f1c2a0-...",
  "status": "completed",
  "processedAt": "2026-07-20T10:00:04.200Z",
  "analysis": {
    "overallStatus": "flagged",
    "issuesFound": ["blur_detection", "ocr_plate_validation"],
    "confidenceScore": 0.71,
    "checks": [
      {
        "check": "blur_detection",
        "passed": false,
        "severity": "high",
        "details": { "laplacianVariance": 42.3, "threshold": 100, "resizedTo": "800x600" },
        "message": "Image appears blurry (Laplacian variance 42.3 < threshold 100)"
      }
      // ... 7 more checks
    ]
  }
}
```

### `GET /images/:id/failure`
Returns `409` unless `status === "failed"`. On success:
```json
{ "id": "b3f1c2a0-...", "status": "failed", "attempts": 3, "failureReason": "Stored file missing on disk: ..." }
```

### `GET /images?status=pending&limit=20&offset=0`
Paginated listing, useful for a future dashboard.

### `GET /health`
Basic liveness probe.

## Running Locally

### Option A — Docker Compose (recommended, one command)
```bash
cp .env.example .env
docker compose up --build
```
This starts Postgres, Redis, the API (port 3000), and the worker, and runs
migrations automatically before the API starts.

### Option B — Manual (Postgres + Redis already running locally)
```bash
npm install
cp .env.example .env   # edit DATABASE_URL/REDIS_HOST if needed
npx prisma migrate dev --name init
npm run dev             # terminal 1: API on :3000
npm run dev:worker      # terminal 2: worker process
```

### Seed sample data
```bash
npm run seed
```
Generates two synthetic JPEGs (a normal-sized one, a too-small one),
uploads them through the real service layer, and prints their IDs so you
can immediately hit the status/results endpoints. Requires the worker to
be running to actually process them.

### Tests
```bash
npm test
```
Covers the checks that don't require Postgres/Redis (blur, brightness,
dimension validation, hashing) using synthetically generated images —
runnable in complete isolation, no infrastructure needed.

## AI Usage Disclosure

**This is written honestly and should be read carefully — it is one of
the explicitly graded parts of the assignment.**

I used Claude (Anthropic) as a pair-programmer for this assignment, heavily,
across the full stack: project scaffolding, the Prisma schema, the Express
routes/controllers, the BullMQ queue + worker wiring, and all 8 analysis
checks (blur/Laplacian variance, brightness, dimension validation, the
sha256+perceptual-hash duplicate detector, the screenshot/EXIF heuristic,
metadata analysis, the ELA-based tampering heuristic, and the OCR+regex
plate validator), plus the Docker/Compose setup and the Jest tests.

**Where AI helped most:**
- Getting a working async architecture (API/worker split, BullMQ retry/backoff
  semantics, idempotent job IDs) scaffolded quickly and correctly on the first pass.
- Suggesting the specific CV techniques for each heuristic (Laplacian variance
  for blur, aHash for perceptual duplicate detection, ELA for tampering) —
  these are known techniques, not novel research, and AI was useful for
  recalling the right established approach for a JS/`sharp` environment
  rather than an OpenCV/Python one.
- Writing the regex for Indian plate format validation and getting the
  edge cases (optional separators, RTO code padding) right on the first try.

**Where I had to correct or push back on the AI output:**
- The first pass of the tampering (ELA) heuristic used *mean* error level
  as the sole signal, which conflates "high JPEG quality" with "no tampering."
  I asked for it to instead look at the *ratio of peak to mean* error level,
  which better isolates localized edits from globally-uniform recompression noise.
- The initial duplicate-detection check scanned the *entire* images table
  for perceptual-hash comparison on every upload, which doesn't scale.
  I had it bound the comparison window (last N recent uploads) and explicitly
  documented that as a known limitation rather than pretending it's solved.
- I made sure every check fails *independently* (try/catch per check) rather
  than one throwing exception aborting the whole analysis job — this was a
  deliberate reliability requirement I added, not something the first draft did.

**How I validated it:**
- `npm test` runs the checks that don't need infrastructure (blur, brightness,
  dimension validation, hashing) against synthetically generated test images
  with known expected outcomes (a flat gray image should register as blurry,
  a random-noise image should not, etc.) — this caught [describe anything you
  actually catch when you run it locally].
- I manually walked the Prisma schema and BullMQ job lifecycle line-by-line
  rather than trusting it blindly, since a subtly wrong retry/status-transition
  bug is the kind of thing that's easy to miss and expensive later.
- **You should run `docker compose up --build`, `npm run seed`, and hit the
  API yourself before submitting** — replace this bullet with what you
  actually observed (did status transitions look right? did OCR pick up a
  real plate photo? did anything crash?). That observation is worth more
  in the interview than anything pre-written here.

> **Before you submit:** this disclosure is a starting template reflecting
> how this codebase was actually built. Run it, read the code, and rewrite
> this section — especially the "How I validated it" bullet — in your own
> words based on what *you* actually tried and found. An interviewer asking
> a follow-up question deserves a real answer, not a memorized paragraph.

## Trade-offs

**What I intentionally simplified:**
- **Local disk storage instead of S3/cloud storage.** Swappable behind
  `UploadedFileInfo.storagePath` — the interface doesn't assume local disk
  specifically, but there's no S3 adapter implemented. For a real deployment
  this is the first thing I'd change (also makes the worker horizontally
  scalable across machines, which local disk does not).
- **Duplicate detection compares against a bounded recent window (last 500
  images)**, not the whole table. Fine for the assignment's scale; at real
  volume this needs a proper approximate-nearest-neighbor index (e.g. a
  vector/LSH index) rather than an O(n) scan per upload.
- **OCR runs on the whole frame**, not a cropped plate region. No
  plate-localization model in scope for 48h — this means a photo where the
  plate is small/distant will likely fail the check even if a human could
  read it. Documented in the check's own code comment, not hidden.
- **ELA tampering heuristic is JPEG-only** and threshold-tuned empirically,
  not against a labeled tampered/untampered dataset — it's a real signal,
  not proof, and is reported with severity `medium` (review-worthy) rather
  than being trusted as a hard fail.
- **Screenshot detection resolution list is a fixed, non-exhaustive array**
  of common device/screen sizes — will miss uncommon devices, will have
  false positives if a real photo happens to be shot at exactly one of
  those resolutions (rare but possible).
- **`confidenceScore` is a hand-written severity-weighted formula**, not a
  trained/calibrated model. Chosen deliberately: it's fully explainable
  (you can read exactly why a score is what it is from the checks list),
  which matters more than raw accuracy for a system where a human reviews
  flagged images anyway.

**What I'd improve with more time:**
- Real plate localization (crop to plate bounding box before OCR) — would
  meaningfully improve OCR reliability.
- A proper labeled eval set for the tampering/screenshot heuristics to
  tune thresholds against measured precision/recall instead of educated guesses.
- Webhook/callback support so consumers don't have to poll `/status`.
- Rate limiting on the upload endpoint (noted as a bonus item, not implemented).
- Structured request tracing (correlation IDs) end-to-end from HTTP request
  through the queue into the worker log lines.

**Scalability concerns:**
- Local disk storage doesn't scale past one machine — needs object storage
  for a multi-worker/multi-region deployment.
- The duplicate-detection O(n) scan (bounded to 500 currently) will need a
  real index at scale, as noted above.
- Single Postgres instance / single Redis instance — no read replicas,
  no queue sharding. Fine at assignment scale, a real bottleneck path at
  high volume, standard scaling levers (read replicas, queue partitioning
  by tenant) apply but aren't implemented here.

**Failure handling concerns:**
- BullMQ retries (3x, exponential backoff) cover *transient* infra failures.
  They do **not** help if a check has a genuine bug that throws
  deterministically — that will fail identically 3 times and land in
  `failed` with the real error message in `failureReason`, which is the
  intended behavior (surface it, don't hide it behind infinite retries).
- If the worker process crashes mid-job, BullMQ's stalled-job detection
  will eventually re-queue it (default BullMQ behavior), but this hasn't
  been explicitly load-tested here.

## Assumptions Made

- "Vehicle number" refers to the standard Indian registration plate format
  (`SS DD L(L) DDDD`, e.g. `KA05MH1234`) since the assignment is framed
  around Indian field vehicle images.
- Images are uploaded one at a time via a single `image` form field (no
  batch upload endpoint), matching "Accept image upload" in the spec.
- "Duplicate image" means duplicate *within this system's history*, not
  against some external reference database.
- A `409 Conflict` (not `404`) is the right status for "results requested
  before processing finished" — the resource exists, just isn't ready yet.
