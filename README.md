# WebProbe

Autonomous exploratory QA for web applications.

## Authentication Success Indicators

WebProbe supports four success-indicator formats:

- `url:/dashboard`
  - Exact path match. This is the safest URL-based option.
- `url-prefix:/manage`
  - Prefix path match. Use this only when successful auth intentionally lands in multiple sub-routes.
- `selector:[data-testid='user-menu']`
  - DOM-based match for an element that only appears after sign-in.
- `text:Welcome back`
  - Text-based match when the post-login UI has stable visible copy.

Avoid `url:/` as a generic auth check. It is usually too broad for modern apps because login pages, callback routes, and other unauthenticated pages often also live under `/`.
