# Multi-Key Rotation — detail

The internals of `dsh-multi-key-rotation`. The [README](../README.md) covers
what the plugin does and how to use it; this document covers how it is built
and how it is distributed.

![The Multi-Key Rotation tab of the Plugins settings section, showing three named API keys of one provider with their remaining quota for the 5-hour and weekly windows](preview.svg)

## Package layout

```
dsh-multi-key-rotation/
├── index.js            Host half — rotation listener, quota probe, HTTP route
├── client.js           Browser half — the settings tab component
├── src/pool.js         Pure logic — schemas, quota parsing, key selection
├── cordis.patch.yml    Bundle patch — inserts the Host plugin row
├── locale/en.json      English metadata for the Plugin Manager / market
├── locale/zh.json      Chinese metadata for the Plugin Manager / market
├── docs/DETAIL.md      Detail document (one feature image)
├── docs/preview.svg    The feature image
├── icon.svg            Plugin Manager icon
├── LICENSE             MIT
├── NOTICE              Attribution to the project that inspired this one
└── test/               Host and browser tests
```

`index.js`, `client.js` and `src/pool.js` are plain ESM with **no build
step**: the package ships exactly what is in the repository. That keeps the
published tarball auditable — what npm serves is what the source says.

## The Host half

`index.js` exports `apply`, `inject`, `name`, `NS` and `Config`. It does
**not** have a default export, and it must never grow one: the Loader takes
`exports.default` when a module has one, which would collapse the module to
that export and lose the `Config` schema and the `inject` list — a plugin
without a schema has no settings form.

Its parts:

- **the rotation listener** sits on the agent loop's `agent/request-error`
  recovery waterfall. When a failure carries a trigger code, the plugin
  writes the next pool key into the provider's credential reference and
  returns `{ kind: 'retry' }`.
- **the quota probe** reads `GET /v1/token_plan/remains` with the key's own
  value as the bearer token, on the Host, and caches each answer for 45
  seconds.
- **the HTTP route** `GET /llm-key-pool/api/health?provider=<route>[&refresh=1]`
  answers `{ provider, keys: [{ name, ref, enabled, configured, quotaOk,
  remainingPercent, weeklyResetAt, … }] }`. `refresh=1` forces a fresh probe
  instead of the cached one. The route sits behind the composition's
  admission check, so an unauthenticated request is refused before any quota
  is probed.

### The quota answer

The endpoint answers with one row per model under `model_remains`. The
fields the plugin reads are these:

| Field | Meaning |
|---|---|
| `model_name` | the model the row describes |
| `current_interval_remaining_percent` | the share left in the 5-hour window |
| `current_weekly_remaining_percent` | the share left in the weekly window |
| `end_time` | when the 5-hour window resets |
| `weekly_end_time` | when the weekly window resets |
| `remains_time`, `weekly_remains_time` | the same two windows as a countdown |
| `current_interval_status`, `current_weekly_status` | `1` while the window is open |

The `*_total_count` and `*_usage_count` fields are zero on a Token Plan
answer, so the share comes from the `*_remaining_percent` fields; the
parser falls back to the counts when a provider does report them.

This mapping is verified against the live endpoint, not only against a
recorded sample:

```sh
npm run verify:live
```

The script reads the keys from the DSH credential store, calls the real
endpoint and checks every parsed number against the raw field it came from.
It is deliberately not part of `npm test`, which must stay runnable without
a network or a credential.
- **the HTTP route** `GET /llm-key-pool/api/health?provider=<route>[&refresh=1]`
  answers `{ provider, keys: [{ name, ref, enabled, configured, quotaOk,
  remainingPercent, weeklyResetAt, … }] }`. `refresh=1` forces a fresh probe
  instead of the cached one. The route sits behind the composition's
  admission check, so an unauthenticated request is refused before any quota
  is probed.

### Runtime identifiers

The package identity and the runtime identity are deliberately apart. The npm
name, the bundle entry name, the patch row and the settings-tab id are the
package's own. The runtime identifiers below are stored in users' profiles and
in credential references, so they are **not** changed when the plugin is
rebranded — renaming them would silently break every existing installation:

| Identifier | Value |
|---|---|
| settings namespace | `llm-key-pool` |
| HTTP route | `/llm-key-pool/api/health` |
| log tag | `[llm-key-pool]` |
| credential references | `*_API_KEY_POOL_<n>` |
| patch row id | `llm-key-pool` |

## The browser half

`client.js` is a browser module loaded through `window.__ModuleLoader__`. The
loader keys each factory by the **package name**, scope included, so the
module registers under `@danneleung/dsh-multi-key-rotation`; a bundle that
registers a different id is refused with *"loaded without registering …"*.

It registers one cell in the `settings.plugins.tab` slot and renders the
configuration page. It never sees a key value: it reads quota through the
Host route above and writes key values through `ctx.remote.credentials`.

## The settings tab

