# F1 Data & Simulation Suite

A comprehensive Formula 1 data suite featuring a production-ready caching Worker and a modern React/Vite championship simulator.

## Projects

### 🏎️ F1 AutoCache Worker (`f1-autocache/`)
Production-ready Cloudflare Worker that provides real-time F1 championship data:
- **Real-time Data**: Fetches from Jolpi/Ergast F1 API with hourly updates
- **Smart Caching**: KV storage with 6-hour post-race intelligence
- **Multiple Formats**: JSON and CSV endpoints for flexibility
- **Auto-Discovery**: Dynamically detects new races and updates standings
- **Cron Scheduling**: Automated updates every hour

### 🎯 F1 Championship Simulator (`f1-simulate/`)
React 19 + Vite application deployed behind a Cloudflare Worker:
- **Interactive Scenarios**: Configure driver positions, ordering locks, and probability models
- **Simulation Modes**: Choose between standard and realistic Monte Carlo engines
- **Tailwind UI**: Dark theme with leaderboards, deltas, and progression charts
- **Worker-backed API**: Uses the AutoCache Worker locally and in production with graceful fallbacks

### 🗂️ Legacy Pages Site (`f1-website/`)
Original vanilla JS simulator retained for historical reference. It is no longer updated.

## Tech Stack

- **Workers**: Cloudflare Workers with ES modules and Wrangler
- **Frontend**: React 19, Vite 7, Tailwind CSS
- **Tooling**: TypeScript, ESLint, Cloudflare Vite plugin
- **Caching**: Cloudflare KV storage via the AutoCache Worker
- **APIs**: Jolpi/Ergast F1 API consumed through the Worker layer

## Quick Start

### F1 AutoCache Worker
```bash
cd f1-autocache
wrangler deploy

# Create KV namespace (one-time setup)
wrangler kv namespace create "F1_CACHE" --preview false

# Update wrangler.toml with the namespace ID, then redeploy
wrangler deploy
```

### F1 Simulator
```bash
cd f1-simulate
npm install
npm run dev
```

## Deployment

### F1 AutoCache Worker
1. **Deploy Worker**:
   ```bash
   cd f1-autocache
   wrangler deploy
   ```
2. **Provision KV Storage**:
   ```bash
   wrangler kv namespace create "F1_CACHE" --preview false
   # Copy the namespace ID to wrangler.toml
   wrangler deploy
   ```
3. **Verify Endpoints**:
   - JSON: `https://f1-autocache.yourworker.workers.dev/json`
   - CSV: `https://f1-autocache.yourworker.workers.dev/csv`

### F1 Simulator (React/Vite Worker)
1. **Install Dependencies**:
   ```bash
   cd f1-simulate
   npm install
   ```
2. **Review `wrangler.jsonc`** if you need custom bindings, environments, or asset settings.
3. **Deploy**:
   ```bash
   npm run deploy
   ```
4. **Preview Build Locally**:
   ```bash
   npm run preview
   ```

### Legacy Pages Site
`f1-website/` is archived. Deployments should target `f1-simulate/` instead.

## Local Development

#### F1 AutoCache Worker
```bash
cd f1-autocache
wrangler dev

# JSON: http://localhost:8787/json
# CSV: http://localhost:8787/csv
```

#### F1 Simulator
```bash
cd f1-simulate
npm install
npm run dev

# App: http://localhost:5173
# Worker preview (static build): npm run preview
```

## How It Works

### F1 AutoCache Worker
1. **Dynamic Race Discovery** automatically detects new events from Jolpi/Ergast.
2. **Smart Update Cadence** runs hourly with 6-hour post-race refresh windows.
3. **Points Aggregation** combines sprint and race points for championship totals.
4. **Multi-format Output** serves JSON and CSV for downstream consumers.
5. **KV Persistence** keeps recent data optimized for instant delivery.

### F1 Simulator Data Strategy
1. **Primary Source** pulls from the AutoCache Worker for low-latency standings.
2. **Resilient Fallback** hits the upstream API if the Worker is unavailable.
3. **Transformation Layer** reshapes Worker data into UI-friendly objects.
4. **Defensive Error Handling** ensures the UI remains responsive even during outages.

### Simulation Algorithm
1. **Baseline Points** start from the latest standings via AutoCache.
2. **Race Iteration** simulates remaining races/sprints with scenario constraints.
3. **Probability Models** apply realistic bias curves for top competitors.
4. **Monte Carlo Engine** executes 1000+ runs per mode.
5. **Result Aggregation** computes win probabilities and renders progression charts.

## Project Structure

```
.
├── f1-autocache/                    # F1 data caching Worker
│   ├── worker.mjs                   # Main Worker script
│   ├── wrangler.toml                # Worker configuration
│   └── README.md                    # Worker documentation
├── f1-simulate/                     # React/Vite championship simulator
│   ├── src/                         # UI components, hooks, utilities
│   ├── worker/                      # Cloudflare Worker entry point
│   ├── public/                      # Static assets (driver numbers, etc.)
│   ├── wrangler.jsonc               # Worker deployment config
│   └── README.md                    # Simulator documentation
├── f1-website/                      # Legacy vanilla JS simulator (archived)
└── README.md                        # This file
```

## API Endpoints

### F1 AutoCache Worker
- **JSON**: `https://f1-autocache.yourworker.workers.dev/json`
- **CSV**: `https://f1-autocache.yourworker.workers.dev/csv`
- **Metadata**: `https://f1-autocache.yourworker.workers.dev/metadata`

### F1 Simulator
- **Worker API**: `/api/data` (integrates with AutoCache + fallback protection)

## Data Sources
- **Jolpi/Ergast F1 API**: Primary race results and standings feed consumed by the Worker

## Future Enhancements

### F1 AutoCache Worker
- [ ] Constructor championship data
- [ ] Driver/team metadata caching
- [ ] Historical season comparisons
- [ ] Additional output formats (XML, GraphQL)

### F1 Simulator
- [ ] Add driver/team profile images
- [ ] Animated GIFs for likely winners
- [ ] Historical comparison charts
- [ ] Share simulation results via URL
- [ ] Constructor championship simulation
- [ ] Mobile app (PWA)

## License

MIT License - feel free to use and modify!

## Credits

Built for F1 fans by F1 fans 🏁
Data provided by Jolpi/Ergast F1 API
