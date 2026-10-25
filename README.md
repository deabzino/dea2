# Among Us Discord Bot

A Discord bot for coordinating Among Us games, including lobby-code sharing,
voice-channel muting, and dead-player tracking.

## Deploying to Render

Create a new **Web Service** from this repository. Render will detect
`render.yaml`; alternatively, use these settings:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm --workspace @workspace/api-server run start`
- Health-check path: `/api/healthz`

Set these environment variables in Render:

- `DISCORD_BOT_TOKEN` (required): your Discord application's bot token.
- `DATABASE_URL` (required): Supabase Postgres connection string. Use the
  Supavisor **Session pooler** URI from Supabase's Connect panel (port `5432`),
  with the database password filled in.
- `NODE_ENV=production`
- `LOG_LEVEL=info` (optional)

Supabase Postgres stores N-word counts and counter settings, logging
preferences, lobby codes, and dead-player lists. No Render persistent disk is
used. The app creates its tables when it starts. To preserve counts from an
old N-word JSON file, keep that file available for one startup and temporarily
set `NWORD_DATA_FILE` to its path. The app imports its counts and settings into
Supabase once; after the `Synchronized JSON N-word data into the database` log
appears, remove the variable and detach the old disk. If the old file is
already gone, its counts cannot be recovered from the empty Supabase table.

Render supplies `PORT` automatically. Do not set it yourself.

In Supabase, copy the Session pooler connection string from **Connect**. Render
services may use IPv4-only networking; Supabase documents the shared pooler as
IPv4-accessible on all plans. The direct database endpoint may require IPv6 or
an IPv4 add-on.

The bot must run on an always-on Render instance. Free web services can
spin down after inactivity, which disconnects a Discord gateway bot; use a
paid web service or an always-on background worker for reliable uptime.

For local development, install Node.js 22+ and npm, set a Supabase
`DATABASE_URL`, then run:

```sh
npm install
PORT=3000 DISCORD_BOT_TOKEN=your-token npm --workspace @workspace/api-server run dev
```

On PowerShell, set the variables first with `$env:PORT = '3000'`,
`$env:DISCORD_BOT_TOKEN = 'your-token'`, and `$env:DATABASE_URL` to the
Supabase Session pooler URI.
