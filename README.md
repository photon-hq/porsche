# Porsche

A Slack bot that tracks team presence and posts daily activity reports. Built with [Chat SDK](https://github.com/vercel/chat), [ElysiaJS](https://elysiajs.com), and [Bun](https://bun.sh).

## How it works

1. **Polls presence every minute** — calls Slack's `users.getPresence` for each workspace member (excluding guests and bots)
2. **Stores data in memory** — presence snapshots are kept for 48 hours
3. **Posts a daily report at 10:00 AM** — covers yesterday 10am to today 10am (PST by default, override with `TZ` env var)
4. **On-demand reports via `/porsche`** — generates a report for the last 24 completed hours

### Activity indicators

Each block represents one hour. Hover any block to see the hour it represents.

| Color | Meaning | Away time |
|-------|---------|-----------|
| Green | Active | ≤ 10 min |
| Yellow | Partially away | ≤ 25 min |
| Red | Away | > 25 min |
| Gray | No data | Bot wasn't running |

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Add bot scopes under **OAuth & Permissions**:
   - `users:read`
   - `chat:write`
3. Enable **Event Subscriptions** with request URL: `https://your-domain/api/webhooks/slack`
   - Subscribe to bot event: `app_mention`
4. Create a **Slash Command**:
   - Command: `/porsche`
   - Request URL: `https://your-domain/api/webhooks/slack`
5. **Install to Workspace** and copy the Bot Token and Signing Secret

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_REPORT_CHANNEL=C0123456789
SLACK_USER_TOKEN=xoxp-your-user-token  # Optional: enables custom emoji hover labels
PORT=3000
TZ=America/Los_Angeles  # Optional: defaults to PST
```

To find `SLACK_REPORT_CHANNEL`: open the channel in Slack → click channel name → scroll to bottom of About panel → copy Channel ID.

### 4. Add the bot to your report channel

In Slack, go to the channel and run `/invite @your-bot-name`.

### 5. Run

```bash
bun src/index.ts
```

## Usage

- **Daily report**: Automatically posted at 10:00 AM to the configured channel
- **On-demand report**: Type `/porsche` in any channel to generate a rolling 24-hour report up to the current hour (excludes the current incomplete hour)

## Rate limits

Slack's `users.getPresence` is rate-limited at ~50 requests/minute. This works for workspaces with fewer than 50 members. For larger workspaces, the polling interval would need to be increased.

## Project structure

```
src/
  index.ts       — Entry point: bot setup, Elysia server, schedulers
  presence.ts    — Presence polling, in-memory storage, member fetching
  report.ts      — Report generation and posting
emojis/              — Custom emoji PNGs (auto-uploaded on first run if SLACK_USER_TOKEN is set)
scripts/
  setup-emoji.ts   — Regenerates emoji PNGs
  upload-emoji.ts  — Manual bulk-upload alternative
```
