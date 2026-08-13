import type { NextConfig } from "next";

/**
 * Statický export do `out/` - Capacitor appku servíruje ze souborů v telefonu,
 * žádný Node server tam neběží. `trailingSlash` proto, aby každá routa měla
 * vlastní `index.html`, který WebView najde.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
