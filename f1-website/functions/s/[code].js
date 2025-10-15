// /s/[code] - redirect to long URL

export async function onRequest(context) {
  const { request, env, params } = context;
  const code = params.code;
  if (!code) return new Response('Not Found', { status: 404 });

  const key = `short:code:${code}`;
  let val = null;
  if (env && env.F1_CACHE) {
    val = await env.F1_CACHE.get(key);
  } else {
    // in-memory dev fallback
    const mem = globalThis.__SHORT_MEM__;
    if (mem && mem.get) {
      const rec = mem.get(key);
      if (rec && (!rec.exp || rec.exp > Date.now())) val = rec.val;
    }
  }

  if (!val) return new Response('Not Found', { status: 404 });
  try {
    const parsed = JSON.parse(val);
    const target = parsed && parsed.url;
    if (!target) return new Response('Not Found', { status: 404 });
    return Response.redirect(target, 302);
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}
