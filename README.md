# Chipsy

> Discord casino bot with a small control panel for hobby servers that want simple blackjack and texas tables without fuss.

Chipsy ships three pieces:
- a Discord bot that runs blackjack and texas hold'em tables;
- a control API that brokers data between the bot and the dashboard;
- a Vue dashboard that lets owners observe tables, tweak access policies and flush caches.

Everything runs on Node.js with MySQL and optional Redis. The stack favors small guilds, clear logs and manual buttons instead of hidden cron jobs.

This is a prototype for hobby servers. It is intentionally modest and it does not try to be:
- a real money product;
- a general purpose casino platform;
- an anti cheat system;
- a high availability cluster.

## Table of contents

- [architecture](#architecture)
- [features](#features)
- [quick start](#quick-start)
- [bot commands](#bot-commands)
- [panel and access control](#panel-and-access-control)
- [data model and persistence](#data-model-and-persistence)
- [security notes](#security-notes)
- [limitations](#limitations)
- [extending and customizing](#extending-and-customizing)
- [roadmap](#roadmap)
- [license](#license)

## Architecture

| layer | component | summary |
| --- | --- | --- |
| Discord bot | `bot/` | handles slash commands, game loops, lobbies and integration with MySQL and cache |
| Internal control server | `bot/internal/server.js` | exposes bot status, guild directory, table control and log ingestion over an authenticated HTTP surface |
| Control API | `api/` | Express app that terminates Discord OAuth, manages sessions and exposes the REST API used by the panel |
| Web panel | `panel/` | Vue dashboard that consumes the API, shows status cards, logs and active tables and lets admins change policies |
| Shared core | `shared/` | cross process utilities such as logging, experience curves, leaderboard analytics, game registry and admin helpers |
| Configuration | `config/` | environment loader, runtime constants, design tokens and marketing copy for the panel |
| Persistence | MySQL | holds users, balances, upgrades, logs and access control records |
| Cache | Redis or memory | optional cache for bot status and guild snapshots; falls back to a local map when Redis is not configured |

- discord users interact with slash commands; the bot reads and writes user state through MySQL;
- the bot exposes an internal HTTP API secured by `INTERNAL_API_TOKEN`;
- the API process talks to that internal endpoint via `InternalBotClient` so the panel never touches Discord directly;
- the panel authenticates through Discord OAuth, receives a session cookie and then talks only to `/api/v1`;
- a small WebSocket bridge streams status updates from the bot into the dashboard.

## Features

**Bot**
- blackjack and texas hold'em tables with lobby flow, timeouts and simple rebuy rules;
- per guild and per channel settings for table speed, auto clean and game availability;
- experience and upgrades system that affects rewards, cooldowns and utility unlocks;
- daily reward command backed by cooldown logic that lives in the database;
- global leaderboard that ranks players by net profit, current chips or win rate;
- structured logging with scopes and fields that feeds the panel log console.

**Control panel**
- discord OAuth login with minimal scopes and role based permissions;
- real time bot status card with health checks, shard count and toggle controls;
- access policy editor for whitelist, blacklist and guild quarantine rules;
- user table with search, role management and list membership toggles;
- live log console that pulls recent events and command logs from MySQL;
- active tables view that exposes a snapshot of every running game and basic remote actions such as stop and pause.

**Operations**
- single command local stack that brings up MySQL, bot, API and panel;
- docker compose setup for local and production targets;
- structured logger that can emit human readable lines or JSON for ingestion;
- thin internal RPC layer with retries and a circuit breaker for bot calls.

## Quick start

### Requirements

- node.js 18.17 or newer;
- docker with compose support for local MySQL;
- a Discord application with bot user, scopes and intents configured;
- a MySQL instance reachable from both bot and API.

### Environment

Chipsy reads configuration from `.env` and `.env.local` through `config/index.js`. For production deploys, provide a `.env.production` (same shape, real values) that is loaded when `CHIPSY_ENV=production` or `NODE_ENV=production`. Minimum useful variables:

- `DISCORD_CLIENT_ID`;
- `DISCORD_CLIENT_SECRET`;
- `DISCORD_BOT_TOKEN`;
- `DISCORD_OWNER_ID`;
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`;
- optional cache: `REDIS_URL` (or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TLS`, `REDIS_DATABASE`);
- `FRONTEND_REDIRECT_ORIGIN` for the panel oauth redirect;
- `INTERNAL_API_TOKEN` for the bot internal API;
- `SESSION_SECRET` with at least 32 random characters.

Local development usually works with the provided `docker-compose.local.yml`. The `mysql/init/00-init-chipsy.sql` script provisions a `chipsy_user` account and the `app_data` database.

### One shot dev stack

From the project root

```bash
npm install
npm run dev
```

`npm run dev` starts `scripts/devRunner.mjs` which will:

- detect whether it runs inside Docker;
- start the `chipsy-local-mysql` container through docker compose;
- wait for the container health check;
- spawn three node processes for bot, API and panel;
- stream their logs through the shared logger.

Once all services are up:

- panel: http://localhost:8080
- control API: http://localhost:8082/api/v1
- bot internal API: http://localhost:7310/internal

### Running pieces separately

If you prefer to manage MySQL and Docker yourself:

```bash
# bot only
npm run dev:bot

# control API only
npm run dev:api

# panel only
npm run dev:panel
```

You still need `.env` and a live MySQL instance. The bot looks up the internal API token and MySQL host through the same variables used in the dev runner.

### Production sketch

The repository ships a `docker-compose.yml` that builds three images:

- `chipsy-bot` from `bot/Dockerfile`;
- `chipsy-api` from `api/Dockerfile`;
- `chipsy-panel` from `panel/Dockerfile`.

They are wired into two external networks:

- `shared-db` for MySQL;
- `shared-edge` for public traffic

The compose file expects `.env` and `.env.production` to exist on the host. You are responsible for TLS termination, backups and monitoring.

## Bot commands

All commands are implemented as Discord slash commands and live under `bot/commands`. A non exhaustive map:

- `/texas`
  Start a texas hold'em table in the current channel. Includes a lobby phase with public lobby discovery, seat limits, buy in range and rebuy handling. Uses shared game settings so guild and channel overrides apply automatically
- `/blackjack` 
  Start a blackjack table with similar lobby flow and upgrades that affect withholding and win probability insights
- `/profile` 
  Show a player profile with chips, level, experience and purchased upgrades. Supports viewing another user in read only mode and drives upgrade purchases through buttons
- `/reward` 
  Redeem a periodic reward that credits chips into the user balance and sets the next reward timestamp
- `/leaderboard`
  Show the global leaderboard for one metric at a time with a select control that lets the caller switch between net profit, current chips and win rate
- `/config`
  Open an interactive configuration panel for game settings scoped to guild, channel or user. Edits flow through the shared settings store then back into the games

The bot keeps track of active games through `shared/gameRegistry`. Games expose a small remote state that the panel uses to render the active tables view.

## Panel and access control

The panel is a Vue application under `panel/`. It talks only to the control API and knows nothing about Discord tokens.

**Roles**

Panel roles live in `panel/src/constants/roles.js` and in the API access control service:

- `MASTER` has full ownership and can assign every role;
- `ADMIN` can access the full dashboard, manage roles and modify access lists;
- `MODERATOR` can read logs and monitor tables but cannot change settings;
- `USER` has no panel access and can only use the Discord bot.

Permissions are derived from the role through `buildPermissionMatrix` so you can check `req.permissions` inside API routes and keep the logic in one place.

**Lists and guild quarantine**

The access control service in `api/services/accessControlService.js` maintains

- a `user_access` table with roles and whitelist or blacklist flags;
- an `access_policies` row that controls whether to enforce whitelist, blacklist or guild quarantine;
- a `guild_quarantine` table that tracks guild status and basic metadata.

The panel exposes switches that flip these flags, then the bot consults the policy before serving interactions. Owners stay hard wired to `MASTER` even if someone tries to demote or blacklist them.

## Data model and persistence

Chipsy uses MySQL for everything stateful:

- user profile and bankroll;
- progression levels and upgrade fields;
- game and leaderboard aggregates;
- panel logs and audit style messages;
- access control records.

The `shared/database/dataHandler` module wraps the `mysql2` pool and exposes high level methods such as `getUserData`, `updateUserData`, `redeemReward` and `getLeaderboard`. Game commands treat it as a service instead of talking to the driver directly.

Experience and upgrades live in `shared/experience.js` and `shared/features.js`. They take raw database records, clamp values into safe ranges and compute derived values such as required experience per level or upgrade costs.

`shared/services/adminService.js` is the main bridge between the bot and the panel. It:

- builds bot status snapshots;
- collects and paginates logs from the `logs` table;
- exposes active tables and remote actions;
- triggers safe operations such as slash command sync or runtime config reload.

## Security notes

The stack is opinionated but simple. Things it actually does:

- terminates Discord OAuth in the API process, not in the panel;
- relies on express session with a signed cookie and server side store;
- requires `SESSION_SECRET` and rejects startups where the secret is too short;
- issues a per session csrf token and requires it on state changing endpoints;
- uses `helmet` with strict defaults for API responses;
- supports HTTPS enforcement with a small allow list for local hosts;
- binds API tokens to ip and user agent through a tiny token cache;
- gates the internal bot API behind `INTERNAL_API_TOKEN` and does not expose it to browsers.

Things it does not do:

- no encryption at rest for MySQL or logs;
- no rate limiting beyond a coarse global limiter on `/api/v1`;
- no abuse detection, chargeback handling or real money integrations;
- no multi region or multi node coordination.

Assume you have to wrap this stack inside your own network, monitoring and backup strategy if you run it for real users.

## Limitations

- tuned for small Discord guilds; nothing here has been battle tested at scale;
- relies on a single MySQL instance and optional Redis; there is no sharding story;
- assumes a single bot process even though discord.js supports sharding;
- database migrations are manual and live in scripts or external tools;
- tests cover the main game flows and the control plane but do not qualify as a full regression suite.

## Extending and customizing

Config entry points:

- `config/index.js` for environment parsing and runtime constants;
- `config/uiTheme.js` for shared design tokens used by the panel and some embed choices;
- `config/marketingContent.js` for copy that appears on the panel home page;
- `config/userDetailLayout.js` for which fields appear in the user detail view.

Common extension points:

- add new upgrades by editing the `upgradeDefinitions` section in `config/index.js`;
- add or tweak panel roles in `panel/src/constants/roles.js` then update API checks if needed;
- register new games by wiring them into the shared settings and registry, then exposing a command under `bot/commands`;
- add new remote actions by extending `shared/services/adminService.js` and teaching the panel component how to call them.

When you change commands, remember to push them to Discord either through the panel action that triggers command sync or through the `scripts/syncCommands.js` script.

## Roadmap

There is no formal roadmap inside this repository but here I share some realistic next steps to harden it:

- more tests around edge cases in bankroll, upgrades and log rotation;
- better observability for bot to API RPC failures;
- automatic database migrations for new tables and columns;
- structured export of game history for external analytics;
- optional feature flags for experimental games;
- roulette tables with shared settings, telemetry hooks and role based access just like blackjack and texas;
- panel toggles for upcoming game presets, roulette odds, per guild table caps and stricter bankroll policies;
- roadmap hooks in `config/index.js` so you can predefine launch configs for roulette, seasonal events or custom chip sinks;
- richer audit tooling that highlights when guild level overrides drift away from the canonical config or when roulette payouts exceed caps;
- automation around command sync and panel cache warmup to keep future games and panel cards in lock step.

## License
See [LICENSE](./LICENSE).
