import { execSync } from 'node:child_process';

// App "version" shown in tiny text at the bottom of /admin/settings, purely
// so the owner can eyeball whether a deploy landed. Computed at build time
// from the total commit count on main -- since Vercel auto-deploys every
// push, this tracks 1:1 with "how many versions I've pushed" without any
// manual bumping. If it ever drifts from Vercel's own deployment count
// (e.g. a build was skipped/failed), adjust VERSION_OFFSET to realign it —
// check Vercel's Deployments tab for the real count.
const VERSION_OFFSET = 0;

function getAppVersion() {
  try {
    const count = parseInt(execSync('git rev-list --count HEAD').toString().trim(), 10);
    return String(count + VERSION_OFFSET);
  } catch {
    return '0'; // no git available at build time (e.g. a non-git deploy source)
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [],
    localPatterns: [{ pathname: '/**' }],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: getAppVersion(),
  },
};

export default nextConfig;
