import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    /**
     * The coach application uploads an ÖSYM result document through a Server
     * Action. The default body limit is 1 MB, which a phone photo of a
     * document clears easily — and the failure is a generic 500 with no
     * indication that size was the problem. 10 MB gives headroom over the
     * 8 MB we validate against, so oversized files are rejected by our own
     * check with a readable message rather than by the framework.
     */
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
