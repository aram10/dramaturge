import { requireUser } from '~/auth.server';
import type { LoaderFunctionArgs } from '@remix-run/node';

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request);
  return json({ user: {} });
}

export default function Dashboard() {
  return (
    <div data-testid="dashboard-main">
      <h1>Dashboard</h1>
    </div>
  );
}
