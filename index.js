/**
 * Seamless API-key rotation across a pool of named keys for one LLM provider.
 *
 * Mounts a listener on the agent loop's `agent/request-error` recovery
 * waterfall. When a model request for a configured provider fails with a
 * trigger code the pool profile lists (typically an exhausted MiniMax Token
 * Plan quota, a rate limit, or an auth failure), the plugin writes the next
 * key of that provider's pool into the credential reference the adapter reads
 * and returns `{ kind: 'retry' }`, so the loop opens a fresh turn that
 * authenticates with the rotated key — no restart, no model-visible surface.
 * Adapters resolve the credential reference once per request, which is what
 * makes the rotation reach the very next request.
 *
 * ## Configuration
 *
 * Configuration carries only provider flags, key *names*, and credential
 * *references* — never key values. Each profile is
 * `{ enabled, rotateOn, keys, policy }` keyed by provider route id:
 *
 *   - `keys` — the named pool. Every entry is `{ name, ref, enabled }`. The
 *     name is what the user chose ("main", "backup-1") and what the card
 *     shows; the reference is derived by this plugin as
 *     `<ROUTE>_API_KEY_POOL_<n>` and is never shown.
 *   - `policy` — the switching policy. The TRIGGER decides when the pool
 *     is walked: `failure` rotates only when a request fails, `remaining`
 *     also rotates *before* a request. The SELECTION decides which key the
 *     pool walks to, and it is the same in both modes: the key whose 5-hour
 *     window resets soonest, and among those the one whose weekly window
 *     resets soonest. A key below `thresholdPercent` rests until its weekly
 *     window resets.
 *
 * Key values live in the credential store, written by the web settings card
 * through `ctx.remote.credentials`.
 *
 * ## Remaining amount
 *
 * MiniMax publishes the remaining quota of a Token Plan key at
 * `GET /v1/token_plan/remains`. The plugin probes that endpoint per key (the
 * key's own value is the bearer token), caches the answer, and reduces it to
 * the remaining share plus the weekly reset moment. The card shows both, so
 * the user can see which key is nearly spent before the pool has to find out
 * the hard way.
 *
 * ## Activation
 *
 * A provider route authenticates through ONE credential reference — for
 * `minimax-cn` that is `MINIMAX_CN_API_KEY` — and the adapter resolves that
 * reference on every request. The pool's own keys live in their own
 * references, so without a write the route would keep authenticating with
 * whatever key `Settings → Models` stores, and the pool would only take
 * over after a failure.
 *
 * A configured pool is meant to BE the route's key, so the plugin writes its
 * own choice into the route's reference as soon as it loads, and again
 * whenever the settings change. The choice is made by the reset order, the
 * same rule the failure path uses. The write is idempotent, and a disabled
 * pool — or one with no stored key — writes nothing, leaving the route its
 * own key.
 *
 * ## The switch
 *
 * The switch has two halves, and they are separate:
 *
 *   - The TRIGGER is the failure. The key in use stays in use until it fails;
 *     the plugin does not move the pool on its own.
 *   - The SELECTION is the RESET ORDER. When the pool is searched for the key
 *     to move to, the key whose WEEK rolls over SOONEST comes first, and
 *     among those the one whose 5-hour window resets soonest. The weekly
 *     allowance is the scarcer resource: a key whose week is about to roll
 *     over becomes a fresh key, so it is drained now, while a key whose week
 *     still has time keeps its allowance for later.
 *
 * ## Walk discipline
 *
 * Keyed to the last write timestamp, so the pool never spins forever:
 *   - A failure arriving within {@link POOL_WINDOW_MS} of the last write
 *     searches the pool for a key that has not been tried in this window.
 *   - A failure arriving {@link POOL_WINDOW_MS} or more after the last write
 *     starts again with the whole pool — a key that failed an hour ago may
 *     work now.
 *   - With no stored pool key (or a disabled provider), the failure is handed
 *     to downstream recovery immediately. Once every pool key has been
 *     written within one window and a failure still arrives, the plugin
 *     delegates rather than spinning forever.
 *
 * The route's own reference is never restored after success: it keeps the last
 * written (working or last-tried) key.
 *
 * ## MiniMax Token Plan
 *
 * MiniMax reports an exhausted Token Plan as HTTP 402 with body code `2067`
 * ("套餐额度已用完"), and an exhausted window as HTTP 429 with code `2056`
 * ("超出 M Plan 资源限制"). The pi-ai adapter classifies a bare HTTP 402 as
 * `PI_AI_ERROR`, which no pool profile would list, so this plugin recognizes
 * the provider's own signature codes and reports them as {@link TOKEN_PLAN_CODE}.
 *
 * Every rotation, delegation, and pool reset is logged to stdout through
 * `console.log`/`console.error` with a `[llm-key-pool]` tag, so operation is
 * confirmable by watching the launching process's terminal. No key values are
 * ever logged. (`ctx.logger` is intentionally not used for these: in the dsh
 * web build it only buffers and never prints to the terminal.)
 *
 * @module dsh-multi-key-rotation
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import {
  applyReserve, clampPercent, credentialRef, envRefOf, fetchRemains, overallRemainingPercent,
  intervalRemainingPercent, intervalResetAt, isResting, isSupportedProvider, poolEntrySchema,
  policySchema, quotaSummaryOf, regionOfProvider, pickNextKey, rankByResetOrder, selectKey,
  weeklyRemainingPercent, weeklyResetAt, QUOTA_TTL_MS,
} from './src/pool.js'

/** Plugin name and the settings namespace this plugin owns. */
export const name = 'llm-key-pool'

