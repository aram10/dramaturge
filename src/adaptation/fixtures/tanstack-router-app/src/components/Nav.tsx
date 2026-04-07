export function Nav() {
  return (
    <nav data-testid="main-nav">
      <a id="home-link" href="/">
        Home
      </a>
      <button data-testid="logout-btn">Logout</button>
    </nav>
  );
}
