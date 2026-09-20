/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Served under /valet so one host can front the landing site, the admin
  // portal (/admin) and this guest page without a second domain. The QR on a
  // valet card encodes <BASE_URL>/valet/v/<token>.
  basePath: '/valet',
};
module.exports = nextConfig;
