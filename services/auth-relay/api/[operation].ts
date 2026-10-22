import { createVercelRelay } from '../src/vercel';

const relay = createVercelRelay();
export default {
  fetch(request: Request): Promise<Response> {
    return relay(request, {
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
      GITHUB_APP_ID: process.env.GITHUB_APP_ID || '',
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG || '',
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
    });
  },
};
