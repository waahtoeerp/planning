// Cloudflare Worker for planning.tektek.fi
//
// Serves the planning page from GitHub Pages and forwards /auth/* to Neon Auth.
// Because the page and the sign-in share one domain, the browser treats the
// session cookie as first-party and keeps it (Firefox and Safari block it when
// the sign-in is on a different site).

const NEON_AUTH = "https://ep-silent-shadow-b9rx4q0d.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth";
const PAGES = "https://waahtoeerp.github.io/planning";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/auth/")) {
      const target = NEON_AUTH + url.pathname.slice("/auth".length) + url.search;
      return fetch(target, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual", // let the browser follow sign-in redirects itself
      });
    }

    return fetch(PAGES + url.pathname + url.search);
  },
};
