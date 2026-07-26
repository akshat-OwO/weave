import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  webpack: (webpackConfig) => {
    webpackConfig.module.rules.push({
      test: /\.sh$/u,
      type: "asset/source",
    });

    return webpackConfig;
  },
};

export default withMDX(config);
