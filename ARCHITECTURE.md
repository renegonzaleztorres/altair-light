# Altair Light Project Architecture

| Metadata | Value |
| --- | --- |
| Bundled Altair module | 3.4.0 |
| Document owner | This application repository |
| Last reviewed | 2026-10-25 |
| Framework architecture | [`altair/ARCHITECTURE.md`](altair/ARCHITECTURE.md) |

## Purpose and Scope

This document describes the evolving architecture of this Altair Light project:
its application layer, active kinetic space, project-specific extensions,
configuration choices, tests, and deployment model.

It does not duplicate Altair module internals. Rendering, Tarazed, DATA loading,
route caching, active-space watching, WebSockets, lifecycle behavior, and the
framework extension contract are owned by
[`altair/ARCHITECTURE.md`](altair/ARCHITECTURE.md) and versioned with the
`altair/` module.

The repository is both a runnable minimal website and a foundation that can be
forked into a custom website or application. When a fork adds custom behavior,
that behavior must be documented here rather than in the module architecture.

## Architectural Intent

Altair Light follows a small, file-oriented application model:

- Node.js runs one application process.
- The reusable `altair/` module supplies HTTP, rendering, DATA, caching, and
  watcher capabilities.
- `web-app/` is the project-owned integration layer.
- `spaces/kinetic/` contains the active website content.
- Pages and content require no application build.
- An AI agent can manage kinetic content as the site’s CMS.
- Application/framework changes and kinetic-only content changes follow
  different deployment paths.

## System Context

```text
Browser / CDN / reverse proxy
            |
            v
        index.js
            |
            v
     web-app/main.js
            |
            v
         WebApp                 project-owned integration
            |
            v
         WebServer              Altair module
            |
            +---- Tarazed
            +---- DATA cache
            +---- optional route cache
            +---- active-space/DATA watcher
            +---- optional media CDN fallback
            |
            v
     spaces/kinetic             active site content

Explicit operator/agent command (outside HTTP runtime):
media publisher CLI -> S3-compatible object storage -> CDN/edge delivery
```

## Repository Ownership

```text
altair-light/
├── index.js                    Application entry point
├── web-app/                    Project-owned Altair integration
├── spaces/kinetic/             Active pages, components, data and assets
├── config/                     Application version and port configuration
├── tests/                      Project-specific tests
├── altair/                     Reusable framework module and framework tests
├── WORKBENCH/                  Local work and development directory
├── ARCHITECTURE.md             This project architecture
└── README.md                   Project setup and operator introduction
```

Ownership rule:

- A reusable behavior implemented under `altair/` belongs in the Altair module
  architecture.
- A project choice, override, integration, content convention, or deployment
  decision belongs in this document.
- Draft assessments, experiments, and implementation plans may be developed in
  `WORKBENCH/`; its working contents are local and non-authoritative.
- Documentation should link to its canonical owner rather than copy it.

## Application Startup

The project startup chain is:

```text
index.js
  -> web-app/main.js::main()
  -> new WebApp()
  -> WebApp.start()
```

`WebApp` extends Altair’s `WebServer`. The application currently uses the
standard Altair startup and does not add another application service layer.

## Current Application Integration

The project-specific class is [`web-app/web-app.js`](web-app/web-app.js).

### Custom Routes

`additionalRoutes()` is implemented as an empty extension point. The current
base project defines no custom API or application route. Forks should define
their Hono routes there and document their route ownership, authentication,
data flow, and cache policy in this document.

### Custom Variables

`additionalVarDefinitions()` supplies:

| Variable | Project source | Current purpose |
| --- | --- | --- |
| `version` | `config/default.json` | Application version |
| `ver` | `config/default.json` | Short version alias |
| `appname` | `APP_NAME` | Application name |
| `assetsversion` | Current UTC timestamp | Development asset cache busting |

Flattened DATA values are applied after these definitions. Production
`DATA.json` therefore overrides `assetsversion` with the stable value `1.0`.
This is the current compatibility behavior, not the intended long-term asset
pipeline. Content-hashed assets and immutable asset URLs remain planned work.

### Global Replacements

The sample `applyGlobalReplacements()` override is commented out. The project
currently performs no application-level final-response rewriting and uses
local `/images/`, `/css/`, and `/js/` paths. Managed `/media/` references use
Altair's publisher/fallback contract and are never rewritten to provider URLs.

## Active Kinetic Space

The selected space is `spaces/kinetic`.