/**
 * Services this plugin needs.
 *
 * `webServer` and `connection` are declared here, at the top level, because a
 * nested `ctx.inject([...], …)` can only reach a service the parent context
 * already holds. Declaring them here is what makes the quota route exist at
 * all; a nested injection of a service the plugin does not declare never
 * fires.
 */
export const inject = ['agents', 'credentials', 'webServer', 'connection']

/** The settings namespace owned by this plugin (the Loader entry id). */
export const NS = 'llm-key-pool'

/**
 * Failure code this plugin reports for a provider's own quota signature (for
 * example MiniMax's `2067` "plan quota used up" on HTTP 402). It is not a
 * `BuiltinLlmFailureCode`: the adapter never raises it, this plugin derives
 * it, and a profile opts into it by listing it among `rotateOn`.
 */
export const TOKEN_PLAN_CODE = 'TOKEN_PLAN'

/**
 * Default rotating codes when a profile omits `rotateOn`. `QUOTA` and `AUTH`
 * reach this plugin immediately because `dsh-llm-retry` does not retry them by
 * default and delegates via `next()`. `RATE_LIMIT` IS in `llm-retry`'s default
 * `retryableCodes`, so it is intercepted first; include it only if the
 * provider profile removes `RATE_LIMIT` from `retryPolicy.retryableCodes`.
 */
export const DEFAULT_ROTATE_ON = Object.freeze(['TOKEN_PLAN', 'QUOTA', 'AUTH'])

/**
 * Every trigger code a pool profile may name, in the order the settings card
 * offers them. `TOKEN_PLAN` comes first because it is the code a MiniMax
 * Token Plan actually reaches this plugin with.
 */
export const ROTATE_ON_CODES = Object.freeze([
  TOKEN_PLAN_CODE,
  'QUOTA',
  'RATE_LIMIT',
  'AUTH',
])

/** How long a key write stays "fresh": failures within this window continue the pool. */
export const POOL_WINDOW_MS = 300_000

/**
 * Provider-specific quota signatures this plugin recognizes.
 *
 * MiniMax returns an HTTP 402 whose body carries `2067` ("套餐额度已用完",
 * plan quota used up) and an HTTP 429 whose body carries `2056` ("超出 M Plan
 * 资源限制", M Plan resource limit exceeded). Neither wording matches the
 * adapter's generic quota classifier, so a 402 would otherwise arrive as
 * `PI_AI_ERROR` and rotate on nothing.
 */
const PROVIDER_QUOTA_SIGNATURES = Object.freeze([
  {
    provider: /^minimax(-cn)?$/,
    codes: ['2056', '2053', '2062', '2067'],
    pattern: /(?:token\s+plan|m\s*plan)[^]{0,80}?(?:usage\s+limit|limit\s+reached|配额|用量上限|超出)/i,
  },
])

/**
 * Decide whether one failure is a provider's own quota signal.
 * @param provider - provider route id whose failure is examined.
 * @param failure - the normalized failure the adapter reported.
 * @returns true when the failure names the provider's quota exhaustion.
 */
export function isProviderQuotaFailure(provider, failure) {
  if (failure === undefined || failure === null) return false
  const detail = `${failure.message ?? ''} ${failure.code ?? ''}`
  for (const signature of PROVIDER_QUOTA_SIGNATURES) {
    if (!signature.provider.test(provider)) continue
    for (const code of signature.codes) {
      if (detail.includes(code)) return true
    }
    if (signature.pattern.test(detail)) return true
  }
  return false
}

/**
 * One provider route's pool profile.
 *
 * Every field here must accept whatever the settings card can produce. The
 * card lets the user switch off every trigger chip, so `rotate_on` may be
 * empty — a schema that rejects an empty list would make the Loader's
 * `resolveConfig` throw, which fails the entry's activation and takes the
 * whole profile reload down with it.
 */
const profileSchema = z.object({
  enabled: z.boolean().default(false),
  /** Trigger codes; an empty list means "never rotate on a failure". */
  rotate_on: z.array(z.string().default('')).default([...DEFAULT_ROTATE_ON]),
  /** The named pool of keys. */
  keys: z.array(poolEntrySchema(z)).default([]),
  /**
   * The key the user pinned as the one to use.
   *
   * The pin is a REFERENCE, so it survives a rename and a value change. An
   * empty pin means "no key is pinned" and the pool picks by its own rules.
   */
  pinned_ref: z.string().default(''),
  /** When the pool is walked. */
  policy: policySchema(z).default({}),
})

