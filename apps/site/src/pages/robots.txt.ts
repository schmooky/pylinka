import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://pylinka.schmooky.dev');
  const body = `User-agent: *
Allow: /
# app/tool pages render client-side only — nothing to crawl
Disallow: /editor
Disallow: /capture

Sitemap: ${new URL('sitemap-index.xml', base).href}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
