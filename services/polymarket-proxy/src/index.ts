/**
 * Cloudflare Worker Proxy for Polymarket APIs
 * Deployed in US region to bypass geo-restrictions
 */

interface Env {
  PROXY_SECRET?: string;
}

const ALLOWED_HOSTS = [
  "gamma-api.polymarket.com",
  "clob.polymarket.com",
  "polymarket.com",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Optional: Check proxy secret
    if (env.PROXY_SECRET) {
      const authHeader = request.headers.get("X-Proxy-Secret");
      if (authHeader !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    try {
      const url = new URL(request.url);

      // Extract target URL from path: /proxy/{encoded_url}
      // Or from query param: ?url={encoded_url}
      let targetUrl: string | null = null;

      if (url.pathname.startsWith("/proxy/")) {
        targetUrl = decodeURIComponent(url.pathname.slice(7));
      } else if (url.searchParams.has("url")) {
        targetUrl = decodeURIComponent(url.searchParams.get("url")!);
      }

      if (!targetUrl) {
        return new Response(
          JSON.stringify({
            error: "Missing target URL",
            usage: "GET /proxy/{encoded_url} or GET ?url={encoded_url}",
            example: "/proxy/https%3A%2F%2Fgamma-api.polymarket.com%2Fmarkets%3Flimit%3D5",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Validate target host
      const targetHost = new URL(targetUrl).hostname;
      if (!ALLOWED_HOSTS.includes(targetHost)) {
        return new Response(
          JSON.stringify({
            error: "Host not allowed",
            allowed: ALLOWED_HOSTS,
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Forward the request
      const proxyHeaders = new Headers();

      // Copy relevant headers from original request
      for (const [key, value] of request.headers.entries()) {
        // Skip hop-by-hop headers and our custom headers
        if (
          !["host", "x-proxy-secret", "cf-connecting-ip", "cf-ray"].includes(
            key.toLowerCase()
          )
        ) {
          proxyHeaders.set(key, value);
        }
      }

      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== "GET" ? request.body : undefined,
      });

      const response = await fetch(proxyRequest);

      // Return response with CORS headers
      const proxyResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          ...corsHeaders,
        },
      });

      return proxyResponse;
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Proxy error",
          message: err instanceof Error ? err.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};
