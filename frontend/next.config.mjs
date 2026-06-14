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
        {
          source: '/api/v2/telemetry/f3x9m2k8',
          destination: '/console',
        },
        {
          source: '/api/v2/telemetry/f3x9m2k8/:path*',
          destination: `${apiBase}/v2/telemetry/f3x9m2k8/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
