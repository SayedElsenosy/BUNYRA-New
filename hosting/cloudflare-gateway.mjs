// A fixed upstream gateway: no database credentials, arbitrary targets, or caching of sessions.
const UPSTREAM = 'https://bunyra-new.netlify.app';
export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(UPSTREAM);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
    headers.set('x-forwarded-host', incoming.host);
    headers.set('x-forwarded-proto', 'https');
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
        cf: { cacheEverything: false, cacheTtl: 0 },
      });
      const response = new Response(upstream.body, upstream);
      const location = response.headers.get('location');
      if (location) {
        const redirect = new URL(location, UPSTREAM);
        if (redirect.origin === UPSTREAM) {
          redirect.protocol = incoming.protocol;
          redirect.host = incoming.host;
          response.headers.set('location', redirect.toString());
        }
      }
      response.headers.set('x-bunyra-gateway', 'cloudflare');
      return response;
    } catch {
      return new Response('BUNYRA upstream is temporarily unavailable.', {status:502,headers:{'Cache-Control':'no-store'}});
    }
  },
};

