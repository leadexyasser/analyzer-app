# Architecture & Design Decisions

## Overview

```
Ringba webhook → /api/webhooks/ringba → DB insert → job queue
                                                          ↓
GitHub Actions (every 5 min) → /api/jobs/process → download → transcribe → analyze
                                                                              ↓
Dashboard ← calls table ← complete
```

The pipeline is intentionally asynchronous. The webhook handler returns immediately (under 1 second). All heavy work — downloading audio, calling Groq APIs — happens in a separate worker invoked by GitHub Actions.

---

## Free-Tier Constraints & How We Handle Them

### Vercel Hobby (60s Node runtime limit)

The job worker (`/api/jobs/process`) processes at most 3 jobs per invocation. Each job runs sequentially within the 60-second window. Large audio files are chunked server-side to stay within memory limits.

We do NOT use Vercel Cron (Hobby tier is limited to 1 cron/day). GitHub Actions runs every 5 minutes instead.

### Groq Rate Limits

- **429 responses are never counted as failures.** When rate-limited, the job is re-queued for 1 minute later without consuming a retry attempt.
- **Exponential backoff:** 1 min → 5 min → 30 min on real failures.
- **Max 3 attempts** per job before marking as permanently failed (retriable via dashboard).
- **api_logs table** tracks every Groq request with status code, duration, and token usage so you can see daily quota consumption.

### Groq Whisper 25MB File Limit

Audio files larger than 24MB are split using `ffmpeg-static` (bundled with the app, no external binary needed) into time-based chunks. Each chunk is transcribed separately, then segment timestamps are adjusted and concatenated into a single transcript.

### Supabase Free Tier (500MB DB, 1GB Storage)

- Audio files older than 30 days are deleted from storage by a daily GitHub Actions cleanup cron.
- Transcripts and analysis JSON are kept indefinitely (small — a few KB per call).
- Supabase projects pause after 7 days of inactivity. The project must be manually unpaused from the dashboard, or you can set up a keep-alive ping.

---

## Known Limitations

### No True Diarization

Groq Whisper (`whisper-large-v3-turbo`) does not support speaker diarization. We use a heuristic: pauses longer than 1.5 seconds between transcript segments are treated as speaker turns, alternating between "Speaker A" and "Speaker B".

This breaks down for:
- Calls with multiple agents or transfers
- Calls with frequent interruptions
- Very short exchanges with no pauses

The LLM analysis prompt explicitly notes this limitation and asks the model to infer which speaker is the agent from context clues.

**Upgrade path:** True diarization requires a separate service (AssemblyAI, Deepgram, AWS Transcribe). All are paid. If budget allows, replace `buildSpeakerLabeledTranscript()` in `lib/groq.ts` with a diarization API call.

### Groq Daily Request Caps

Groq's free tier has daily request limits that change over time. If you exceed them, jobs are automatically re-queued (not failed). Monitor usage via `api_logs` or `console.groq.com`.

**Upgrade path:** Groq's paid tier has significantly higher limits. The `GROQ_API_KEY` env var is the only change needed.

### Ringba Webhook Signature Verification

Ringba does not publicly document a standard webhook signature header or algorithm. The app attempts HMAC-SHA256 verification using `X-Ringba-Signature` or `X-Signature` headers if `RINGBA_WEBHOOK_SECRET` is set.

If Ringba uses a different header or algorithm, set `RINGBA_WEBHOOK_SECRET=` (empty) to skip verification and rely on the obscurity of the webhook URL instead. All payloads are logged to `webhook_events` regardless.

### Supabase Auth (Magic Link Only)

Auth uses Supabase magic links (email OTP). There's no password auth, Google/GitHub OAuth, or MFA. This is intentional — simple and free. Add OAuth providers in Supabase Auth settings and the Supabase SSR client will handle the rest.

---

## Data Flow Detail

### Webhook Ingestion (`/api/webhooks/ringba`)

1. Read raw body as text (needed for signature verification)
2. Insert raw payload into `webhook_events` — this happens BEFORE any validation, so we never lose a payload
3. Verify HMAC signature (if configured)
4. Parse with Zod schema that accepts 20+ Ringba field name variants
5. Check `ringba_call_id` uniqueness — return 200 without reprocessing if exists (idempotency)
6. Insert into `calls` with status `pending`
7. Enqueue `download` job in `processing_jobs`
8. Return 200 in under 1 second

### Job Worker (`/api/jobs/process`)

Protected by `Authorization: Bearer <CRON_SECRET>`. Processes up to 3 queued jobs per call.

Job lifecycle: `queued` → `running` → `done` | `failed` (with backoff re-queue)

**Download job:**
- Fetches audio with 30s timeout
- Splits into <24MB chunks if needed (ffmpeg)
- Uploads all chunks to Supabase Storage (`recordings` bucket, private)
- Enqueues `transcribe` job

**Transcribe job:**
- Lists all chunk files from storage for this call
- Transcribes each chunk via Groq Whisper (verbose_json with segment timestamps)
- Adjusts timestamps across chunks for continuity
- Applies pseudo-diarization (pause detection)
- Stores raw transcript in `calls.transcript` (JSONB) and labeled text in `calls.transcript_text`
- Enqueues `analyze` job

**Analyze job:**
- Calls Groq Llama 3.3 70B with structured JSON prompt
- Forces JSON output via `response_format: { type: 'json_object' }`
- Validates response with Zod `AnalysisSchema`
- On parse failure: retries once with stricter prompt
- Stores analysis in `calls.analysis` (JSONB)
- Copies `quality_score` and `flags` to indexed columns for fast filtering

### Storage

Audio is stored under `calls/<call_id>/<filename>` in a private bucket. Access is exclusively via signed URLs (1-hour expiry), generated server-side and returned to the client in API responses. Audio is never served directly.

---

## Upgrade Paths

| Component | Free Tier | Paid Upgrade |
|---|---|---|
| Transcription | Groq Whisper (free, no diarization) | AssemblyAI, Deepgram (diarization + higher accuracy) |
| Analysis | Groq Llama 3.3 70B (free) | Claude 3.5 Sonnet, GPT-4o (better JSON reliability) |
| Hosting | Vercel Hobby (60s timeout) | Vercel Pro (300s), Railway, Render |
| Database | Supabase free (500MB, pauses) | Supabase Pro ($25/mo, no pause) |
| Storage | Supabase free (1GB) | Supabase Pro (100GB) |
| Cron | GitHub Actions (free) | Vercel Cron, Upstash QStash |

## No Paid Services Used

This project was intentionally designed to run entirely on free tiers. If you consider adding a paid service, document it here rather than adding it silently.
