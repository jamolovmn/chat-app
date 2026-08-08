# Matrix Chat App

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Matrix](https://img.shields.io/badge/Matrix-protocol-000000?logo=matrix&logoColor=white)](https://matrix.org)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![GitHub stars](https://img.shields.io/github/stars/jamolovmn/chat-app?style=flat)](https://github.com/jamolovmn/chat-app/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/jamolovmn/chat-app)](https://github.com/jamolovmn/chat-app/commits)

A mobile-first, real-time chat application built on the [Matrix protocol](https://matrix.org)
with **Next.js 14** (App Router) against a Matrix (Synapse) homeserver.
Supports 1-on-1 chat, media sharing, location, voice messages, and WebRTC
video calls.

<img width="1907" height="915" alt="Chat preview" src="https://github.com/user-attachments/assets/a351f027-a981-4351-bb15-d59231f0d331" />

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Quick start (local dev)](#quick-start-local-dev)
6. [Environment variables](#environment-variables)
7. [Video calls (TURN) — server-side note](#video-calls-turn--server-side-note)
8. [Docker / production deployment](#docker--production-deployment)
9. [Project structure](#project-structure)
10. [Troubleshooting](#troubleshooting)
11. [Security notes](#security-notes)
12. [Roadmap](#roadmap)
13. [License](#license)

---

## Features

- ✅ Text messages
- ✅ Voice messages with waveform
- ✅ Image messages with preview
- ✅ File sharing
- ✅ Location sharing
- ✅ Reply / edit / delete messages
- ✅ Typing indicator
- ✅ Online presence
- ✅ Read receipts
- ✅ Web push notifications (Notifications API)
- ✅ Authenticated media download
- ✅ Auto-join on invite
- ✅ 1-on-1 video calls (WebRTC; uses whatever TURN the homeserver provides)
- ✅ Mobile-friendly UI (Tailwind, Material Symbols)

---

## Tech stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | Next.js 14 (App Router) + TypeScript |
| Styling     | Tailwind CSS                        |
| Matrix SDK  | matrix-js-sdk 33.x                  |
| Homeserver  | Matrix-compatible (tested on Synapse) |
| Deploy      | Docker + Traefik                    |

---

## Architecture

```
       ┌─────────────────┐
       │  User browser   │
       └────────┬────────┘
                │  HTTPS
                ▼
       ┌─────────────────┐
       │   Next.js app   │   ◄── this repo
       │ (matrix-js-sdk) │
       └────────┬────────┘
                │  Matrix Client-Server API
                ▼
       ┌─────────────────┐
       │  Matrix server  │   (Synapse — handles auth, rooms, media,
       │  (homeserver)   │    and hands out TURN credentials for calls)
       └─────────────────┘
```

For video calls, the homeserver must have a TURN server configured —
this repo just enables `fallbackICEServerAllowed` so the SDK trusts whatever
ICE/TURN servers Synapse hands it. See [Video calls (TURN)](#video-calls-turn--server-side-note).

---

## Prerequisites

Before you start, make sure you have:

- **Node.js 18+** and npm
- Access to a **Matrix homeserver** — either a public one (e.g. `matrix.org`)
  or your own [Synapse](https://element-hq.github.io/synapse/latest/setup/installation.html) instance
- (Optional, for production) Docker + Traefik reverse proxy
- (Optional, for video calls) A TURN server configured on the homeserver
  side — see the [TURN note](#video-calls-turn--server-side-note) below

> **Just want to try it out?** Point `NEXT_PUBLIC_MATRIX_URL` at any public
> Matrix homeserver (e.g. `https://matrix.org`) and log in with an existing
> account. Video calls and authenticated-media features only work fully with
> a homeserver you control.

---

## Quick start (local dev)

```bash
# 1. Clone
git clone https://github.com/<your-username>/chat-app.git
cd chat-app

# 2. Install dependencies
npm install

# 3. Create your local env file from the template
cp .env.example .env.local
#    Then edit .env.local — set NEXT_PUBLIC_MATRIX_URL etc.

# 4. Start the dev server
npm run dev
```

Open <http://localhost:3000> and log in with a Matrix account that lives on
the homeserver you configured.

> `npm run dev` binds to `0.0.0.0` so you can also open the dev server from a
> phone on the same network — handy for testing the mobile UI.

---

## Environment variables

All variables live in **`.env.local`** (which is **gitignored**). Start from
the documented template:

```bash
cp .env.example .env.local
```

| Variable                      | Required | Example                       | Purpose |
|-------------------------------|:--------:|-------------------------------|---------|
| `NEXT_PUBLIC_MATRIX_URL`      | ✅       | `https://matrix.example.com`  | Full URL of your Synapse server |
| `NEXT_PUBLIC_HOMESERVER_NAME` | ✅       | `matrix.example.com`          | Bare domain (used in user IDs `@user:domain`) |
| `CHAT_DOMAIN`                 | optional | `chat.example.com`            | Public domain for Docker/Traefik labels |

> `NEXT_PUBLIC_*` variables are **baked into the client bundle at build time**.
> Never put server-only secrets behind this prefix.

---

## Video calls (TURN) — server-side note

Video calls in this app use Matrix's standard WebRTC flow:

1. The browser asks Synapse for ICE/TURN servers (`/_matrix/client/v3/voip/turnServer`).
2. Synapse returns short-lived credentials for whatever TURN server *it* is configured with.
3. The browser uses those credentials to relay media if direct P2P fails.

The frontend opts into this by setting `fallbackICEServerAllowed: true` in
`src/lib/matrix.ts` — **that is the only TURN-related code in this repo**.
Everything else (the actual TURN server, the shared secret, the realm) is
configured on the **homeserver side**, not here.

If you self-host Synapse and want calls to work, follow the official guide:
<https://element-hq.github.io/synapse/latest/turn-howto.html>. If you use a
public homeserver (`matrix.org` etc.), calls just work — no extra setup.

---

## Docker / production deployment

A `Dockerfile` and `docker-compose.yml` are included. The compose file expects
a Traefik reverse proxy on an external `coolify` Docker network — adjust the
labels if your setup differs.

### Steps

1. Copy `.env.example` → `.env.local` and fill in production values
   (`NEXT_PUBLIC_MATRIX_URL`, `CHAT_DOMAIN`, …).
2. Copy `deploy.sh.example` → `deploy.sh` and fill in your server IP/domain.
3. Build and start:

   ```bash
   docker compose up -d --build
   ```

4. Check it's running:

   ```bash
   docker compose ps
   docker compose logs -f --tail=50
   ```

> `deploy.sh` is **gitignored** because it contains server-specific info
> (IPs, SSH targets). Always edit your own copy; never commit it.

---

## Project structure

```
chat-app/
├── public/                 # Static assets (favicon, images). Empty by default —
│                           #   drop your logo/icons here when you brand the app.
├── src/
│   ├── app/
│   │   ├── page.tsx        # Login page
│   │   ├── chat/page.tsx   # Main chat page (room list + window)
│   │   ├── layout.tsx      # Root layout
│   │   └── globals.css     # Tailwind + globals
│   ├── components/
│   │   ├── ChatList.tsx    # Sidebar with rooms
│   │   ├── ChatWindow.tsx  # Message thread + composer
│   │   └── VideoCall.tsx   # WebRTC call overlay
│   └── lib/
│       └── matrix.ts       # matrix-js-sdk singleton, auth, helpers
├── Dockerfile
├── docker-compose.yml
├── deploy.sh.example       # Template (the real deploy.sh is gitignored)
├── .env.example            # Template (the real .env.local is gitignored)
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

> **Why is `public/` empty?** Next.js serves any file you drop into `public/`
> at the site root (`public/favicon.ico` → `/favicon.ico`). This project
> doesn't ship custom static assets out of the box — add yours later.

---

## Troubleshooting

**Login fails with `M_LIMIT_EXCEEDED` / HTTP 429**
Synapse rate-limits repeated login attempts. Wait the suggested number of
seconds, or raise the limits in `homeserver.yaml` under `rc_login`.

**Video calls don't connect**
TURN is configured on the **homeserver**, not in this repo. Check that:
- Synapse's `/_matrix/client/v3/voip/turnServer` returns credentials (curl it).
- The TURN host returned by Synapse is reachable from clients.
- UDP/TCP **3478** (and TLS **5349** if used) are open on the TURN server.

**Images / files won't load**
If Synapse has `enable_authenticated_media: true`, clients must send the
access token with every media request. This project does that already — if
you're behind a CDN, make sure the `Authorization` header isn't stripped.

**`npm run dev` shows a blank page**
You probably forgot to set `NEXT_PUBLIC_MATRIX_URL`. Restart `npm run dev`
after editing `.env.local` — Next.js only reads env vars on startup.

---

## Security notes

Before pushing to a public GitHub repo, double-check that the following are
**not** tracked:

- `.env`, `.env.local` (and any `.env.*.local`) — contain server URLs/IPs
- `deploy.sh` — contains your VPS IP and SSH details
- `.claude/` — local Claude Code settings
- `node_modules/`, `.next/`, `tsconfig.tsbuildinfo` — build artifacts

The provided `.gitignore` already covers all of these. To verify nothing
sensitive is tracked:

```bash
git ls-files | grep -E "\.env|deploy\.sh|tsbuildinfo"
# Only .env.example and deploy.sh.example should appear.
```

If you accidentally committed a secret, **rotate it** (rotate the TURN
secret, re-issue tokens, etc.) and rewrite history with `git filter-repo`
before pushing.

---

## Roadmap

- [ ] End-to-end encryption (matrix-js-sdk olm)
- [ ] Group chats
- [ ] Message reactions
- [ ] PWA / offline support

---

## Contributing

Pull requests welcome. For larger changes, open an issue first to discuss
the direction.

---

## License

[MIT](LICENSE)

---

## Credits

- [matrix.org](https://matrix.org) — open federated communication protocol
- [element-hq/matrix-js-sdk](https://github.com/element-hq/matrix-js-sdk) — Matrix client SDK
