export interface Env {
  BUCKET: R2Bucket;
}

const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// All assets are under a versioned release prefix (e.g. 20260325_anima_all_artists/…)
// so they are truly immutable — safe to cache for a year.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const MIME: Record<string, string> = {
  webp: "image/webp",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
};

const IMAGE_EXT = new Set(["webp", "png", "jpg", "jpeg"]);

function isImage(key: string): boolean {
  return IMAGE_EXT.has(key.split(".").pop()?.toLowerCase() ?? "");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\//, "");
    if (!key) return new Response("Not Found", { status: 404 });

    // ── Images: serve from Cloudflare edge cache, ignoring browser no-cache ──
    // Images are immutable (versioned URLs). Even if the user does Ctrl+Shift+R
    // the browser's Cache-Control: no-cache header is stripped before the edge
    // cache lookup, so R2 is never hit after the first visitor warms that edge node.
    if (request.method === "GET" && isImage(key)) {
      const edgeCache = caches.default;
      // Use a clean request as cache key — no browser cache-busting headers
      const cacheKey = new Request(url.toString());

      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;

      const object = await env.BUCKET.get(key);
      if (!object) return new Response("Not Found", { status: 404 });

      const response = new Response(object.body, {
        headers: buildHeaders(object.httpMetadata?.contentType, key, object.httpEtag),
      });

      // Store in edge cache (fire-and-forget; don't block the response)
      void edgeCache.put(cacheKey, response.clone());
      return response;
    }

    // HEAD — use R2 head() to avoid transferring the body
    if (request.method === "HEAD") {
      const meta = await env.BUCKET.head(key);
      if (!meta) return new Response(null, { status: 404 });
      return new Response(null, {
        headers: buildHeaders(meta.httpMetadata?.contentType, key, meta.httpEtag),
      });
    }

    // GET for non-image assets (JSON manifest, shards, etc.)
    // These respect browser cache-busting normally.
    const object = await env.BUCKET.get(key, {
      onlyIf: { etagDoesNotMatch: request.headers.get("If-None-Match") ?? undefined },
    });

    if (!object) return new Response("Not Found", { status: 404 });

    // R2 returns null body when onlyIf condition fails (etag matched → 304)
    if (object.body === null) {
      return new Response(null, {
        status: 304,
        headers: buildHeaders(object.httpMetadata?.contentType, key, object.httpEtag),
      });
    }

    return new Response(object.body, {
      headers: buildHeaders(object.httpMetadata?.contentType, key, object.httpEtag),
    });
  },
} satisfies ExportedHandler<Env>;

function buildHeaders(
  contentType: string | undefined,
  key: string,
  etag: string,
): Headers {
  const h = new Headers(CORS as Record<string, string>);
  h.set("Cache-Control", CACHE_CONTROL);
  h.set("ETag", etag);

  if (contentType) {
    h.set("Content-Type", contentType);
  } else {
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    if (MIME[ext]) h.set("Content-Type", MIME[ext]);
  }

  return h;
}
