/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
    localPatterns: [{ pathname: '/**' }],
  },
};

export default nextConfig;
