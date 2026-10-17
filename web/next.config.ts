import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // the LinuxONE VM (s390x) has no SWC/Turbopack binary, so it runs this bundle built elsewhere
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
