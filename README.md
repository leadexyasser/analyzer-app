# Ringba Call Analyzer

Ingest Ringba call recordings via webhooks, transcribe with Groq Whisper, analyze with Llama 3.3 70B, and view results in a dashboard.

## Tech Stack

- **Next.js 16** — App Router, TypeScript
- **Supabase** — PostgreSQL database, auth, file storage (free tier)
- **Groq API** — Whisper transcription + Llama 3.3 70B analysis (free tier)
- **Vercel** — Hosting (free Hobby tier)
- **GitHub Actions** — Cron job runner (free)

---

## Quick Setup

### 1. Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) account (free)
- A [Vercel](https://vercel.com) account (free, sign up with GitHub)
- A [Groq](https://console.groq.com) API key (free)
- A GitHub account with this repo pushed

### 2. Clone & Install

```bash
git clone git@github.com:leadexyasser/analyzer-app.git
cd analyzer-app
npm install
```

### 3. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`
3. Apply the database migration:
   - Go to **SQL Editor** in your Supabase dashboard
   - Paste and run the contents of `supabase/migrations/001_initial_schema.sql`
4. Go to **Authentication → URL Configuration** and add your Vercel URL as a redirect:
   - `https://your-app.vercel.app/auth/callback`
5. Go to **Authentication → Email Templates** and ensure "Magic Link" is enabled

> **Warning:** Supabase free projects pause after 7 days of inactivity. To prevent this, connect your project to the Supabase GitHub integration or visit the dashboard regularly.

### 4. Environment Variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (secret) |
| `RINGBA_WEBHOOK_SECRET` | Optional — HMAC secret for Ringba postback verification |
| `GROQ_API_KEY` | Your Groq API key from console.groq.com |
| `CRON_SECRET` | A random secret string for GitHub Actions auth |

Generate a secure `CRON_SECRET`:
```bash
openssl rand -hex 32
```

### 5. Local Development

```bash
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/login`.

### 6. Deploy to Vercel

1. Push to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → Import your GitHub repo
3. Add all environment variables from `.env.local` in the Vercel dashboard
4. Deploy

After deployment, copy your Vercel URL (e.g. `https://your-app.vercel.app`).

### 7. GitHub Actions Setup

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `APP_URL` | Your Vercel URL (e.g. `https://your-app.vercel.app`) |
| `CRON_SECRET` | Same value as your `CRON_SECRET` env var |

The cron job runs automatically every 5 minutes. You can also trigger it manually from the **Actions** tab.

### 8. Ringba Webhook Configuration

In your Ringba account:
1. Go to the campaign you want to track
2. Find **Postback / Webhook** settings (under Campaign → Settings → Postbacks or similar)
3. Add your webhook URL: `https://your-app.vercel.app/api/webhooks/ringba`
4. Set the method to **POST** with **JSON** body
5. Map the fields you want to send (call_id, recording_url, duration, etc.)

> Ringba's postback field names vary by configuration. The webhook endpoint accepts all common Ringba field naming conventions automatically.

---

## Testing the Pipeline

### Seed a test call

```bash
APP_URL=http://localhost:3000 npm run seed
```

Then trigger the job worker:
```bash
curl -X POST http://localhost:3000/api/jobs/process \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

### Run unit tests

```bash
npm test
```

---

## Monitoring Free-Tier Usage

### Groq API Limits

Check your daily Groq usage: https://console.groq.com

The app logs every Groq API call to the `api_logs` table. Query it in Supabase:

```sql
select service, count(*), sum(tokens_used)
from api_logs
where created_at > now() - interval '24 hours'
group by service;
```

The dashboard also shows **Groq Requests Today** on the homepage.

### Supabase Storage

The cleanup cron (runs daily at 2 AM UTC) deletes audio files older than 30 days. DB rows, transcripts, and analysis are kept indefinitely.

Check storage usage in **Supabase → Storage**.

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions and free-tier constraints.
