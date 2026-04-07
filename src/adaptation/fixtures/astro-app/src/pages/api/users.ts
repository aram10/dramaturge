import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return new Response(null, { status: 401 });
  }
  return Response.json([]);
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return new Response(null, { status: 403 });
  }
  const data = CreateUserSchema.parse(await request.json());
  return Response.json({ id: 1 }, { status: 201 });
};
