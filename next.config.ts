import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  // Include WASM modules in serverless functions for IPFS routes
  outputFileTracingIncludes: {
    "/api/chat/[id]/backup": ["./node_modules/bls-eth-wasm/**/*"],
    "/api/chat/restore": ["./node_modules/bls-eth-wasm/**/*"],
  },
  webpack(config) {
    config.externals.push(
      "pino-pretty",
      "lokijs",
      "encoding",
      "blst",
      "snarkjs"
    );

    // Configure webpack to handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

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
