# F1 Simulator (f1-simulate)

Modern, dark F1 championship simulator with:

- Leaderboard with Δ vs leader and previous
- Scenario editor (Set Position, A Above B)
- Simulation engine (Standard/Realistic)
- Points graph (top-5)

Styling uses Tailwind with CSS variables for a sleek dark theme.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm run preview
```

## Assets

Driver number images are expected at:

- `public/driver_numberS/{number}.png`

If an image is missing, the avatar hides gracefully.

## Notes

- Local data loads from `/api/data` served by the worker, which fetches your upstream standings API.
- If the worker route is unavailable during dev, the client will fetch the upstream worker directly.
