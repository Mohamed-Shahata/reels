import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // The standalone trimmer page is now the "Trim" tab of the workspace.
        source: '/videos/:id/trimmer',
        destination: '/videos/:id?tab=trim',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