```text
spaces/kinetic/
├── pages/                      Public file-backed HTML routes
├── globals/                    Shared document and layout fragments
├── components/                Reusable private components
├── data/                       DATA.json and content JSON
├── css/                        CSS entry point and partials
├── js/                         JavaScript entry point and partials
├── public/                     Directly served static media
│   └── media/                  Managed media bytes excluded from Git
├── .altair/                    Tracked verified manifest; ignored lock/temp state
└── templates/                  Private authoring templates
```

### Current Page Composition

The current site contains one public page:

```text
/ -> spaces/kinetic/pages/home.html
```

It also includes private base error presentations:

```text
404 -> spaces/kinetic/pages/_404.html
500 -> spaces/kinetic/pages/_500.html
```

These files use the shared layout, retain their error status, and never become
ordinary public routes or route-cache entries. `_500.html` may display only the
opaque `@@VAR_ERRORREFERENCE`, not internal exception details.

The page includes the shared header and footer and obtains its descriptive
content from `spaces/kinetic/data/altair.json` through `@@DATA_`.

The JSON description intentionally contains trusted HTML (`<strong>`), which
is emitted by the current Tarazed behavior. A future default-escaping migration
must classify or migrate this value explicitly rather than silently changing
its output.

### CSS and JavaScript Composition

`css/styles.css` and `js/scripts.js` are rendered through Altair and include
private partials with `@@ELEM_`. They are not part of Route Cache v1. Static
files beneath `public/` are served directly.

### Managed Media

The base application reserves `public/media/` through `MEDIA_LOCATION=media`.
HTML and kinetic content use stable `/media/...` references. Media bytes are
excluded from Git while the directory placeholder remains tracked.

Publishing is disabled by default. A configured site uses the explicit
`pnpm media:publish` command to stream new or edited objects to AWS S3,
Cloudflare R2, or another compatible service and records verified state at
`<ACTIVE_SPACE>/.altair/media-publication.json`. The application publishes
media before activating content that introduces a reference.

Optional local-miss fallback preserves local static-file precedence and sends
only safe missing `/media/...` `GET`/`HEAD` requests to a validated CDN origin
with `307`. Production media-heavy deployments should route `/media/*` at the
edge so the request bypasses Altair. Altair never proxies remote media bytes.

The project uses the following media environment contract:

| Variable | Default | Project responsibility |
| --- | --- | --- |
| `MEDIA_LOCATION` | `media` | Select a safe relative directory beneath `PUBLIC_LOCATION`; update `.gitignore` if it changes. |
| `MEDIA_CDN_FALLBACK` | `false` | Enable only where missing local media should redirect. |
| `MEDIA_CDN_BASE_URL` | None | Supply the public HTTPS delivery origin when fallback or public verification is enabled. |
| `MEDIA_PUBLISH_ENABLED` | `false` | Enable only in an explicit publication environment. |
| `MEDIA_PUBLISH_PROVIDER` | `s3-compatible` | Version 1 supports this adapter only, for S3, R2, and compatible storage. |
| `MEDIA_PUBLISH_BUCKET` | None | Supply the deployment's destination bucket. |
| `MEDIA_PUBLISH_ENDPOINT` | Empty | Leave empty for standard AWS S3 or set the provider's S3 API origin. |
| `MEDIA_PUBLISH_REGION` | None | Supply the AWS region or `auto` for R2. |
| `MEDIA_PUBLISH_FORCE_PATH_STYLE` | `false` | Enable only for providers requiring path-style bucket addressing. |
| `MEDIA_PUBLISH_VERIFY_PUBLIC` | `false` | Optionally verify delivery through `MEDIA_CDN_BASE_URL`. |
| `MEDIA_PUBLISH_ACCESS_KEY_ID` | None | Required publisher-specific access-key secret. |
| `MEDIA_PUBLISH_SECRET_ACCESS_KEY` | None | Required publisher-specific secret key. |
| `MEDIA_PUBLISH_SESSION_TOKEN` | Empty | Optional temporary-credential token. |

## Data and Configuration

The project uses three configuration layers:

| Layer | Project responsibility | Restart/build effect |
| --- | --- | --- |
| Environment | Runtime paths, environment, feature flags, secrets | New process |
| `config/*.json` | Application version and fixed server configuration | New application release |
| Kinetic DATA/content | Public site data and environment-specific public values | Hot reload; no build |

`spaces/kinetic/data/DATA.json` currently contains environment sections and a
production `assetsVersion`. DATA is public rendering input and must never
contain credentials or private user information.

The checked-in `.env.example` is the public configuration reference. The real
`.env` is deployment-owned and must not be treated as architecture
documentation or committed when it contains secrets.

Publisher credentials are environment-owned secrets used only by the explicit
CLI. They are never stored in DATA, the publication manifest, command output,
or the browser-facing process. Media-specific, provider-neutral credential
names are passed explicitly to the adapter so unrelated AWS or Cloudflare
credentials cannot be selected by an SDK default chain.