/**
 * Plugin config, also the `llm-key-pool` settings-section shape. The
 * `providers` field is volatile so the settings form can replace it live
 * without restarting the plugin; read it through `config.providers.get()`.
 *
 * The dict is deliberately permissive: an unknown provider entry is kept as
 * plain data instead of failing validation, because a schema rejection here
 * poisons the Loader's raw config and breaks every later activation of this
 * entry.
 */
export const Config = z.object({
  providers: z.dict(z.union([profileSchema, z.any()])).default({}).volatile(),
})

/**
 * Read the live provider profiles out of the plugin's config.
 *
 * The `providers` field is volatile, so its value is reached through a
 * `.get()` accessor that a hostile or half-written configuration can make
 * throw — a `TypeError` from a missing accessor, a `ValidationError` from a
 * value the schema rejects. This reader runs inside the `agent/request-error`
 * and `llm/stream` waterfalls, where a throw would abort the agent loop and
 * take the host down with it, so every failure degrades to "no profiles"
 * instead of propagating.
 *
 * Only **supported** routes survive the filter. A profile of an unsupported
 * route is ignored completely — it is never activated, never probed, and never
 * written into the route's credential reference — so a configuration left
 * over from a wider build cannot quietly take over a route this release does
 * not understand.
 * @returns the provider profiles, or an empty object.
 */
function readProfiles(config) {
  try {
    const field = config?.providers
    if (field === undefined || field === null) return {}
    const value = typeof field.get === 'function' ? field.get() : field
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const out = {}
    for (const [provider, profile] of Object.entries(value)) {
      if (isSupportedProvider(provider)) out[provider] = profile
    }
    return out
  } catch (error) {
    console.error('[llm-key-pool] the provider profiles could not be read; continuing without them')
    console.error(error)
    return {}
  }
}

/**
 * One provider route's profile, normalized into the shape the plugin reads.
 * A profile the configuration stores in an unexpected shape is treated as
 * "disabled with no keys" rather than as an error.
 * @param profiles - every provider profile.
 * @param provider - the provider route id.
 * @returns the normalized profile.
 */
function profileOf(profiles, provider) {
  const raw = profiles[provider]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { enabled: false, rotate_on: [], keys: [], pinned_ref: '', policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 } }
  }
  const rotateOn = Array.isArray(raw.rotate_on) ? raw.rotate_on.filter((code) => typeof code === 'string') : []
  const keys = Array.isArray(raw.keys)
    ? raw.keys
      .filter((entry) => typeof entry === 'object' && entry !== null && typeof entry.ref === 'string' && entry.ref.length > 0)
      .map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : '',
        ref: entry.ref,
        enabled: entry.enabled !== false,
      }))
    : []
  const policy = typeof raw.policy === 'object' && raw.policy !== null ? raw.policy : {}
  return {
    enabled: raw.enabled === true,
    rotate_on: rotateOn,
    keys,
    pinned_ref: typeof raw.pinned_ref === 'string' ? raw.pinned_ref : '',
    policy: {
      mode: policy.mode === 'remaining' ? 'remaining' : 'failure',
      thresholdPercent: clampPercent(policy.thresholdPercent),
      reservePercent: clampPercent(policy.reservePercent),
    },
  }
}

/**
 * Install the key pool. Each provider profile owns its `enabled` flag, its
 * `rotateOn` codes, its named `keys`, and its switching `policy`; the key
 * values live in the credential store. Failures of a rotation are logged and
 * delegated, never fatal — a rotation that cannot write a value hands the
 * failure to downstream recovery rather than crashing the loop.
 * @param ctx - plugin context carrying the agent registry and credential seam.
 * @param config - composition entry config; the `llm-key-pool:` settings section overrides it live.
 */
