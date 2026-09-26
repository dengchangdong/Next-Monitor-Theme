# Security audit

Last reviewed: 2026-09-26

## Scope

The review covered the public theme's production dependencies, API and WebSocket data flow,
client-side routing, dynamic assets, DOM injection sinks, browser policy, and handling of malformed
live metrics. It did not treat the same-origin monitor hub as an untrusted server.

## Results

- `npm audit` reports zero known vulnerabilities for production and development dependencies.
- The source contains no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, remote script,
  remote stylesheet, or user-controlled external URL sink. React text rendering escapes node names,
  notices, API errors, and all other hub-provided strings.
- HTTP requests and the live WebSocket stay on the page's origin. The theme does not store or transmit
  an agent token, session token, or other credential.
- The document applies a restrictive Content Security Policy: scripts, fonts and images are local;
  objects and base URLs are disabled. Inline styles remain enabled because charts and data-driven
  visual indicators use React style properties; inline scripts remain disabled.
- Node detail routes now accept only the exact `/node/{integer}` shape. Unexpected suffixes do not get
  interpreted as another node ID.
- Malformed metric objects are isolated to their node, and invalid country values fall back to the
  bundled placeholder flag instead of crashing the page.
- Live snapshots are reconciled by node ID and value. Unchanged records retain object identity, so an
  automatic refresh updates data without remounting the page shell or resetting UI state.
- `package-lock.json` is committed, CI uses `npm ci`, and release archives are generated only after the
  test, lint, build and package-verification steps pass.

## Residual considerations

- A theme is executable same-origin code. Install theme archives only from a trusted author and verify
  the release checksum before uploading them to the hub.
- Frame embedding controls such as `frame-ancestors` must be sent as an HTTP response header; a CSP meta
  element cannot enforce them. Set that header in Nginx or the hub if clickjacking protection is required.
- Keep dependencies and the Node.js runtime current, and rerun both production and full `npm audit`
  checks before every release.
