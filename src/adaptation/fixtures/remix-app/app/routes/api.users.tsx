import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireAuth(request);
  if (!session) {
    throw new Response(null, { status: 401 });
  }
  return json([]);
}

export async function action({ request }: ActionFunctionArgs) {
  const session = await requireAuth(request);
  if (!session) {
    throw new Response(null, { status: 403 });
  }
  const data = CreateUserSchema.parse(await request.json());
  return json({ id: 1 }, { status: 201 });
}
