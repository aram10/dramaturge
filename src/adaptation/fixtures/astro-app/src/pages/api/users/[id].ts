import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params }) => {
  return Response.json({ id: params.id });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) {
    return new Response(null, { status: 401 });
  }
  return new Response(null, { status: 204 });
};
