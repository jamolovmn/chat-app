/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["matrix-js-sdk"],
  // StrictMode'ni o'chirish — WebRTC calllar uchun muhim:
  // StrictMode development'da useEffect ni 2 marta ishlatadi,
  // bu esa video call'larda 2 ta invite event yaratadi.
  reactStrictMode: false,
};

module.exports = nextConfig;
