import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  return new Response(null, { status: 302 });
};
