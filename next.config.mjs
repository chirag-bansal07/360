/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // shared links are for the people they are sent to, not for search engines
  async headers() {
    const noIndex = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' }];
    return [{ source: '/view/:path*', headers: noIndex }, { source: '/report/:path*', headers: noIndex }];
  },
};
export default nextConfig;
