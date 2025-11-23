# F1 Auto-Cache Worker

A production-ready Cloudflare Worker that provides cached F1 standings data using the Jolpi/Ergast API mirror.

Quick start: After deployment, visit your Worker's base URL (e.g. https://f1-autocache.djsmanchanda.workers.dev/) to see an interactive API documentation page listing endpoints and sample outputs.

## Features

- **Dynamic Discovery**: No hard-coded race lists - discovers the season dynamically
- **Cumulative Points**: Computes Sprint + Race points per round
- **Auto-Updates**: Runs hourly via cron, updates when events are ≥6 hours past scheduled time
- **KV Caching**: Persists ready-to-serve CSV and JSON in Cloudflare KV
- **Read-Only Endpoints**: Website never calls external APIs directly
- **Year Support**: Supports `?year=YYYY` parameter (default: current year)

## Deployment

### 1. Install Dependencies
```bash
cd f1-autocache
npm install
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Create KV Namespace
```bash
wrangler kv:namespace create F1_KV
```

Copy the namespace ID from the output and update `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "F1_KV"
id = "your-namespace-id-here"  # Replace with actual ID
```

### 4. Set API Token (Optional)
To protect the manual update endpoint:
```bash
wrangler secret put API_TOKEN
```
Enter a secure token when prompted.

### 5. Deploy
```bash
wrangler deploy
```

## API Endpoints

### GET `/api/f1/standings.csv[?year=YYYY]`
Returns CSV format standings with dynamic round columns.

**Example Response:**
```csv
Driver Number,Driver Name,Australian Grand Prix,Chinese Grand Prix,Final Points
1,Max Verstappen,25,43,43
63,George Russell,18,36,36
```

### GET `/api/f1/standings.json[?year=YYYY]`
Returns JSON format standings.

**Example Response:**
```json
[
  {
    "Driver Number": "1",
    "Driver Name": "Max Verstappen",
    "Australian Grand Prix": 25,
    "Chinese Grand Prix": 43,
    "Final Points": 43
  }
]
```

### GET `/api/f1/meta[?year=YYYY]`
Returns metadata about the season.

**Example Response:**
```json
{
  "year": 2025,
  "lastUpdated": "2025-10-02T10:00:00.000Z",
  "roundsCompleted": 18,
  "roundsTotal": 24,
  "rounds": [
    {
      "round": 1,
      "raceName": "Australian Grand Prix",
      "status": "completed",
      "dateTimeUTC": "2025-03-16T05:00:00.000Z"
    }
  ]
}
```

### GET `/api/f1/race-positions.json[?year=YYYY]`
Returns every driver's classified finishing result per completed race round.

**Example Response:**
```json
{
  "year": 2025,
  "rounds": [
    { "index": 1, "round": 1, "raceName": "Australian Grand Prix" }
  ],
  "rows": [
    {
      "Driver Number": "1",
      "Driver Name": "Max Verstappen",
      "Race 1": "1"
    },
    {
      "Driver Number": "44",
      "Driver Name": "Lewis Hamilton",
      "Race 1": "DNF"
    }
  ]
}
```

### GET `/api/f1/position-tally.json[?year=YYYY]`
Returns cumulative counts of each finishing position (1st–22nd) plus DNS/DNF/DSQ buckets per driver.

**Example Response:**
```json
{
  "year": 2025,
  "rows": [
    {
      "Driver Number": "1",
      "Driver Name": "Max Verstappen",
      "1st": 5,
      "2nd": 2,
      "DNS": 0,
      "DNF": 1,
      "DSQ": 0
    }
  ]
}
```

### POST `/api/f1/update[?year=YYYY]`
Manually triggers data update. Requires Bearer token if `API_TOKEN` is set.

```bash
curl -X POST "https://f1-autocache.djsmanchanda.workers.dev/api/f1/update" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Data Sources

- **Calendar & Results**: [Jolpi/Ergast API](https://api.jolpi.ca/ergast/f1/)
- **Race Calendar**: `GET /{year}/races/`
- **Race Results**: `GET /{year}/{round}/results/`
- **Sprint Results**: `GET /{year}/{round}/sprint/`
- **Drivers**: `GET /{year}/drivers/`

## Behavior

- **Completed Rounds**: A round is eligible for update when the main race time + 6 hours has passed
- **Points Aggregation**: For each round, combines Sprint points + Race points per driver
- **Auto-Updates**: Hourly cron checks for newly completed rounds and updates KV storage
- **Error Handling**: Upstream failures don't overwrite existing KV data

## Headers

All GET endpoints include:
- `Cache-Control: public, max-age=300` (5-minute browser cache)
- `Access-Control-Allow-Origin: *` (Open CORS)

## Integration

Replace your existing API calls with:

```javascript
// CSV
const csvResponse = await fetch("https://f1-autocache.djsmanchanda.workers.dev/api/f1/standings.csv");
const csvData = await csvResponse.text();

// JSON
const jsonResponse = await fetch("https://f1-autocache.djsmanchanda.workers.dev/api/f1/standings.json");
const standings = await jsonResponse.json();

// Metadata
const metaResponse = await fetch("https://f1-autocache.djsmanchanda.workers.dev/api/f1/meta");
const metadata = await metaResponse.json();
```

## Monitoring

Check the Worker's logs in the Cloudflare dashboard for:
- Cron execution logs
- API fetch errors
- KV operation status
- Update triggers

Your website will never call Jolpi directly - only this cached Worker!