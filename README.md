# 多密钥轮换 / Multi-Key Rotation

> `dsh-multi-key-rotation` — quota-aware API-key rotation for DeepSeek Harness. Give one LLM provider
> several API keys, let the plugin rotate between them automatically by
> remaining quota, and configure it all from a tab in the built-in Plugins
> settings section — without ever naming an environment variable by hand.

[![npm](https://img.shields.io/npm/v/@danneleung/dsh-multi-key-rotation?style=flat-square&color=4b6fff)](https://www.npmjs.com/package/@danneleung/dsh-multi-key-rotation)
[![DeepSeek Harness](https://img.shields.io/badge/deepseek--harness-v0.2.2--rc.3-263146?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)

---

## Table of contents

- [What it does](#what-it-does)
- [Why this exists](#why-this-exists)
- [Install](#install)
- [Configure](#configure)
- [How the pool works](#how-the-pool-works)
  - [The pool takes over the route](#the-pool-takes-over-the-route)
  - [The trigger — when the pool is walked](#the-trigger--when-the-pool-is-walked)
  - [The selection — which key the pool walks to](#the-selection--which-key-the-pool-walks-to)
  - [Remaining quota](#remaining-quota)
  - [Pinning a key](#pinning-a-key)
- [MiniMax Token Plan](#minimax-token-plan)
- [Interplay with `dsh-llm-retry`](#interplay-with-dsh-llm-retry)
- [Logs](#logs)
- [Telemetry](#telemetry)
- [Architecture](#architecture)
  - [Package layout](#package-layout)
  - [The Host half](#the-host-half)
  - [The browser half](#the-browser-half)
  - [The settings tab](#the-settings-tab)
- [Development](#development)
- [Packaging and distribution](#packaging-and-distribution)
  - [Build a distributable tarball](#build-a-distributable-tarball)
  - [Publish to npm](#publish-to-npm)
  - [Get listed in the plugin market](#get-listed-in-the-plugin-market)
  - [Distribute without npm](#distribute-without-npm)
    - [Option 1 — a Git repository](#option-1--a-git-repository-the-best-fit)
    - [Option 2 — a tarball](#option-2--a-tarball)
    - [Option 3 — a local directory](#option-3--a-local-directory)
    - [List it in a market index without npm](#list-it-in-a-market-index-without-npm)
  - [Before you publish](#before-you-publish)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## What it does

Give one provider several API keys — for example several **MiniMax Token
Plan** subscription keys — and the plugin keeps the provider working when one
of them runs out.

When a request fails because a key hit its plan quota, its quota, a rate
limit, or an auth error, the plugin writes the **next key of the pool** into
the provider's credential reference and retries the request. The turn
continues; nothing is lost and nothing restarts.

Three things make it more than a rotation loop:

1. **The pool takes over the route immediately.** You configured a pool, so
   the pool *is* the route's key — from the first request, not from the first
   failure.
2. **The next key is chosen by remaining quota.** The key whose weekly window
   resets soonest is spent first, so an allowance about to roll over is not
   wasted.
3. **You can see the quota.** Each key's remaining share is shown for both
   quota windows — the 5-hour one and the weekly one — next to its reset
   countdown.

## Why this exists

The rotation idea is not new — [`@m1khal3v/dsh-llm-key-rotation`][rotation]
already does it. What it asks of the user is the friction this plugin
removes:

| | key rotation | Multi-Key Rotation (this plugin) |
|---|---|---|
| Credential names | the user names `MINIMAX_CN_API_KEY_CHAIN_1`, `…_CHAIN_2` | the plugin owns the naming: `MINIMAX_CN_API_KEY_POOL_1`, `…_POOL_2` |
| Key names | invisible | every key gets a name you choose ("main", "backup-1") |
| Adding keys | one "Add key" → one "Save" per key | paste every key at once, one key per line |
| The key in use | invisible | shown as a masked stored key next to its pool slot |
| Who owns the route's key | the Models page | the plugin takes it over as soon as it loads |
| Picking the key yourself | not possible | a per-key button pins the key the provider starts with |
| Remaining quota | not shown | queried per key, for the 5-hour window and the weekly one |
| Switching | on failure only | on failure, and the next key is picked by reset order |
| MiniMax Token Plan | an HTTP 402 arrives as `PI_AI_ERROR` and rotates on nothing | a spent plan is recognized and rotates |

This plugin is an **independent work**. It takes the *idea* from the project
above, not its code. See [Acknowledgements](#acknowledgements).

## Install

### From npm

```sh
dsh plugin --profile <profile> add @danneleung/dsh-multi-key-rotation
```

### From the desktop app

**Plugins** → **Add plugin** → search the market for the package name, or
paste any of the specs listed under
[Distribute without npm](#distribute-without-npm).

### Without npm

The plugin also installs from a **Git repository**, a **tarball**, or a
**local directory** — no npm account or registry involved. See
[Distribute without npm](#distribute-without-npm) for the exact commands.

```sh
# a Git repository
dsh plugin --profile <profile> add git+https://github.com/danneleung/dsh-multi-key-rotation.git

# a local directory — the path must be absolute
dsh plugin --profile <profile> add D:/path/to/dsh-multi-key-rotation
```

The plugin depends only on `@deepseek-ai/schemastery` (a pure schema
library). It deliberately does **not** depend on
`@deepseek-ai/dsh-credentials`: that package pulls the whole Cordis runtime
in behind it, and a second copy of Cordis inside the plugin would be a second
set of runtime identities. The credential-reference check is three characters
of regular expression, so the plugin keeps it to itself.

## Configure

**Settings** → **Plugins** → **Multi-Key Rotation** (「多密钥轮换」): the plugin's configuration is a
tab of the built-in Plugins settings section, beside the shipped **Plugin
list** tab. Every provider that has keys gets one card.

A card whose provider has **no configured pool** starts collapsed: it holds
an empty key list and a policy that does nothing, so there is nothing to
read until you open it. A provider that already holds a key opens straight
away. Clicking a card's title folds it away or opens it again, and your
choice sticks for as long as the page is open.

1. Open a provider's card.
2. Add keys. Give a key a name and paste its value, then press **Add key**;
   or press **Add several at once** and paste one key per line.
3. Read each key's quota next to it: the **5-hour** window and the **weekly**
   window, each with its bar and its countdown to the reset. Press
   **Refresh usage** to ask the provider again.
4. Press **★** on a key to make it the one the provider starts with.
5. Pick the failure codes that should trigger a switch. **Plan quota used up**
   is the MiniMax Token Plan code; **Quota exceeded**, **Rate limited** and
   **Auth failed** are the generic ones.
6. Pick the switching policy (see below).
7. Toggle the provider's switch on, then press **Save**.

Key values are stored in the Harness credential store, never in the profile
configuration. The plugin writes the pool configuration — provider flags,
trigger codes, the named keys, the pinned key, and the policy — to the
`llm-key-pool:` settings section.

## How the pool works

### The pool takes over the route

A provider route authenticates through **one** credential reference — for
`minimax-cn` that is `MINIMAX_CN_API_KEY` — and the Harness resolves that
reference on every request. The pool's own keys live in their own references
(`MINIMAX_CN_API_KEY_POOL_1`, `…_POOL_2`, `…_POOL_3`), so out of the box the
route would keep authenticating with whatever key **Settings → Models**
stores, and the pool would only take over after the first failure.

That is the wrong default. A pool the user configured is meant to **be** the
route's key. So as soon as the plugin loads — and again whenever the settings
change — the pool writes its own choice into the route's reference:

- the write goes to the **credential reference**, not to the profile. The
  route keeps naming `MINIMAX_CN_API_KEY`; the pool keeps that reference
  pointing at whichever key it wants to use. The Models page is untouched.
- the choice is made by the **reset order** described below, so the key the
  pool starts with is the same key the pool would pick on a failure.
- the write is **idempotent**: when the reference already holds the chosen
  key, nothing is written and nothing is logged.
- a **disabled** pool, or a pool with **no stored key**, writes nothing and
  the route keeps its own key.

From the first request onward, the requests authenticate with a pool key. The
log line says so:

```text
[llm-key-pool] activated provider="minimax-cn" key→"primary" (50%)
```

### The trigger — when the pool is walked

The key in use stays in use until it **fails**. The plugin does not move the
pool on its own: a failure with a trigger code is what starts the walk. The
request is then retried with the new key.

### The selection — which key the pool walks to

When the pool is searched for the key to move to, the plugin uses the key
whose **weekly window resets soonest**, and among those the key whose
**5-hour window resets soonest**.

The reason is that the weekly allowance is the scarcer resource. A key whose
week is about to roll over becomes a fresh key, so it is spent now, while a
key whose week still has time keeps its allowance for later. The 5-hour
window only breaks the tie between keys whose weeks end at the same moment.

The key that just failed is left out of the search — it is the key that did
not work.

Two settings shape the search:

- **Rest below** (`thresholdPercent`) — a key whose remaining share is below
  this percentage *rests*: it is not chosen for routine requests. It becomes
  eligible again automatically once its **weekly** window resets, so a spent
  week costs you one window, not the whole plan. `0` never rests a key.
- **Reserve above** (`reservePercent`) — a key holding more than this share is
  held back for the failure path, so the routine path cannot spend the last
  healthy key and leave nothing to fall back to.

The remaining share a key reports is the **weakest** of its windows: the
5-hour window and the weekly window. A key with a full week but no 5-hour
headroom is not usable now, and a key with 5-hour headroom but an exhausted
week is not usable for long.

A key that rests is skipped while another key is available. When every key
rests, the pool is used anyway rather than failing the request outright.

### Remaining quota

MiniMax publishes the remaining quota of a Token Plan key at
`GET /v1/token_plan/remains`, answering per key (the key's own value is the
bearer token). The plugin probes that endpoint **on the Host**, where the key
values live, and caches each answer for 45 seconds.

The browser only ever sees the remaining percentage and the reset moments —
never a key. The card shows a line per window, one for the **5-hour** window
and one for the **weekly** window, each with its own bar and its own countdown
to the reset, and **Refresh usage** forces a fresh probe.

The key list is ordered by the **weekly remaining time**, ascending: the key
whose week rolls over soonest is listed first, because that is the key the
switching policy spends first. A key with no weekly quota known keeps its
slot order and sorts after the ones that do.

The probe runs for MiniMax routes only (`minimax` and `minimax-cn`); every
other provider has no quota endpoint and is skipped.

### Pinning a key

Each key row carries a **★** button. Clicking it pins that key as the one
the provider should use: the plugin writes the pin into the profile, and the
activation that follows moves the route to it. The pinned key shows an **In
use** badge in its place, so the row tells you which key is in charge.

The pin is a **preference, not a lock**:

- The plugin starts on the pinned key, and the routine path returns to it.
- A failure still rotates away from it — the pool never sits on a key that
  does not work.
- Clicking the pinned key again unpins it, and the pool goes back to picking
  by its own rules.

The pin is stored as a **reference**, not as a name, so it survives a rename
and a value change.

## MiniMax Token Plan

MiniMax reports a spent plan as HTTP **402** with body code `2067`
("套餐额度已用完"), and an exhausted window as HTTP **429** with code `2056`
("超出 M Plan 资源限制"). The pi-ai adapter classifies a bare HTTP 402 as
`PI_AI_ERROR`, which no provider profile would ever list — so without special
handling a spent plan rotates on nothing and the turn simply fails.

This plugin recognizes those provider signatures and reports them as the
`TOKEN_PLAN` trigger code, which the card offers as **Plan quota used up**.
Listing it makes a MiniMax Token Plan key pool rotate on a spent plan, a
spent credit balance, and an exceeded plan window alike.

The `TOKEN_PLAN` code is this plugin's own: the adapter never raises it. A
profile that does not list it behaves exactly like a generic rotation setup.

## Interplay with `dsh-llm-retry`

`dsh-llm-retry` owns the provider's retry policy and runs **before** this
plugin in the recovery waterfall.

- `TOKEN_PLAN`, `QUOTA` and `AUTH` are not in `dsh-llm-retry`'s default
  `retryableCodes`, so retry delegates immediately and the pool rotates at
  once.
- `RATE_LIMIT` **is** in the default set, so retry handles it first. Remove
  `RATE_LIMIT` from the provider's `retryPolicy.retryableCodes` to rotate on
  a rate limit immediately.

## Logs

The activation is logged too, so a pool that took over a route says so:

```text
[llm-key-pool] activated provider="minimax-cn" key→"primary" (50%)
```

Every rotation, delegation and pool reset is printed to the launching
terminal:

```text
[llm-key-pool] rotated provider="minimax-cn" pool[0]→"MINIMAX_CN_API_KEY" (TOKEN_PLAN) window=fresh-start lastWriteAge=–
```

No key value is ever logged — only provider names, slot indices, reference
names and failure codes.

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

## Architecture

### Package layout

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

### The Host half

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

### The browser half

`client.js` is a browser module loaded through `window.__ModuleLoader__`. It
registers one cell in the `settings.plugins.tab` slot and renders the
configuration page. It never sees a key value: it reads quota through the
Host route above and writes key values through `ctx.remote.credentials`.

### The settings tab

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

---

## Development

```sh
npm install
npm test          # Host + browser tests
```

The browser half is a plain ESM module with no bundler, so the browser tests
run on Node's own test runner with a small harness in `test/client-harness.cjs`.

## Packaging and distribution

### Build a distributable tarball

The package has no build step, so "building" is packing. From the package
directory:

```sh
npm pack
```

That writes `danneleung-dsh-multi-key-rotation-1.0.0.tgz` — the exact artifact npm
serves. Inspect it before shipping it:

```sh
npm pack --dry-run
```

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
the first publish to a new scope creates it.

To unpublish within the first 72 hours, `npm unpublish` works. After that
npm keeps the name retired — publish a new version instead of recycling the
name.

### Get listed in the plugin market

The plugin market's catalog is the
[`awesome-dsh-plugin`][awesome] registry. The market app itself is **not**
where plugin entries live — its README says so explicitly: *"This repo is the
market app, not the catalog. To get your plugin listed in the market, open a
PR there."*

So, to be listed:

1. Publish the package to npm first. The registry entry names the npm
   package, and the market installs by npm name.
2. Open a pull request against
   [`awesome-dsh-plugin/awesome-dsh-plugin`][awesome-repo] adding one entry
   for your package. The site and the market pick the change up
   automatically, usually within a day.
3. Users then add the market's index as a source —
   **Plugins** → **Discover** → **Index sources** →
   `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` — and the
   package appears in Discover and in the `plugin_market` agent tool.

The entry needs at least an npm name and a category; the registry's
`validate-registry` script is the authority on the exact shape, and the
market rejects an entry with no usable category.

A market entry does **not** have to come from npm. The index format lets a
version name a Git commit instead, and the market then installs that commit.
See [List it in a market index without npm](#list-it-in-a-market-index-without-npm).

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
| Git URL | `git+https://github.com/danneleung/dsh-multi-key-rotation.git` | Also `git://…`, `git@host:owner/repo.git`, or `https://host/owner/repo`. |
| Git shorthand | `github:danneleung/dsh-multi-key-rotation` | `github:`, `gitlab:`, `bitbucket:`, `gist:` are understood. |

#### Option 1 — a Git repository (the best fit)

Put the package in a Git repository and let people install a commit:

```sh
dsh plugin --profile <profile> add git+https://github.com/danneleung/dsh-multi-key-rotation.git
```

or, in the desktop app, **Plugins** → **Add plugin** and paste the same
string.

This is the form that keeps working without any account: the repository is
the source of truth, and a commit SHA pins an exact state of it. To pin one
commit, append `#<sha>`; to install a package that lives in a subdirectory of
a larger repository, append `&path:/<directory>`:

```sh
# one exact commit
dsh plugin --profile <profile> add "git+https://github.com/danneleung/dsh-multi-key-rotation.git#<40-hex-sha>"

# a package inside a monorepo
dsh plugin --profile <profile> add "git+https://github.com/danneleung/my-monorepo.git#<40-hex-sha>&path:/packages/dsh-multi-key-rotation"
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
      "author": "danneleung",
      "homepage": "https://github.com/danneleung/dsh-multi-key-rotation",
      "repository": {
        "url": "https://github.com/danneleung/dsh-multi-key-rotation"
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
            "url": "https://github.com/danneleung/dsh-multi-key-rotation",
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
| `package.json` → `author` | `danneleung` |
| `package.json` → `repository`, `homepage`, `bugs` | `github.com/danneleung/dsh-multi-key-rotation` |
| `LICENSE`, `NOTICE` | `Copyright (c) 2026 danneleung` |
| `locale/en.json`, `locale/zh.json` | the title and description the market shows |

Two things to check before you push:

- **The repository URL points at a repository that exists.** The market's
  detail page reads the README and the images beside it from that
  repository, so a URL that 404s leaves the entry without its pictures.
- **The scope exists on npm under your account.** The first publish to a new
  public scope creates it; if the scope name is taken by someone else, npm
  refuses the publish and the name has to change.

The `dsh-multi-key-rotation` **runtime** identifiers do **not** change when you
rebrand: the settings namespace `llm-key-pool`, the route
`/llm-key-pool/api/health`, the log tag `[llm-key-pool]` and the credential
reference family `*_API_KEY_POOL_<n>` are stored in users' profiles and in
credential references. Renaming them would silently break every existing
installation. Only the package identity — the npm name, the bundle entry
name, the patch row and the settings-tab id — is yours to change.

---

## Acknowledgements

This plugin was inspired by
[`@m1khal3v/dsh-llm-key-rotation`][rotation] by **Anton Mikhalev**
(MIT licensed). `dsh-multi-key-rotation` is an **independent work**: it contains
no source code from that project. What it takes is the *idea* of rotating
between several API keys of one LLM provider when a quota is exhausted.

The full attribution, including the original MIT license text, is in the
[`NOTICE`](NOTICE) file shipped with this package.

[rotation]: https://github.com/m1khal3v/dsh-llm-key-rotation
[awesome]: https://awesome-dsh-plugin.com
[awesome-repo]: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin

## License

MIT — see [`LICENSE`](LICENSE).
