# Custom Dashboard

A configurable, real-time home server dashboard with modular widgets, drag-and-drop layout, and 12 built-in themes. Built for reliability, readability, and speed.

<img width="1191" height="927" alt="Dashboard" src="https://github.com/user-attachments/assets/957697be-affc-4882-bf2c-0afd0ccc6752" />
<img width="814" height="1079" alt="Dashboard mobile" src="https://github.com/user-attachments/assets/31603cd8-f20a-4a44-9e15-87893399ea11" />

## Why it exists

Most home dashboards either lock you into a single layout or require a complex YAML config. This one is different: widgets are first-class citizens, the layout is persisted in the browser, and every integration is a self-contained class. It works out of the box with Docker, but it’s also easy to run locally and extend.

## Features

- **Modular widgets** — System stats, Docker health, network info, speed test, weather, GitHub activity, quick links, custom HTML
- **Drag & drop layout** — CSS Grid with resize handles, export/import as JSON
- **12 themes** — Dark, Light, Ocean, Forest, Sunset, Purple, High Contrast, Midnight, Rose, Slate, Amber, Neon
- **Unit toggle** — °C / °F with persistent preference
- **Global refresh rate** — 5s, 15s, 30s, 1m, 5m, or off
- **Optional auth** — Basic HTTP auth via `AUTH_USER` / `AUTH_PASS` env vars
- **Smart caching** — In-memory TTL cache for GitHub, weather, and geocode to protect against rate limits
- **Responsive** — Works on desktop, tablet, and mobile with touch-friendly controls
- **Docker ready** — Host networking, privileged mode for Docker socket access, secrets via `.env`

## Quick start

### Docker (recommended)

```bash
cp .env.example .env
# add GITHUB_TOKEN, AUTH_USER, AUTH_PASS
docker compose up -d --build
```

Open `http://<host>:4000`

### Local

```bash
npm install
npm run dev
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser   │────▶│  server.js   │────▶│  Local APIs  │
│  widgets.js │◀────│  Express API │◀────│  /sys, /dock │
│  config.js  │     │  Static files│     └──────────────┘
└─────────────┘     └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  External   │
                    │  APIs       │
                    │  GitHub,    │
                    │  Open-Meteo │
                    └─────────────┘
```

- **server.js** — Express backend, serves static assets, owns routing, caching, and auth
- **public/js/config.js** — Widget configuration, localStorage persistence, theme/unit management
- **public/js/widgets.js** — Widget classes extending a shared `Widget` base
- **public/js/app.js** — Dashboard initialization, grid layout, event handlers, modal system
- **public/data/widgets.json** — Default widget configuration

## Widget system

Each widget extends `Widget` with three methods:

- `fetchData()` — calls an Express API endpoint and returns normalized data
- `format(data)` — renders an HTML string for the widget body
- `render()` — creates the DOM element with header, content, footer, and resize handle

To add a widget:
1. Create a class in `public/js/widgets.js`
2. Register it in `WIDGET_CLASSES`
3. Add a config entry in `public/data/widgets.json`

## APIs

| Endpoint | Description |
|----------|-------------|
| `/api/system` | CPU, memory, temperature, disks, uptime |
| `/api/docker` | Container list and status |
| `/api/docker/:id/stats` | Per-container CPU, memory, network |
| `/api/network` | Network interfaces and IPs |
| `/api/weather` | Current weather by city/state or lat/lon |
| `/api/geocode` | Resolve city/state to coordinates |
| `/api/github/activity` | GitHub events for a user or repo |
| `/api/github/contributions` | GitHub contribution calendar |
| `/api/speedtest` | Download speed test |
| `/api/health` | Server health check |

## Configuration

Widgets are configured via the UI (gear icon) or by editing `public/data/widgets.json`:

```json
{
  "type": "github",
  "user": "brgjr10",
  "refreshInterval": 30000
}
```

Global settings (theme, unit, refresh rate) persist in `localStorage`.

## Security

- Secrets are injected via `.env` — never hardcode tokens in `docker-compose.yml`
- Optional basic HTTP auth protects the API surface on shared networks
- `.env` is gitignored; `.env.example` documents required variables

## Theme showcase

All 12 themes rendered side-by-side: [`public/showcase.html`](/showcase.html)

## Tech stack

- Node.js + Express
- Vanilla JavaScript with ES modules
- CSS Grid + CSS custom properties for theming
- Docker with host networking

## License

MIT
