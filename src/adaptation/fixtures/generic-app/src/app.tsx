export const routes = ["/", "/settings/profile", "/billing"];

export function App() {
  return (
    <nav data-testid="app-nav">
      <a href="/settings/profile">Profile</a>
      <button data-testid="settings-save">Save</button>
    </nav>
  );
}
