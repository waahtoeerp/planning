// Cloudflare Worker for planning.tektek.fi
//
// - Serves the planning page from GitHub Pages.
// - Signs users in with GitHub (its own OAuth app, callback on this domain).
// - Only GitHub accounts listed in ALLOWED_GITHUB_IDS can sign in.
// - Keeps a session in an HttpOnly cookie on this domain.
// - Issues short-lived Ed25519 (EdDSA) tokens that Neon's Data API accepts.
//
// Secrets and variables (Cloudflare: Settings → Variables and Secrets):
//   GITHUB_CLIENT_ID       variable   the OAuth app's Client ID
//   GITHUB_CLIENT_SECRET   secret     the OAuth app's Client secret
//   JWT_PRIVATE_KEY        secret     JSON of the Ed25519 private key (one line)
//   ALLOWED_GITHUB_IDS     variable   comma-separated GitHub account IDs, e.g. 163969570

const PAGES = "https://waahtoeerp.github.io/planning";
const SITE = "https://planning.tektek.fi";
const CALLBACK = `${SITE}/auth/callback/github`;
const SESSION_DAYS = 7;
const TOKEN_MINUTES = 15;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/auth/")) {
      return fetch(PAGES + url.pathname + url.search);
    }

    switch (url.pathname) {
      case "/auth/login":
        return login(env);
      case "/auth/callback/github":
        return callback(request, url, env);
      case "/auth/token":
        return token(request, env);
      case "/auth/logout":
        return logout();
      case "/auth/.well-known/jwks.json":
        return jwks(env);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

// ---------- routes ----------

function login(env) {
  const state = randomString(24);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: CALLBACK,
    scope: "read:user",
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params}`,
      "Set-Cookie": cookie("tektek_state", state, { maxAge: 600 }),
    },
  });
}

async function callback(request, url, env) {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expected = getCookie(request, "tektek_state");
  if (!code || !state || !expected || state !== expected) {
    return text("Sign-in expired or invalid. Please try again.", 400);
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: CALLBACK,
    }),
  });
  const { access_token } = await tokenResponse.json();
  if (!access_token) return text("GitHub sign-in failed.", 502);

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "User-Agent": "tektek-planning",
      Accept: "application/vnd.github+json",
    },
  });
  const user = await userResponse.json();

  const allowed = (env.ALLOWED_GITHUB_IDS || "").split(",").map((s) => s.trim());
  if (!allowed.includes(String(user.id))) {
    return text("This GitHub account does not have access to the planning board.", 403);
  }

  const session = await signJwt(env, {
    kind: "session",
    sub: String(user.id),
    login: user.login,
    exp: nowSeconds() + SESSION_DAYS * 86400,
  });

  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookie("tektek_session", session, { maxAge: SESSION_DAYS * 86400 }));
  headers.append("Set-Cookie", cookie("tektek_state", "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function token(request, env) {
  const session = getCookie(request, "tektek_session");
  const claims = session && (await verifyJwt(env, session));
  if (!claims || claims.kind !== "session") {
    return json({ error: "not signed in" }, 401);
  }

  const access = await signJwt(env, {
    sub: claims.sub,
    role: "authenticated",
    aud: "authenticated",
    exp: nowSeconds() + TOKEN_MINUTES * 60,
  });
  return json({ token: access, login: claims.login });
}

function logout() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": cookie("tektek_session", "", { maxAge: 0 }),
    },
  });
}

async function jwks(env) {
  const jwk = JSON.parse(env.JWT_PRIVATE_KEY);
  return json({
    keys: [{ kty: "OKP", crv: "Ed25519", x: jwk.x, kid: jwk.kid, alg: "EdDSA", use: "sig" }],
  });
}

// ---------- JWT (EdDSA / Ed25519) ----------

async function signingKey(env) {
  const jwk = JSON.parse(env.JWT_PRIVATE_KEY);
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}

async function verificationKey(env) {
  const jwk = JSON.parse(env.JWT_PRIVATE_KEY);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: jwk.x },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

async function signJwt(env, payload) {
  const jwk = JSON.parse(env.JWT_PRIVATE_KEY);
  const header = { alg: "EdDSA", typ: "JWT", kid: jwk.kid };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, await signingKey(env), new TextEncoder().encode(input));
  return `${input}.${base64urlBytes(new Uint8Array(signature))}`;
}

async function verifyJwt(env, jwt) {
  const [header, body, sig] = jwt.split(".");
  if (!header || !body || !sig) return null;
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    await verificationKey(env),
    fromBase64url(sig),
    new TextEncoder().encode(`${header}.${body}`),
  );
  if (!valid) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  if (!claims.exp || claims.exp < nowSeconds()) return null;
  return claims;
}

// ---------- helpers ----------

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomString(bytes) {
  return base64urlBytes(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(text) {
  return base64urlBytes(new TextEncoder().encode(text));
}

function base64urlBytes(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function cookie(name, value, { maxAge }) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(message, status) {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
