# Matrix Chat App

A mobile-first, real-time chat application built on the Matrix protocol with Next.js and Synapse.

## Screenshots

<!-- ## Screenshots
![Chat list](docs/screenshot-list.png)
![Chat window](docs/screenshot-chat.png)
-->

## Features

- ✅ Text messages
- ✅ Audio (voice) messages with waveform
- ✅ Image messages with preview
- ✅ File sharing
- ✅ Location sharing
- ✅ Reply to messages
- ✅ Edit messages
- ✅ Delete messages
- ✅ Typing indicator
- ✅ Online presence indicator
- ✅ Read receipts
- ✅ Push notifications (Web Notifications API)
- ✅ Authenticated media download
- ✅ Auto-join on invite
- ✅ Video calls 

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | Next.js 14 (App Router), TypeScript |
| Styling     | Tailwind CSS                        |
| Matrix SDK  | matrix-js-sdk 33.x                  |
| Homeserver  | Synapse                             |
| TURN server | coturn                              |

## Architecture

```
User Browser
    │
    ▼
Next.js Frontend  ──────►  Synapse Homeserver
(matrix-js-sdk)                    │
                                   ▼
                             coturn (TURN)
                         (WebRTC relay for calls)
```

## Prerequisites

- [Synapse](https://matrix-org.github.io/synapse/latest/setup/installation.html) homeserver (self-hosted)
- [coturn](https://github.com/coturn/coturn) TURN server (for video calls)
- Node.js 18+

## Installation

```bash
# 1. Clone
git clone https://github.com/your-username/chat-app.git
cd chat-app

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local with your values

# 4. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Server Setup

### Synapse (`homeserver.yaml`)

```yaml
# Disable authenticated media if clients need unauthenticated access
enable_authenticated_media: false

# TURN server configuration
turn_uris:
  - "turn:YOUR_TURN_HOST:3478?transport=udp"
  - "turn:YOUR_TURN_HOST:3478?transport=tcp"
turn_shared_secret: "YOUR_TURN_SECRET"
turn_user_lifetime: 86400000
turn_allow_guests: false
```

### coturn (`turnserver.conf`)

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET
realm=your-domain.com
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
no-multicast-peers
```

## Project Structure

```
src/
├── app/
│   ├── page.tsx          # Login page
│   ├── chat/
│   │   └── page.tsx      # Main chat page (room list + chat window)
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles + Tailwind
├── components/
│   ├── ChatList.tsx      # Room list sidebar
│   ├── ChatWindow.tsx    # Message thread + input bar
│   └── VideoCall.tsx     # WebRTC video call overlay
└── lib/
    └── matrix.ts         # Matrix SDK singleton, auth, messaging helpers
```

## Configuration

| Variable                     | Required | Description                                  |
|------------------------------|----------|----------------------------------------------|
| `NEXT_PUBLIC_MATRIX_URL`     | Yes      | Full URL of your Synapse homeserver          |
| `NEXT_PUBLIC_HOMESERVER_NAME`| Yes      | Domain part of the homeserver (e.g. `matrix.example.com`) |
| `NEXT_PUBLIC_TURN_HOST`      | No       | IP or domain of your coturn server           |
| `CHAT_DOMAIN`                | No       | Public domain for Docker/Traefik deployment  |

## Docker Deployment

A `Dockerfile` and `docker-compose.yml` are included for production deployment behind Traefik.

```bash
# Copy and fill in your values
cp .env.example .env.local

# Build and start
docker compose up -d --build
```

The compose file assumes a Traefik reverse proxy with a `coolify` Docker network. Adjust labels in `docker-compose.yml` for your setup.

## Roadmap

- [ ] Video calls — stable WebRTC (in progress)
- [ ] End-to-end encryption (matrix-js-sdk olm)
- [ ] Group chats
- [ ] Message reactions

## Contributing

Pull requests are welcome. Open an issue first for major changes.

## License

[MIT](LICENSE)

## Credits

- [matrix.org](https://matrix.org) — open federated communication protocol
- [element-hq](https://github.com/element-hq) — matrix-js-sdk
