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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const key = new URL(request.url).pathname.replace(/^\//, "");
    if (!key) return new Response("Not Found", { status: 404 });

    // HEAD — use R2 head() to avoid transferring the body
    if (request.method === "HEAD") {
      const meta = await env.BUCKET.head(key);
      if (!meta) return new Response(null, { status: 404 });
      return new Response(null, {
        headers: buildHeaders(meta.httpMetadata?.contentType, key, meta.httpEtag),
      });
    }

    // GET
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
