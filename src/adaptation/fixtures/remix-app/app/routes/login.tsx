import type { ActionFunctionArgs } from "@remix-run/node";

export async function action({ request }: ActionFunctionArgs) {
  return json({ success: true });
}

export default function Login() {
  return <form data-testid="login-form"><button type="submit">Login</button></form>;
}