export function apply(ctx, config) {
  const profiles = () => readProfiles(config)

  // The settings service refuses a second presentation for the same plugin
  // instance. A re-activation (a profile reload after a settings write) must
  // not turn that refusal into a startup failure, so the refusal is expected
  // and only logged.
  ctx.inject(['settings'], (child) => {
    child.effect(() => {
      try {
        return child.settings.configure({ auto: false }, ctx.fiber)
      } catch (error) {
        console.error('[llm-key-pool] the settings presentation was already configured for this plugin instance')
        console.error(error)
        return undefined
      }
    })
  })

  /** Resolve one credential reference to its stored value, or `undefined` when unset. */
  const resolveRef = async (ref) => {
    try {
      return (await ctx.credentials.resolve(credentialRef(ref)))?.value
    } catch (error) {
      console.error('[llm-key-pool] the credential "%s" could not be resolved', ref)
      console.error(error)
      return undefined
    }
  }

  /**
   * The cached state of one provider: the key values of its pool, the probed
   * quota of each, and the rotation walk.
   */
  const providers = new Map()

  /** The live state of one provider, created on first use. */
  const stateOf = (provider) => {
    let state = providers.get(provider)
    if (state === undefined) {
      state = {
        values: new Map(),
        quotas: new Map(),
        quotaFetchedAt: new Map(),
        /**
         * The value the route's own reference holds right now. It is the
         * pool slot currently in use, remembered so the policy can recognise
         * it: the routine path leaves the credential alone when the chosen
         * key is this one, and the failure path leaves it out of the
         * search because it is the key that did not work.
         */
        currentValue: undefined,
      }
      providers.set(provider, state)
    }
    return state
  }

  /** Refresh the cached key values of one provider from its pool references. */
  const refreshValues = async (provider, profile) => {
    const state = stateOf(provider)
    const values = new Map()
    for (const entry of profile.keys) {
      values.set(entry.ref, await resolveRef(entry.ref))
    }
    state.values = values
  }

  /** Refresh the cached key values of all providers. */
  const refreshAllValues = async () => {
    const all = profiles()
    for (const provider of Object.keys(all)) {
      await refreshValues(provider, profileOf(all, provider))
    }
  }

  // The pool takes over its provider's requests as soon as it loads: the
  // route's reference is pointed at a pool key, so the pool — not the key
  // stored in Settings → Models — is what authenticates the requests. The
  // refresh comes first, because the activation needs the key values.
  void refreshAllValues().then(() => activateAllPools())

  const states = new Map()

  /**
   * The rotation walk state of one provider.
   *
   * The walk is no longer positional: the next key is chosen by the reset
   * order, so the state remembers WHICH keys have already been tried inside
   * the window rather than at which index the walk stands. The remembered
   * keys are what stops the pool from handing out the same failing key
   * again and again.
   */
  const getState = (provider) => {
    let state = states.get(provider)
    if (state === undefined) {
      state = {
        tried: [],
        lastWriteAt: undefined,
        rotationId: randomUUID(),
        chain: Promise.resolve(undefined),
      }
      states.set(provider, state)
    }
    return state
  }

  ctx.on('credentials/reference-updated', (ref) => {
    const refStr = String(ref)
    const all = profiles()
    for (const provider of Object.keys(all)) {
      const profile = profileOf(all, provider)
      if (profile.keys.some((entry) => entry.ref === refStr)) void refreshValues(provider, profile)
    }
  })

  ctx.on('settings/document-updated', (ns) => {
    if (ns !== NS) return
    // A settings change may have enabled a pool, added a key, or emptied
    // one. The values are refreshed first and the pool is then put in
    // charge again, so the route follows the configuration without a
    // restart.
    void refreshAllValues().then(() => activateAllPools())
  })

  /**
   * The candidates of one provider's pool, with their values and quotas.
   *
   * A parked key (`enabled: false`) is stored but never written into the
   * route's reference, so it is not a candidate: the failure walk and the
   * remaining policy both skip it.
   */
  const candidatesOf = (provider, profile) => {
    const state = stateOf(provider)
    return profile.keys
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        name: entry.name,
        ref: entry.ref,
        enabled: entry.enabled,
        value: state.values.get(entry.ref),
        quota: state.quotas.get(entry.ref),
      }))
      .filter((candidate) => candidate.value !== undefined && candidate.value.length > 0)
  }

  /**
   * The candidates of one provider's pool, resolving the values that are
   * not cached yet.
   *
   * The cached values are filled in when the plugin loads and whenever a
   * credential reference changes, but that refresh is asynchronous: a
   * failure arriving before it finished would find an empty pool and
   * delegate, even though the keys are there. The missing values are
   * resolved here instead.
   * @param provider - provider route id.
   * @param profile - the provider's profile.
   * @returns the candidates, with their values and quotas.
   */
  const candidatesWithValues = async (provider, profile) => {
    const state = stateOf(provider)
    const missing = profile.keys.filter((entry) => entry.enabled && state.values.get(entry.ref) === undefined)
    for (const entry of missing) {
      const value = await resolveRef(entry.ref)
      if (value !== undefined) state.values.set(entry.ref, value)
    }
    return candidatesOf(provider, profile)
  }

  /**
   * Probe the remaining quota of one provider's keys.
   *
   * The probe is per key — MiniMax answers the quota endpoint per key, so
   * the remaining share of each key is knowable. Answers are cached for
   * {@link QUOTA_TTL_MS}; a provider with no quota endpoint is skipped.
   * @param provider - provider route id.
   * @param force - ignore the cache.
   * @returns the probed quota of every key, by reference.
   */
  const probeQuotas = async (provider, force = false) => {
    const all = profiles()
    if (all[provider] === undefined) return undefined
    const profile = profileOf(all, provider)
    const region = regionOfProvider(provider)
    if (region === undefined) return undefined
    const state = stateOf(provider)
    const now = Date.now()
    const stale = profile.keys.filter((entry) => {
      if (force) return true
      const fetchedAt = state.quotaFetchedAt.get(entry.ref) ?? 0
      return now - fetchedAt >= QUOTA_TTL_MS
    })
    if (stale.length === 0) return state.quotas
    await Promise.all(stale.map(async (entry) => {
      const value = state.values.get(entry.ref)
      if (value === undefined || value.length === 0) return
      try {
        const payload = await fetchRemains(region, value)
        state.quotas.set(entry.ref, quotaSummaryOf(payload, now))
      } catch (error) {
        state.quotas.set(entry.ref, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      state.quotaFetchedAt.set(entry.ref, now)
    }))
    return state.quotas
  }

  /**
   * The health of one provider's pool, as the settings card shows it.
   *
   * Each key carries a PREVIEW: the first and last characters of the
   * stored value in plaintext, with the middle hidden. Two keys of the
   * same provider usually differ only in those characters, so the
   * preview is what lets the user tell them apart. The Host computes it
   * because the Host holds the values; the browser never sees one.
   *
   * The keys come back in RESET ORDER — the same order the pool is
   * searched in when it picks the next key: the key whose WEEK rolls over
   * soonest first, and the 5-hour window breaking the tie. A key whose
   * reset moment is unknown sorts last.
   *
   * The settings page is unaffected by that order: it looks each key's
   * usage up BY ITS REFERENCE.
   * @param provider - provider route id.
   * @returns the per-key preview, remaining share, and reset moment.
   */
  const poolHealth = (provider) => {
    const all = profiles()
    if (all[provider] === undefined) return []
    const profile = profileOf(all, provider)
    const state = stateOf(provider)
    const entries = profile.keys.map((entry) => {
      const quota = state.quotas.get(entry.ref)
      const value = state.values.get(entry.ref)
      return {
        entry,
        quota,
        health: {
          name: entry.name,
          ref: entry.ref,
          enabled: entry.enabled,
          configured: value !== undefined,
          preview: previewOf(value),
          // Whether the user pinned this key, and whether it is the one the
          // route is authenticating with right now.
          pinned: entry.ref === profile.pinned_ref,
          current: value !== undefined && value === state.currentValue,
          quotaOk: quota?.ok === true,
          quotaError: quota?.ok === false ? quota.error : undefined,
          planName: quota?.planName,
          remainingPercent: overallRemainingPercent(quota),
          // Both windows, separately: the 5-hour window says how long the key
          // can keep going, the weekly window says how much of the week's
          // allowance is left. The card shows both, because the switching
          // policy compares them.
          intervalRemainingPercent: intervalRemainingPercent(quota),
          intervalResetAt: intervalResetAt(quota),
          weeklyRemainingPercent: weeklyRemainingPercent(quota),
          weeklyResetAt: weeklyResetAt(quota),
        },
      }
    })
    // The order the pool is used in: the key whose week rolls over soonest
    // comes first, and the 5-hour window breaks the tie.
    return rankByResetOrder(entries).map((ranked) => ranked.health)
  }

  /**
   * A plaintext head and tail of one key, with the middle hidden.
   *
   * The head and the tail are what distinguish two keys of the same
   * provider, so both are shown in plaintext. A key too short to hide
   * at least eight characters in the middle is not previewed at all:
   * showing it would reveal too much of it.
   * @param value - the stored key value, or undefined.
   * @returns the preview, or undefined when there is nothing to show.
   */
  const previewOf = (value) => {
    if (typeof value !== 'string' || value.length === 0) return undefined
    const chars = Array.from(value)
    const head = 8
    const tail = 4
    const hidden = chars.length - head - tail
    if (hidden < 8) return undefined
    return `${chars.slice(0, head).join('')}${'•'.repeat(hidden)}${chars.slice(-tail).join('')}`
  }

  /**
   * Write one key into the route's own reference.
   * @param provider - provider route id.
   * @param value - the key value to write.
   * @param reason - why the write happens, for the log line.
   * @returns true when the write landed.
   */
  const writeKey = async (provider, value, reason) => {
    const toRef = envRefOf(provider)
    try {
      await ctx.credentials.set(credentialRef(toRef), value)
    } catch (error) {      console.error('[llm-key-pool] could not write rotated key to "%s" for provider "%s"; delegating', toRef, provider)
      console.error(error)
      return false
    }
    // Remember what the route's reference now holds. Without this the
    // `remaining` policy cannot tell that the key it would choose is already
    // the key in use, and would rewrite the credential on every request.
    stateOf(provider).currentValue = value
    console.log('[llm-key-pool] provider="%s" key→"%s" (%s)', provider, toRef, reason)
    return true
  }

  /**
   * Put the pool in charge of a provider's requests.
   *
   * A provider route authenticates through ONE reference — for
   * `minimax-cn` that is `MINIMAX_CN_API_KEY` — and the adapter resolves
   * that reference on every request. The pool's own keys live in their own
   * references, so without a write the route would keep authenticating with
   * whatever key `Settings → Models` stores, and the pool would only ever
   * take over after a failure. That is the wrong default: a pool the user
   * configured is meant to BE the route's key.
   *
   * So the pool writes its own choice into the route's reference. Which key
   * it writes is decided the same way the pool decides everything else: the
   * key whose WEEK rolls over soonest, and among those the one whose 5-hour
   * window resets soonest. A key that is resting below the threshold is
   * skipped while another key is available.
   *
   * The write is idempotent: when the route's reference already holds the
   * chosen key's value, nothing is written. That matters because the
   * activation runs on every settings change, and a needless write would
   * churn the credential store and log a rotation that never happened.
   *
   * The reference is written, not the profile: the route keeps naming
   * `MINIMAX_CN_API_KEY`, and the pool simply keeps that reference
   * pointing at whichever key it wants to use. The profile's own
   * `apiKeyEnv` is never touched, so the Models page still shows the route
   * it always showed.
   * @param provider - provider route id.
   * @returns true when a key was written.
   */
  const activatePool = async (provider) => {
    const all = profiles()
    if (all[provider] === undefined) return false
    const profile = profileOf(all, provider)
    if (!profile.enabled) return false
    const pool = await candidatesWithValues(provider, profile)
    if (pool.length === 0) {
      console.error('[llm-key-pool] provider "%s" has no stored pool keys; the route keeps its own key', provider)
      return false
    }
    // The quotas are probed first, because the choice is made by the reset
    // order and the reset moments come from the quota answer. A probe that
    // fails leaves the ranking empty, and the pool is then searched in its
    // own order.
    let ranked = pool
    try {
      await probeQuotas(provider)
      const withQuota = candidatesOf(provider, profile)
      if (withQuota.length > 0) ranked = withQuota
    } catch (error) {
      console.error('[llm-key-pool] the pool quota could not be probed for provider "%s"; the pool is searched in its own order', provider)
      console.error(error)
    }
    const state = stateOf(provider)
    // The route's own reference, read once and remembered: it holds the key
    // that is in use, so the activation can tell whether the pool's choice
    // is already there.
    if (state.currentValue === undefined) {
      state.currentValue = await resolveRef(envRefOf(provider))
    }
    // The same resting rule the failure path uses: a key below the
    // threshold is skipped while another key is available.
    const resting = new Set()
    for (const candidate of ranked) {
      if (isResting(candidate.quota, profile.policy.thresholdPercent)) resting.add(candidate.ref)
    }
    const available = ranked.filter((candidate) => !resting.has(candidate.ref))
    const usable = available.length > 0 ? available : ranked
    // The reset order decides: the key whose week rolls over soonest, and
    // among those the one whose 5-hour window resets soonest. When no quota
    // is known yet the pool is searched in its own order, and the key already
    // in use wins when it is among them — the activation must not churn on a
    // guess.
    // A pinned key wins the activation: the user named the key this
    // provider should use. The pin is a preference, not a lock — a failure
    // still rotates away from it.
    const pinned = usable.find((candidate) => candidate.ref === profile.pinned_ref)
    const known = usable.some((candidate) => intervalResetAt(candidate.quota) !== undefined
      || weeklyResetAt(candidate.quota) !== undefined)
    const chosen = pinned
      ?? (known
        ? rankByResetOrder(usable)[0]
        : usable.find((candidate) => candidate.value === state.currentValue) ?? usable[0])
    if (chosen === undefined) return false
    if (chosen.value === state.currentValue) return false
    const remaining = overallRemainingPercent(chosen.quota)
    const written = await writeKey(provider, chosen.value, `activation ${String(Math.round(remaining ?? 0))}%`)
    if (written) {
      console.log(
        '[llm-key-pool] activated provider="%s" key→"%s" (%s)',
        provider,
        chosen.name === '' ? chosen.ref : chosen.name,
        remaining === undefined ? 'quota unknown' : `${String(Math.round(remaining))}%`,
      )
    }
    return written
  }

  /**
   * Put every enabled pool in charge of its provider's requests.
   *
   * This runs when the plugin loads and whenever the settings change, so a
   * pool that was just configured takes over without a restart, and a pool
   * that was just emptied gives the route its own key back — the activation
   * is a no-op when the pool has no keys.
   */
  const activateAllPools = async () => {
    const all = profiles()
    for (const provider of Object.keys(all)) {
      try {
        await activatePool(provider)
      } catch (error) {
        console.error('[llm-key-pool] the pool for provider "%s" could not be activated', provider)
        console.error(error)
      }
    }
  }

  /**
   * Apply the `remaining` policy before a request: move to the key whose
   * WEEK rolls over soonest, and among those the one whose 5-hour window
   * resets soonest — unless that key is resting below the threshold or is
   * held back in reserve.
   * @param provider - provider route id.
   * @returns true when a key was written.
   */
  const applyRemainingPolicy = async (provider) => {
    const all = profiles()
    if (all[provider] === undefined) return false
    const profile = profileOf(all, provider)
    if (!profile.enabled) return false
    if (profile.policy.mode !== 'remaining') return false
    const state = stateOf(provider)
    const pool = applyReserve(candidatesOf(provider, profile), profile.policy.reservePercent)
    if (pool.length === 0) return false
    // The value the route's own reference holds right now. It is read from
    // the credential store the first time and remembered afterwards, so the
    // policy does not write the same key over and over.
    if (state.currentValue === undefined) {
      state.currentValue = await resolveRef(envRefOf(provider))
    }
    const current = state.currentValue
    const chosen = selectKey({
      policy: profile.policy,
      candidates: pool,
      currentValue: current,
      pinnedRef: profile.pinned_ref,
    })
    if (chosen === undefined) return false
    if (chosen.value === current) return false
    const remaining = overallRemainingPercent(chosen.quota)
    return writeKey(provider, chosen.value, `remaining ${String(Math.round(remaining ?? 0))}%`)
  }

  /**
   * Attempt one rotation after a failure: write the next pool key into the
   * route's own reference and return a retry action. Returns `undefined`
   * (delegate) when the pool is empty, the window is exhausted, or the
   * credential write is rejected.
   */
  const rotate = async (provider, failure, signal) => {
    const all = profiles()
    if (all[provider] === undefined) return undefined
    const profile = profileOf(all, provider)
    const state = getState(provider)
    const poolKeys = await candidatesWithValues(provider, profile)
    if (poolKeys.length === 0) {
      console.error('[llm-key-pool] provider "%s" has no stored pool keys; delegating', provider)
      return undefined
    }
    const now = Date.now()
    const fresh = state.lastWriteAt !== undefined && now - state.lastWriteAt < POOL_WINDOW_MS

    // The keys already tried inside this window are set aside: they are the
    // ones that did not work. When the window has lapsed, the whole pool is
    // available again — a key that failed an hour ago may work now.
    const tried = fresh ? new Set(state.tried) : new Set()
    const untried = poolKeys.filter((candidate) => !tried.has(candidate.ref))
    if (untried.length === 0) {
      console.error('[llm-key-pool] provider "%s" exhausted all %d pool keys within the window; delegating', provider, poolKeys.length)
      return undefined
    }

    // The pool is searched for the key to move to. The quotas are probed
    // first, because the search is by the reset order and the reset moments
    // come from the quota answer. A probe that fails leaves the ranking
    // empty, and the pool is then searched in its own order.
    let ranked = untried
    try {
      await probeQuotas(provider)
      const withQuota = candidatesOf(provider, profile)
        .filter((candidate) => !tried.has(candidate.ref))
      if (withQuota.length > 0) ranked = withQuota
    } catch (error) {
      console.error('[llm-key-pool] the pool quota could not be probed for provider "%s"; the pool is searched in its own order', provider)
      console.error(error)
    }

    const fused = AbortSignal.any([signal, lifetime.signal])
    if (fused.aborted) return undefined

    // The value the route's own reference holds right now — the key that
    // just failed. It is left out of the search. On the very first failure
    // the plugin has not written the reference itself yet, so the value is
    // read from the credential store: without it the key that just failed
    // could be handed out again.
    const poolState = stateOf(provider)
    if (poolState.currentValue === undefined) {
      poolState.currentValue = await resolveRef(envRefOf(provider))
    }
    const currentValue = poolState.currentValue
    const chosen = pickNextKey({
      policy: profile.policy,
      candidates: ranked,
      currentValue,
      pinnedRef: profile.pinned_ref,
      now,
    })
    if (chosen === undefined) return undefined
    const lastWritten = state.lastWriteAt
    if (!(await writeKey(provider, chosen.value, `failure ${failure.code}`))) return undefined
    if (fused.aborted) return undefined
    state.lastWriteAt = now
    state.tried = [...tried, chosen.ref]
    state.rotationId = randomUUID()
    const payload = {
      provider,
      rotationId: state.rotationId,
      triggerCode: failure.code,
      toRef: envRefOf(provider),
      poolIndex: poolKeys.findIndex((candidate) => candidate.ref === chosen.ref),
      poolName: chosen.name,
      targetRef: envRefOf(provider),
      failure,
    }
    console.log(
      '[llm-key-pool] rotated provider="%s" →"%s" (%s) window=%s lastWriteAge=%s',
      provider,
      chosen.name === '' ? chosen.ref : chosen.name,
      failure.code,
      fresh ? 'fresh' : 'fresh-start',
      lastWritten === undefined ? '–' : `${Math.round((now - lastWritten) / 1000)}s`,
    )
    try {
      ctx.emit('llm/key-pool-rotation', payload)
    } catch (error) {
      // A listener failure must not undo the rotation that already landed.
      console.error('[llm-key-pool] a rotation listener failed')
      console.error(error)
    }
    return { kind: 'retry' }
  }

  const lifetime = new AbortController()
  /**
   * Probe the pool's quota and, when the policy asks for it, move to the
   * soonest-resetting key before the request goes out.
   */
  const beforeRequest = async (provider) => {
    const all = profiles()
    if (all[provider] === undefined) return
    const profile = profileOf(all, provider)
    if (!profile.enabled) return
    if (profile.policy.mode !== 'remaining') return
    try {
      await probeQuotas(provider)
      await applyRemainingPolicy(provider)
    } catch (error) {
      console.error('[llm-key-pool] could not apply the remaining policy for provider "%s"', provider)
      console.error(error)
    }
  }

  /**
   * Apply the `remaining` policy before the request goes out.
   *
   * The adapter resolves the route's credential when the stream is consumed,
   * not when it is created, so the policy runs inside the wrapped generator —
   * before the first chunk — and the key it writes is the key the request
   * actually authenticates with.
   *
   * Every step is contained: a failure to read the configuration, to probe a
   * quota, or to write the credential must never reject the stream, because
   * a rejected stream aborts the agent turn.
   */
  ctx.on('llm/stream', (options, next) => {
    const provider = options?.provider
    if (typeof provider !== 'string') return next()
    let active = false
    try {
      const all = profiles()
      if (all[provider] === undefined) return next()
      const profile = profileOf(all, provider)
      active = profile.enabled && profile.policy.mode === 'remaining'
    } catch (error) {
      console.error('[llm-key-pool] the provider profile could not be read for "%s"; the request continues unchanged', provider)
      console.error(error)
      return next()
    }
    if (!active) return next()
    let upstream
    try {
      upstream = next()
    } catch (error) {
      console.error('[llm-key-pool] the upstream stream could not be created for "%s"', provider)
      console.error(error)
      return next()
    }
    return (async function* wrapped() {
      try {
        await beforeRequest(provider)
      } catch (error) {
        console.error('[llm-key-pool] could not apply the remaining policy for provider "%s"', provider)
        console.error(error)
      }
      yield* upstream
    })()
  })

  const disposeListener = ctx.on('agent/request-error', (payload, next) => {
    if (lifetime.signal.aborted) return Promise.resolve(undefined)
    const { provider, failure, signal } = payload
    let profile
    try {
      const all = profiles()
      if (all[provider] === undefined) return next()
      profile = profileOf(all, provider)
      if (!profile.enabled) return next()
    } catch (error) {
      console.error('[llm-key-pool] the provider profile could not be read for "%s"; the failure is delegated', provider)
      console.error(error)
      return next()
    }

    // A provider's own quota signature rotates even when the transport-level
    // code says nothing about quotas (MiniMax's HTTP 402 / `2067`).
    const providerQuota = isProviderQuotaFailure(provider, failure)
    const triggered = profile.rotate_on.includes(failure.code)
      || (providerQuota && profile.rotate_on.includes(TOKEN_PLAN_CODE))
    if (!triggered) return next()

    const state = getState(provider)
    const result = state.chain
      .then(() => (lifetime.signal.aborted ? undefined : rotate(provider, failure, signal)))
      .then((action) => action ?? next())
      .catch((error) => {
        console.error('[llm-key-pool] rotation for provider "%s" failed; delegating', provider)
        console.error(error)
        return next()
      })
    state.chain = result.then(() => undefined, () => undefined)
    return result
  })

  ctx.effect(() => async () => {
    disposeListener()
    lifetime.abort(new Error('llm-key-pool plugin disposed'))
    await Promise.allSettled([...states.values()].map((state) => state.chain))
  }, 'llm-key-pool: abort and drain active rotations')

  /**
   * The pool health the settings card reads.
   *
   * The probe runs on the Host, where the key values live: the browser never
   * sees a key, only the remaining share and the reset moment. The route
   * answers one provider at a time; `refresh=1` forces a fresh probe instead
   * of the cached answer.
   */
  const handleHealth = async (req, res) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { error: 'malformed request URL' })
      return
    }
    const provider = url.searchParams.get('provider') ?? ''
    const force = url.searchParams.get('refresh') === '1'
    let profile
    try {
      const all = profiles()
      if (all[provider] === undefined) {
        sendJson(res, 404, { error: `unknown provider "${provider}"` })
        return
      }
      profile = profileOf(all, provider)
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      await refreshValues(provider, profile)
      await probeQuotas(provider, force)
      sendJson(res, 200, { provider, keys: poolHealth(provider) })
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Register the quota route.
   *
   * The route answers one provider's pool health. It carries usage figures,
   * so it sits behind the same admission check as the other host routes: an
   * unauthenticated request is refused before any quota is probed.
   *
   * The service is read straight off the plugin context, the way the other
   * host plugins do it: `webServer` and `connection` are declared in this
   * plugin's own `inject`, so the context already carries them.
   */
  ctx.effect(() => {
    const webServer = ctx.webServer
    if (webServer === undefined) return undefined
    const connection = Reflect.get(ctx, 'connection')
    return webServer.register({
      kind: 'exact',
      path: '/llm-key-pool/api/health',
      handler: (req, res) => {
        try {
          const rejection = connection?.requestRejection?.(req)
          if (rejection !== undefined) {
            res.statusCode = rejection
            res.end()
            return
          }
        } catch (error) {
          console.error('[llm-key-pool] the request admission check failed')
          console.error(error)
          res.statusCode = 500
          res.end()
          return
        }
        void handleHealth(req, res)
      },
    })
  }, 'llm-key-pool: quota route')
}

/** Answer one request with a JSON body. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export { envRefOf, poolRefOf, slotOfPoolRef } from './src/pool.js'

/**
 * The plugin as the Loader mounts it.
 *
 * The Loader's `unwrapExports` takes `exports.default` when the module has
 * one, so a module with BOTH a default export and named exports collapses to
 * the default alone — and the `Config` schema, the `inject` list, and the
 * `name` are lost with it. A plugin whose schema is lost has no settings
 * form, so nothing the user configures is ever applied.
 *
 * This module therefore exports the pieces as named exports only. The
 * namespace itself — `apply`, `Config`, `inject`, `name` — is what the
 * Loader reads.
 */
export const plugin = {
  apply,
  Config,
  inject,
  name,
}
