# Home Dashboard

A customizable home server dashboard with modular widgets. Dark theme, config-driven, easy to extend.

<img width="1191" height="927" alt="image" src="https://github.com/user-attachments/assets/957697be-affc-4882-bf2c-0afd0ccc6752" />

## Setup

```bash
npm install
npm start
```

Open http://localhost:4000

## Docker

```bash
cp .env.example .env
# Edit .env and set GITHUB_TOKEN=your_actual_token
docker compose up -d --build
```

The container reads `GITHUB_TOKEN` from `.env`. Do not hardcode secrets in `docker-compose.yml`.

## Features

- **Add/Remove Widgets** - Click "Add Widget" to add new widgets, or use Edit mode to remove them
- **System Stats** - CPU usage, memory, temperature, uptime
- **Storage** - Disk usage per mount point
- **Docker Health** - Container status and resource usage (CPU, memory, network)
- **GitHub Activity** - Track activity across your entire GitHub account or a single repo
- **Internet Speed** - Download speed test
- **Quick Links** - Easy shortcuts grid
- **Weather** - Local weather by city/state (Open-Meteo)
- **Network** - Network interfaces and IPs
- **Themes** - Multiple color themes with persistent preference
- **Unit Toggle** - Switch between Celsius and Fahrenheit

## Configuration

### Adding Links

Click the gear icon on the Links widget, or edit `public/data/widgets.json`:

```json
{
  "type": "links",
  "links": [
    { "label": "Uptime Kuma", "url": "http://192.168.4.90:3001/status/connection", "icon": "📈" },
    { "label": "Portainer", "url": "http://localhost:9000", "icon": "🐳" }
  ]
}
```

### Adding a GitHub Widget

Click "Add Widget" → "GitHub Activity", or add to config:

**Track entire account** (recommended for activity overview):
```json
{
  "type": "github",
  "user": "your-username"
}
```

**Track a specific repo**:
```json
{
  "type": "github",
  "user": "your-username",
  "repo": "your-repo"
}
```

In account-wide mode, the widget shows a green contribution chart similar to GitHub's profile graph.

**Avoiding rate limits:**
GitHub's GraphQL API rate-limits unauthenticated requests. To avoid this, set a `GITHUB_TOKEN` environment variable in `.env` with a personal access token:

```bash
GITHUB_TOKEN=ghp_xxxx
```

### Adding a Weather Widget

Click "Add Widget" → "Weather", or add to config:

```json
{
  "type": "weather",
  "city": "Bend",
  "state": "Oregon"
}
```

Click the gear icon on the widget to change city/state.

### Adding a Custom Widget

Click "Add Widget" → "Custom HTML", or add to config:

```json
{
  "type": "custom",
  "url": "http://example.com"
}
```

## Architecture

- `server.js` - Express backend with local system APIs
- `public/index.html` - Main dashboard page
- `public/css/dashboard.css` - Dark theme styles
- `public/js/config.js` - Widget configuration system
- `public/js/widgets.js` - Widget implementations
- `public/js/app.js` - Dashboard app logic
- `public/data/widgets.json` - Persistent widget configuration

## Widget System

Each widget is a class extending `Widget` with:
- `fetchData()` - Fetch data from API
- `format(data)` - Render HTML from data
- `render()` - Create DOM element

Add new widgets by:
1. Creating a class in `widgets.js`
2. Registering it in `WIDGET_CLASSES`
3. Adding a config entry in `widgets.json`

## APIs

| Endpoint | Description |
|----------|-------------|
| `/api/system` | CPU, memory, temp, disks, uptime |
| `/api/docker` | Container list and status |
| `/api/docker/:id/stats` | Per-container CPU/memory/network stats |
| `/api/speedtest` | Download speed test |
| `/api/github/activity` | GitHub account events (no repo) or repo events (with repo) |
| `/api/github/contributions` | GitHub contribution calendar for chart widget |
| `/api/weather` | Current weather by city/state or lat/lon |
| `/api/network` | Network interfaces and IPs |
| `/api/health` | Server health check |

## Styling

Dark theme with the following palette:
- Background: `#0d1117`
- Cards: `#161b22`
- Borders: `#30363d`
- Primary blue: `#58a6ff`
- Success: `#3fb950`
- Warning: `#d29922`
- Danger: `#f85149`
