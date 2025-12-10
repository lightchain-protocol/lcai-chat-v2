import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  serverExternalPackages: [
    "pino-pretty",
    "lokijs",
    "encoding",
    "blst",
    "snarkjs",
  ],
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
  turbopack: {},
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
    ],
  },
};

export default nextConfig;
