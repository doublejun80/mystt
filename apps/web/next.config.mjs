const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:4100";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  async rewrites() {
    return [
      {
        source: "/health",
        destination: `${apiBaseUrl}/health`
      },
      {
        source: "/v1/:path*",
        destination: `${apiBaseUrl}/v1/:path*`
      }
    ];
  }
};

export default nextConfig;
