// Serves the chart page with a live link preview (Open Graph), e.g.
// "🎄 Grinch or Elf? · Where does the group put you?" + "4 of 6 have placed everyone".
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/chart', url.origin));
  let html = await page.text();
  let title = 'Chartmates · your friends put you on the chart';
  let desc = 'Place your friends on a funny chart, they place you, and the group verdict is revealed. No sign-up, no app.';
  try {
    const id = String(params.id || '');
    if (/^[A-Za-z0-9]{8}$/.test(id)) {
      const stub = env.CHARTS.get(env.CHARTS.idFromName(id));
      const r = await stub.fetch('https://do/', { method: 'POST', body: JSON.stringify({ op: 'preview' }) });
      if (r.ok) {
        const p = await r.json();
        title = `${p.emoji} ${p.title} · where does the group put you?`;
        desc = p.revealed
          ? `${p.line}${p.award ? ` · ${p.award}` : ''}. See the chart, then make one for your other group.`
          : `${p.line}. ${p.by ? `${p.by} wants` : 'Your friends want'} you on the chart: place everyone, then see where they put you. No sign-up.`;
      }
    }
  } catch (e) {
    console.error(e);
  }
  const meta = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Chartmates">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
