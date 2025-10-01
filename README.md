# F1 2025 Championship Simulator

A web-based Formula 1 championship simulator that lets you predict race outcomes and see how they affect the championship standings.

## Features

- 🏎️ **Real-time Data**: Fetches actual F1 2025 race results from OpenF1 API
- 💾 **Smart Caching**: Server-side caching that only refreshes when new races complete
- 🎯 **Scenario Planning**: Set constraints like driver positions or relative finishing orders
- 📊 **Monte Carlo Simulation**: Run 1000+ simulations to calculate championship probabilities
- 🎨 **Clean UI**: Modern, responsive design optimized for all devices
- ⚡ **Client-side Simulation**: All heavy computation happens in the browser

## Tech Stack

- **Frontend**: Vanilla JavaScript (no frameworks needed)
- **Backend**: Cloudflare Pages Functions (serverless)
- **Caching**: Cloudflare KV (optional but recommended)
- **APIs**: OpenF1 API, Ergast F1 API

## Deployment

### Deploy to Cloudflare Pages

1. **Connect to GitHub**:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Navigate to Pages → Create a project
   - Connect your GitHub repository

2. **Build Settings**:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: `public`

3. **Optional: Set up KV for Caching**:
   ```bash
   # Create KV namespace
   wrangler kv:namespace create "F1_CACHE"
   
   # Bind it in your Pages project settings
   # Or uncomment the KV section in wrangler.toml
   ```

4. **Deploy**: Push to your main branch or click "Deploy" in Cloudflare

### Local Development

```bash
# Install Wrangler CLI (Cloudflare's dev tool)
npm install -g wrangler

# Run local development server
wrangler pages dev public

# Access at http://localhost:8788
```

## How It Works

### Data Caching Strategy

The API function (`/api/data`) implements smart caching:

1. Checks if cached data exists
2. Compares cached timestamp with race calendar
3. Only fetches fresh data if a new race has occurred
4. Returns cached data for all other requests

This means:
- ⚡ Lightning-fast load times for users
- 💰 Minimal API calls (respects rate limits)
- 🔄 Always up-to-date after races complete

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
├── public/
│   ├── index.html          # Main HTML file
│   ├── styles.css          # All styling
│   └── app.js              # Client-side logic & simulation
├── functions/
│   └── api/
│       └── data.js         # Serverless API with caching
├── wrangler.toml           # Cloudflare configuration
└── README.md
```

## Future Enhancements

- [ ] Add driver/team profile images
- [ ] Animated GIFs for likely winners
- [ ] Historical comparison charts
- [ ] Share simulation results via URL
- [ ] Constructor championship simulation
- [ ] Mobile app (PWA)

## API Usage

The app uses two public F1 APIs:

- **OpenF1 API**: Race sessions and results
- **Ergast API**: Driver information

Both are free and don't require authentication.

## License

MIT License - feel free to use and modify!

## Credits

Built for F1 fans by F1 fans 🏁
Data provided by OpenF1 and Ergast APIs