The Host's Plugins settings section projects its tab bar from
`settings.plugins.tab`, and mounts each cell's contribution inside its own
tab panel with `{ only: row.id }` and no host-rendered form. A **fresh `id`**
adds a cell beside the shipped ones — reusing a shipped id would *replace*
that tab instead. The Plugin Manager's own `plugins.bundle.config` and
`plugins.row.config` seats are a different surface (the manager page, keyed
by package name), so a page parked there never appears in the settings
section.

The tab registers directly and reads the settings form lazily. It is **not**
gated behind `configForms.whileServed`: that gate fires only once the Host's
settings mirror holds the namespace, and the mirror has no view at boot — a
gated registration never appears, and the page is simply absent.

## Telemetry

A committed rotation emits `llm/key-pool-rotation` on the framework `Events`
interface:

```ts
interface KeyPoolRotationEvent {
  readonly provider: string
  readonly rotationId: string
  readonly triggerCode: string
  readonly toRef: string
  readonly poolIndex: number
  readonly targetRef: string
  readonly failure: LlmFailure
}
```

The event is non-durable: it never enters the session log, so a harness that
does not know this plugin can still resume a session that ran with it.

---

## Packaging and distribution

### Build a distributable tarball

The package has no build step, so "building" is packing:

```sh
npm pack
```

That writes `danneleung-dsh-multi-key-rotation-1.0.0.tgz` — the exact artifact npm
serves. Inspect it before shipping it with `npm pack --dry-run`.

The list must contain exactly the runtime files, the patch, the locales, the
icon, the detail document, `LICENSE`, `NOTICE` and `README.md`. The `files`
array in `package.json` is the whitelist; anything not listed is excluded.

`npm run pack:check` runs the same verification the CI step runs: it packs
the package, opens the tarball, and asserts that every file the manifest
declares is present and that no unexpected file is.

### Publish to npm

1. Log in: `npm login` (or use an npm automation token with
   `NODE_AUTH_TOKEN`).
2. Publish: `npm publish --access public`.
   The `publishConfig` in `package.json` already sets `access: public` and
   the public registry, so plain `npm publish` does the right thing.
3. Verify: `npm view @danneleung/dsh-multi-key-rotation` shows the version, and
   `npm view @danneleung/dsh-multi-key-rotation files` matches what you packed.

The scoped package needs the scope to exist. Public scopes on npm are free:
the first publish to a new scope creates it. **The scope must be lowercase** —
npm forbids uppercase letters in package names and scopes, so the package
identity is `@danneleung/dsh-multi-key-rotation` while the GitHub owner is
`DanneLeung`.

To unpublish within the first 72 hours, `npm unpublish` works. After that
npm keeps the name retired — publish a new version instead of recycling the
name.

### Get listed in the plugin market

