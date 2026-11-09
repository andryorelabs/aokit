import type { NextConfig } from "next";

export const nextConfig: NextConfig = {
  reactCompiler: true,
};

export const plugins: ((config: NextConfig) => NextConfig)[] = [];

export default plugins.reduce((config, plugin) => plugin(config), nextConfig);
