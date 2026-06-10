/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.aajjo.com' },
      { protocol: 'http', hostname: '*.aajjo.com' },
    ],
  },

  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
    return {
      beforeFiles: [
        // Serve the console UI page (must be before the proxy rule)
        {
          source: '/api/v2/telemetry/f3x9m2k8',
          destination: '/console',
        },
        // Proxy API calls to backend
        {
          source: '/api/v2/telemetry/f3x9m2k8/:path*',
          destination: `${apiBase}/v2/telemetry/f3x9m2k8/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
