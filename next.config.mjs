/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deployed as a container per mode; standalone keeps the image small.
  output: "standalone",
  // The e2e suite drives 127.0.0.1 rather than localhost. Next's dev server
  // treats that as cross-origin and serves its client chunks with a 403,
  // which does not fail the page — it renders server-side and simply never
  // hydrates, so every interaction silently does nothing. Allowing the host
  // explicitly is what keeps the e2e tier testing a live page.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