The plugin market's catalog is the
[`awesome-dsh-plugin`](https://awesome-dsh-plugin.com) registry. The market
app itself is **not** where plugin entries live — its README says so
explicitly: *"This repo is the market app, not the catalog. To get your
plugin listed in the market, open a PR there."*

So, to be listed:

1. Publish the package to npm first. The registry entry names the npm
   package, and the market installs by npm name.
2. Open a pull request against
   [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
   adding one entry for your package. The site and the market pick the change
   up automatically, usually within a day.
3. Users then add the market's index as a source —
   **Plugins** → **Discover** → **Index sources** →
   `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` — and the
   package appears in Discover and in the `plugin_market` agent tool.

The entry needs at least an npm name and a category; the registry's
`validate-registry` script is the authority on the exact shape, and the
market rejects an entry with no usable category.

### Distribute without npm

Nothing forces npm. The plugin is a plain npm package with no build step, so
the same files install three other ways. All of them go through the same
**Plugins** → **Add plugin** box in the desktop app, or through
`pluginManager.installBundle` on the Host.

The spec forms the installer accepts are these — they are the same forms
pnpm takes:

| Kind | Example | Notes |
|---|---|---|
| Registry name | `@danneleung/dsh-multi-key-rotation` | What npm is for. |
| Registry name + range | `@danneleung/dsh-multi-key-rotation@1.0.0` | One exact version. |
| Local directory | `D:/path/to/dsh-multi-key-rotation` | **Absolute path only** — a relative path is refused. |
| Local tarball | `D:/path/to/danneleung-dsh-multi-key-rotation-1.0.0.tgz` | A `.tgz` or `.tar.gz`. |
| Tarball over HTTP | `https://example.com/dsh-multi-key-rotation.tgz` | A URL ending in `.tgz` or `.tar.gz`. |
| Git URL | `git+https://github.com/DanneLeung/dsh-multi-key-rotation.git` | Also `git://…`, `git@host:owner/repo.git`, or `https://host/owner/repo`. |
| Git shorthand | `github:DanneLeung/dsh-multi-key-rotation` | `github:`, `gitlab:`, `bitbucket:`, `gist:` are understood. |

#### Option 1 — a Git repository (the best fit)

Put the package in a Git repository and let people install a commit:

```sh
dsh plugin --profile <profile> add git+https://github.com/DanneLeung/dsh-multi-key-rotation.git
```

or, in the desktop app, **Plugins** → **Add plugin** and paste the same
string.

This is the form that keeps working without any account: the repository is
the source of truth, and a commit SHA pins an exact state of it. To pin one
commit, append `#<sha>`; to install a package that lives in a subdirectory of
a larger repository, append `&path:/<directory>`:

```sh
# one exact commit
dsh plugin --profile <profile> add "git+https://github.com/DanneLeung/dsh-multi-key-rotation.git#<40-hex-sha>"

# a package inside a monorepo
dsh plugin --profile <profile> add "git+https://github.com/DanneLeung/my-monorepo.git#<40-hex-sha>&path:/packages/dsh-multi-key-rotation"
```

#### Option 2 — a tarball

```sh
npm pack
```

Share the resulting `danneleung-dsh-multi-key-rotation-1.0.0.tgz` — upload it
somewhere, put it in a release, or hand it over directly. People install it
with its path:

```sh
dsh plugin --profile <profile> add D:/downloads/danneleung-dsh-multi-key-rotation-1.0.0.tgz
```

or from a URL:

```sh
dsh plugin --profile <profile> add https://example.com/danneleung-dsh-multi-key-rotation-1.0.0.tgz
```

#### Option 3 — a local directory

For someone who already has the files:

```sh
dsh plugin --profile <profile> add D:/path/to/dsh-multi-key-rotation
```

The path must be **absolute**. The directory is installed as it stands, so
the `files` whitelist does not filter it — a checkout with `node_modules`
or a `.git` directory in it brings those along.

#### List it in a market index without npm

A plugin hosted on Git can be listed in the market **without ever touching
npm**, because the index format lets a version name a Git commit as its
source. Publish a JSON index of your own, serve it over http(s), and have
people add it under **Plugins** → **Discover** → **Index sources**.

A version whose `source.type` is `git` installs like this:

```json
{
  "format": 1,
  "title": { "en": "My plugins" },
  "metadata": {
    "categories": {
      "llm": { "title": { "en": "LLM" } }
    }
  },
  "plugins": [
    {
      "name": "@danneleung/dsh-multi-key-rotation",
      "title": { "en": "Multi-Key Rotation", "zh": "多密钥轮换" },
      "description": { "en": "Quota-aware API-key rotation for DeepSeek Harness." },
      "author": "DanneLeung",
      "homepage": "https://github.com/DanneLeung/dsh-multi-key-rotation",
      "repository": {
        "url": "https://github.com/DanneLeung/dsh-multi-key-rotation"
      },
      "metadata": {
        "category": "llm",
        "keywords": ["dsh", "api-key", "rotation", "quota"]
      },
      "versions": [
        {
          "version": "1.0.0",
          "publishTimestamp": 1792000000,
          "source": {
            "type": "git",
            "url": "https://github.com/DanneLeung/dsh-multi-key-rotation",
            "commit": "0123456789abcdef0123456789abcdef01234567"
          },
          "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" }
        }
      ]
    }
  ]
}
```

The rules the market's own validator enforces, so a malformed index is
rejected with a JSON path:

- `format` is `1`, and `title` is present with an `en` entry.
- `name` is a valid npm package name — the market keys the plugin by it
  even when the source is Git.
- `metadata.category` must name a category the index itself declares in
  `metadata.categories`.
- `version` is an exact SemVer version, and `publishTimestamp` is Unix
  seconds.
- A `git` source needs `url` (a canonical https repository URL, at least two
  path segments), `commit` (a lowercase 40-hex-digit SHA), and optionally
  `path` for a package inside a larger repository.
- `engines.dsh` is a SemVer range without a `workspace:` prefix.
- An `icon` is either a base64 `data:` URL or an absolute https URL.

The same shape lists an npm-sourced plugin: replace the `source` object with
`{ "type": "npm" }`, and the market installs `name@version` from the
registry.

An `npm` entry whose package is **not** on npm cannot be installed, and a
Git entry whose repository is private needs the reader's own Git
credentials.

### Before you publish

The package ships ready to publish. Check these once:

| Where | What it holds now |
|---|---|
| `package.json` → `name` | `@danneleung/dsh-multi-key-rotation` |
| `package.json` → `author` | `DanneLeung` |
| `package.json` → `repository`, `homepage`, `bugs` | `github.com/DanneLeung/dsh-multi-key-rotation` |
| `LICENSE`, `NOTICE` | `Copyright (c) 2026 danneleung` |
| `locale/en.json`, `locale/zh.json` | the title and description the market shows |

Two things to check before you push:

- **The repository URL points at a repository that exists.** The market's
  detail page reads the README and the images beside it from that
  repository, so a URL that 404s leaves the entry without its pictures.
- **The scope exists on npm under your account.** The first publish to a new
  public scope creates it; if the scope name is taken by someone else, npm
  refuses the publish and the name has to change.
