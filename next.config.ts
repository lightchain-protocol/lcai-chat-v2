import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  webpack(config) {
    config.externals.push(
      "pino-pretty",
      "lokijs",
      "encoding",
      "blst",
      "snarkjs"
    );

    return config;
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
    ],
  },
};

export default nextConfig;
