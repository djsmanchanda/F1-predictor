# F1 Data & Simulation Suite

A comprehensive Formula 1 data suite featuring a production-ready caching Worker and web-based championship simulator.

## Projects

### 🏎️ F1 AutoCache Worker (`f1-autocache/`)
Production-ready Cloudflare Worker that provides real-time F1 championship data:
- **Real-time Data**: Fetches from Jolpi/Ergast F1 API with hourly updates
- **Smart Caching**: KV storage with 6-hour post-race intelligence
- **Multiple Formats**: JSON and CSV endpoints for flexibility
- **Auto-Discovery**: Dynamically detects new races and updates standings
- **Cron Scheduling**: Automated updates every hour

### 🎯 F1 Championship Simulator (`f1-website/`)
Interactive web-based championship simulator:
- **Scenario Planning**: Set constraints like driver positions or relative finishing orders
- **Monte Carlo Simulation**: Run 1000+ simulations to calculate championship probabilities
- **Clean UI**: Modern, responsive design optimized for all devices
- **Client-side Simulation**: All heavy computation happens in the browser

## Tech Stack

- **Workers**: Cloudflare Workers with ES modules
- **Frontend**: Vanilla JavaScript (no frameworks needed)
- **Backend**: Cloudflare Pages Functions (serverless)
- **Caching**: Cloudflare KV storage
- **APIs**: Jolpi/Ergast F1 API

## Quick Start

### F1 AutoCache Worker
```bash
# Deploy the Worker
cd f1-autocache
wrangler deploy

# Create KV namespace (one-time setup)
wrangler kv namespace create "F1_CACHE" --preview false

# Update wrangler.toml with the namespace ID, then redeploy
wrangler deploy
```

### F1 Website
```bash
# Deploy to Cloudflare Pages
cd f1-website

# Connect to GitHub via Cloudflare Dashboard
# Or deploy directly:
wrangler pages deploy public
```

## Deployment

### F1 AutoCache Worker

1. **Set up Worker**:
   ```bash
   cd f1-autocache
   wrangler deploy
   ```

2. **Create KV Storage**:
   ```bash
   wrangler kv namespace create "F1_CACHE" --preview false
   # Copy the namespace ID to wrangler.toml
   wrangler deploy  # Redeploy with KV binding
   ```

3. **Verify Deployment**:
   - JSON: `https://f1-autocache.yourworker.workers.dev/json`
   - CSV: `https://f1-autocache.yourworker.workers.dev/csv`

### F1 Website

1. **Connect to GitHub**:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Navigate to Pages → Create a project
   - Connect your GitHub repository

2. **Build Settings**:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: `f1-website/public`

3. **Deploy**: Push to your main branch or click "Deploy" in Cloudflare

### Local Development

#### F1 AutoCache Worker
```bash
cd f1-autocache
wrangler dev

# Test locally at http://localhost:8787
# JSON: http://localhost:8787/json
# CSV: http://localhost:8787/csv
```

#### F1 Website
```bash
cd f1-website
wrangler pages dev public

# Access at http://localhost:8788
```

## How It Works

### F1 AutoCache Worker

The Worker implements intelligent F1 data caching:

1. **Dynamic Race Discovery**: Automatically detects new races from Jolpi/Ergast API
2. **Smart Updates**: Runs hourly with 6-hour post-race intelligence for fresh data
3. **Points Calculation**: Computes cumulative championship points (Sprint + Race)
4. **Multi-format Output**: Serves data as JSON and CSV for different use cases
5. **KV Persistence**: Stores processed data in Cloudflare KV for instant delivery

### F1 Website Data Strategy

The website API (`f1-website/functions/api/data.js`) implements fallback protection:

1. **Primary Source**: Uses the F1 AutoCache Worker for latest data
2. **Fallback Protection**: Falls back to original API if Worker is unavailable
3. **Data Transformation**: Converts Worker format to website-compatible format
4. **Error Handling**: Graceful degradation ensures the site always works

### Simulation Algorithm

1. Uses actual current points from completed races
2. For each remaining race/sprint:
   - Generates random finishing orders
   - Applies user-defined constraints
   - Adds performance bias for top 5 drivers
3. Runs 1000 iterations
4. Calculates win probability for each driver

## Project Structure

```
.
├── f1-autocache/                    # F1 Data Caching Worker
│   ├── worker.mjs                   # Main Worker script
│   ├── wrangler.toml               # Worker configuration
│   └── README.md                   # Worker documentation
├── f1-website/                     # F1 Championship Simulator
│   ├── public/
│   │   ├── index.html              # Main HTML file
│   │   ├── styles.css              # All styling
│   │   ├── app.js                  # Client-side logic & simulation
│   │   └── loading.js              # Loading animations
│   ├── functions/
│   │   └── api/
│   │       └── data.js             # API with Worker integration
│   ├── wrangler.toml               # Pages configuration
│   └── README.md                   # Website documentation
├── testing/                        # Development & testing files
└── README.md                       # This file
```

## API Endpoints

### F1 AutoCache Worker
- **JSON**: `https://f1-autocache.yourworker.workers.dev/json`
- **CSV**: `https://f1-autocache.yourworker.workers.dev/csv`
- **Metadata**: `https://f1-autocache.yourworker.workers.dev/metadata`

### F1 Website
- **API**: `/api/data` (integrates with Worker + fallback protection)

## Data Sources

The F1 AutoCache Worker uses:
- **Jolpi/Ergast F1 API**: Primary data source for race results and standings

## Future Enhancements

### F1 AutoCache Worker
- [ ] Constructor championship data
- [ ] Driver/team metadata caching
- [ ] Historical season comparisons
- [ ] Additional output formats (XML, GraphQL)

### F1 Website
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
