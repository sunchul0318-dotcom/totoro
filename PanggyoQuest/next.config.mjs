/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages 는 @cloudflare/next-on-pages 로 빌드하므로 정적 export 를 쓰지 않는다.
  // (output: 'export' 는 next-on-pages 와 호환되지 않음)
  images: { unoptimized: true },
  reactStrictMode: false,
};

export default nextConfig;
