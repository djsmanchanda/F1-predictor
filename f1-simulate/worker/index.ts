export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      try {
        const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
        const base = "https://f1-autocache.djsmanchanda.workers.dev";
        const [metaRes, standingsRes] = await Promise.all([
          fetch(`${base}/api/f1/meta?year=${year}`, { headers: { Accept: "application/json" } }),
          fetch(`${base}/api/f1/standings.json?year=${year}`, { headers: { Accept: "application/json" } }),
        ]);
        if (!metaRes.ok || !standingsRes.ok) return new Response("Upstream error", { status: 502 });
        const meta = await metaRes.json();
        const standings = await standingsRes.json();
        const payload = buildAppDataFromEndpoints(year, meta, standings);
        return Response.json(payload, { headers: { "Cache-Control": "public, s-maxage=300" } });
      } catch (e) {
        return new Response("Failed to load data", { status: 500 });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ status: "ok" });
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function buildAppDataFromEndpoints(year: number, meta: any, standings: any) {
  // Build full-season schedule from meta.rounds
  const roundsMeta = Array.isArray(meta?.rounds) ? meta.rounds : [];
  const allRaces = roundsMeta.map((r: any) => ({
    round: r.round,
    raceName: r.raceName,
    status: r.status,
    hasSprint: Boolean(r.sprintDateTimeUTC),
    dateTimeUTC: r.dateTimeUTC,
    sprintDateTimeUTC: r.sprintDateTimeUTC,
  }));
  const allSprints = allRaces.filter((r: any) => r.hasSprint);

  // Build standings
  const driverNames: Record<number, string> = {};
  const currentPoints: Record<number, number> = {};
  const drivers: number[] = [];
  for (const row of (Array.isArray(standings) ? standings : [])) {
    const num = parseInt(row["Driver Number"]) || 0;
    if (!num) continue;
    const name = row["Driver Name"] || `Driver #${num}`;
    driverNames[num] = name;
    currentPoints[num] = Number(row["Final Points"] ?? 0);
    drivers.push(num);
  }
  return { year, driverNames, currentPoints, drivers, allRaces, allSprints };
}