## Route Cache Integration

The bundled Altair module includes an optional process-local route cache. This
base project does not enable it unless `ENABLE_ROUTE_CACHE=true` is selected by
the environment.

Project-level decisions when enabling it:

- The site’s file-backed public pages are eligible under Altair’s conservative
  cache policy.
- Query, cookie, authorization, custom, private, no-store, redirect, error, and
  timestamp-token cases bypass shared caching.
- Full active-space watching should remain enabled for mutable kinetic
  deployments.
- Managed media and `.altair` publisher state are automatically excluded from
  route-cache watcher events and reconciliation snapshots.
- Reconciliation should be enabled only when content may change outside a
  controlled deployment acknowledgement.
- Each process owns its own cache; multi-instance coordination is not part of
  the current project topology.

The implementation details and complete eligibility rules are documented in
[`altair/ARCHITECTURE.md`](altair/ARCHITECTURE.md).

## Deployment Model

The recommended production model is hybrid.

### Immutable Application Release

Create a new release and process when any of these change:

- `altair/` framework source.
- `web-app/` application source.
- `index.js`.
- Dependencies or lockfile.
- Environment variables.
- `config/*.json`.
- Future TypeScript or asset build configuration.

The new process starts with empty process-local caches. Production activation
should switch traffic or a current-release symlink only after startup and
readiness checks succeed.

### Mutable Kinetic Release

Pages, globals, components, public content, DATA, CSS, JavaScript content, and
media under the active kinetic space can be deployed without rebuilding or
restarting the application.

Media publication must complete and verify successfully before kinetic content
that references newly published objects is activated. Publisher configuration
changes are environment/application changes and require a new process; running
the publisher and changing media bytes do not.

When route caching is active, the full-space watcher batches changes, reloads
DATA safely, and invalidates rendered pages. A controlled directory or symlink
switch should send `SIGHUP` or invoke `reloadActiveSpace()` after activation.

The implemented project architecture, rather than a local workbench draft,
must remain the authority for production deployment behavior.

## Testing Boundaries

The test commands intentionally separate framework and application ownership:

| Command | Ownership |
| --- | --- |
| `pnpm test:altair` | Reusable tests under `altair/` |
| `pnpm test:app` | Project-specific tests under `tests/` |
| `pnpm test` | Complete pre-deployment gate |

The Altair HTTP fixtures do not execute this project’s root `index.js` or its
custom `WebApp`. Application forks should place custom route, integration,
content, accessibility, and deployment tests under `tests/`.

## Security Boundaries

- Environment variables may contain secrets; rendered DATA and kinetic JSON
  must not.
- Custom routes own their authentication, authorization, request validation,
  response privacy, and cache policy.
- Public content must not rely on underscore-prefixed private files being
  reachable as routes.
- Altair returns conventional `404`/`500` responses. This project includes
  private base `pages/_404.html` and `pages/_500.html` presentations without
  changing those statuses or enabling route caching for them.
- The current raw template substitution model requires trusted content. Default
  escaping is planned but not yet implemented.
- Reverse-proxy trust, security headers, narrowed CORS, and structured request
  logging are roadmap items, not current project guarantees.

## Current Limitations and Planned Evolution

The following are deliberately not represented as implemented behavior:

- Content-hashed CSS/JavaScript asset builds.
- Responsive media variants, transcoding, hashed immutable media names, and
  automated remote deletion.
- Default template escaping.
- Custom branded 404/500 designs beyond the included base presentations.
- TypeScript source or a TypeScript build.
- Multi-instance route-cache coordination.
- Deployment-time content schemas and accessibility validation.

Draft assessments and implementation plans may be developed in `WORKBENCH/`.
Once a capability is accepted and implemented, its project-specific use moves
into this document; its reusable framework mechanics move into the Altair
architecture. Runtime behavior must never depend on untracked workbench files.

## Documentation Lifecycle

### When Altair Is Upgraded

Update together:

- `altair/` source.
- `altair/ARCHITECTURE.md`.
- `altair/README.md`.
- `altair/CHANGELOG.md`.
- Altair-owned tests.

Update this root document only when the new Altair version changes how this
project integrates, configures, deploys, or extends the module. Record the
bundled Altair version at the top.

### When the Project Is Customized

Update this document when adding:

- Custom routes or APIs.
- Authentication or personalized responses.
- External services and data stores.
- Project-specific cache decisions.
- CDN, hosting, or deployment topology.
- New `WebApp` overrides.
- Content schemas, tests, or operational procedures.

Do not put those details into `altair/ARCHITECTURE.md` unless they become
reusable framework behavior.
