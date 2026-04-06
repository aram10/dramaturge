import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }
  return json([]);
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) {
    error(403, 'Forbidden');
  }
  const data = CreateUserSchema.parse(await request.json());
  return json({ id: 1 }, { status: 201 });
};
