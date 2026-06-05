/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.aajjo.com' },
      { protocol: 'http', hostname: '*.aajjo.com' },
    ],
  },
};

export default nextConfig;
