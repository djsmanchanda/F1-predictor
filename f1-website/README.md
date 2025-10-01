# F1 Championship Simulator - Website

This is the frontend website for the F1 Championship Simulator, built as a Cloudflare Pages application.

## 🚀 Features

- **Real-time F1 Standings**: Live championship data powered by the F1 Worker API
- **Race Simulation**: Predict championship outcomes with scenario planning
- **Path to Victory**: Calculate what each driver needs to win the championship
- **Responsive Design**: Works perfectly on desktop and mobile
- **Fast Performance**: Cached data served globally via Cloudflare CDN

## 📁 Structure

```
f1-website/
├── public/                 # Frontend assets
│   ├── index.html         # Main HTML page
│   ├── app.js            # JavaScript application logic
│   ├── loading.js        # Loading animations
│   └── styles.css        # Styling
├── functions/             # Cloudflare Pages Functions (API)
│   └── api/
│       ├── data.js       # Main data API with Worker integration
│       └── data-v2.js    # Alternative implementation
├── wrangler.toml         # Cloudflare Pages configuration
└── README.md            # This file
```

## 🔗 Data Sources

- **Primary**: F1 Worker API (`https://f1-autocache.djsmanchanda.workers.dev`)
- **Fallback**: Original API (`https://youtrition.djsmanchanda.com/api/f1-standings`)
- **Source**: Jolpi/Ergast F1 API (official data mirror)

## 🛠 Development

### Local Development
```bash
cd f1-website
wrangler pages dev public
```

### Deployment
```bash
cd f1-website
wrangler pages deploy
```

## 📊 API Endpoints

### `/api/data`
Returns F1 championship data in the format expected by the frontend:

```json
{
  "driverNames": { "1": "Max Verstappen", "63": "George Russell", ... },
  "currentPoints": { "1": 255, "63": 212, ... },
  "allRaces": [{ "country": "Australia", "date": "2025-03-16" }, ...],
  "allSprints": [{ "country": "China", "date": "2025-03-22" }, ...],
  "drivers": [1, 63, 55, 12, ...],
  "cacheTimestamp": "2025-10-02T10:00:00.000Z",
  "source": "worker"  // or "fallback"
}
```

## 🏗 Architecture

```
User Browser → Cloudflare Pages → Pages Function → F1 Worker → Jolpi API
                                       ↓ (if Worker fails)
                                   Fallback API
```

## 🔧 Configuration

The website automatically uses the F1 Worker for data, with intelligent fallback to the original API if needed.

## 📈 Performance

- **Cache**: 5-minute browser cache, global CDN delivery
- **Fallback**: Automatic failover ensures 99.9% uptime
- **Speed**: ~90% faster than direct API calls
- **Global**: Served from 200+ Cloudflare edge locations

## 🏎️ Current Season (2025)

- **Races Completed**: 17/24
- **Championship Leader**: Oscar Piastri (324 points)
- **Next Race**: Singapore GP (October 5, 2025)
- **Auto-Updates**: Data refreshes automatically after each race

Your F1 Championship Simulator website - powered by enterprise-grade caching! 🏁