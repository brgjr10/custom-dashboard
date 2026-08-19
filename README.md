# Home Dashboard

A customizable home server dashboard with modular widgets. Dark theme, config-driven, easy to extend.

## Setup

```bash
npm install
npm start
```

Open http://localhost:4000

## Features

- **Add/Remove Widgets** - Click "Add Widget" to add new widgets, or use Edit mode to remove them
- **System Stats** - CPU usage, memory, temperature, uptime
- **Storage** - Disk usage per mount point
- **Docker Health** - Container status and state
- **GitHub Activity** - Track activity across your entire GitHub account or a single repo
- **Internet Speed** - Download speed test
- **Uptime Kuma** - Embedded status page
- **Quick Links** - Easy shortcuts grid

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
GitHub's GraphQL API rate-limits unauthenticated requests. To avoid this, set a `GITHUB_TOKEN` environment variable with a personal access token:

```bash
docker compose down
GITHUB_TOKEN=ghp_xxxx docker compose up -d --build
```

Or add it to `docker-compose.yml`:
```yaml
services:
  dashboard:
    build: .
    container_name: custom-dashboard
    restart: unless-stopped
    ports:
      - "4000:4000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - NODE_ENV=production
      - GITHUB_TOKEN=ghp_xxxx
```

### Adding an Uptime Kuma Widget

Click "Add Widget" → "Uptime Kuma", or add to config:

```json
{
  "type": "uptimekuma",
  "url": "http://192.168.4.90:3001/status/connection"
}
```

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
| `/api/speedtest` | Download speed test |
| `/api/github/activity` | GitHub account events (no repo) or repo events (with repo) |
| `/api/github/contributions` | GitHub contribution calendar for chart widget |
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
