import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  return json({ id: params.id });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }
  return new Response(null, { status: 204 });
};
