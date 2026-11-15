/**
 * Host-side tests for dsh-multi-key-rotation.
 *
 * The suite covers three things:
 *   1. The switching policy: the failure walk, the remaining-amount policy,
 *      the weekly reset, and the parked keys.
 *   2. The MiniMax quota parsing and probe.
 *   3. The crash regressions: a configuration the settings card can produce
 *      must never fail validation, and no read of the configuration may throw
 *      inside the `agent/request-error` and `llm/stream` waterfalls, because
 *      a throw there aborts the agent turn and takes the host down with it.
 *
 * Run with: `node --test test/host.test.js`
 */

import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import z from '@deepseek-ai/schemastery'

import {
  Config,
  DEFAULT_ROTATE_ON,
  apply,
  isProviderQuotaFailure,
  name,
  NS,
  ROTATE_ON_CODES,
  TOKEN_PLAN_CODE,
} from '../index.js'
import {
  applyReserve,
  clampPercent,
  credentialRef,
  envRefOf,
  fetchRemains,
  isCredentialRefName,
  intervalResetAt,
  isResting,
  overallRemainingPercent,
  pickNextKey,
  poolRefOf,
  quotaSummaryOf,
  rankByResetOrder,
  regionOfProvider,
  selectKey,
  slotOfPoolRef,
  weeklyResetAt,
} from '../src/pool.js'

/** A quota of one key, as the policy consumes it. */
function quota(intervalPercent, weeklyPercent, resetAt) {
  return {
    ok: true,
    models: [{
      name: 'MiniMax-M3',
      intervalPercent,
      weeklyPercent,
      intervalResetAt: resetAt,
      weeklyResetAt: resetAt,
    }],
  }
}

/** A candidate of the pool. */
function candidate(ref, value, remaining, resetAt) {
  return { name: ref, ref, enabled: true, value, quota: quota(remaining, remaining, resetAt) }
}

/**
 * A candidate whose 5-hour window and weekly window reset at different
 * moments, which is what the reset order decides on.
 */
function candidateWithWindows(ref, value, intervalResetAt, weeklyResetAt) {
  return {
    name: ref,
    ref,
    enabled: true,
    value,
    quota: {
      ok: true,
      models: [{
        name: 'MiniMax-M3',
        intervalPercent: 50,
        weeklyPercent: 50,
        intervalResetAt,
        weeklyResetAt,
      }],
    },
  }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test('the route reference follows the provider id', () => {
  assert.equal(envRefOf('minimax-cn'), 'MINIMAX_CN_API_KEY')
  assert.equal(envRefOf('minimax'), 'MINIMAX_API_KEY')
})

test('a pool slot reference is derived and read back', () => {
  assert.equal(poolRefOf('minimax-cn', 1), 'MINIMAX_CN_API_KEY_POOL_1')
  assert.equal(slotOfPoolRef('MINIMAX_CN_API_KEY_POOL_3'), 3)
  assert.equal(slotOfPoolRef('MINIMAX_CN_API_KEY'), undefined)
})

test('a credential reference is validated, never thrown on a read', () => {
  assert.equal(isCredentialRefName('MINIMAX_CN_API_KEY'), true)
  assert.equal(isCredentialRefName('has-dash'), false)
  assert.equal(isCredentialRefName(''), false)
  assert.equal(credentialRef('MINIMAX_CN_API_KEY'), 'MINIMAX_CN_API_KEY')
  assert.throws(() => credentialRef('has-dash'), TypeError)
})

test('only MiniMax has a quota endpoint', () => {
  assert.equal(regionOfProvider('minimax-cn'), 'cn')
  assert.equal(regionOfProvider('minimax'), 'global')
  assert.equal(regionOfProvider('deepseek'), undefined)
})

// ---------------------------------------------------------------------------
// Quota parsing
// ---------------------------------------------------------------------------

test('the quota answer is reduced to the remaining share and the reset moment', () => {
  const now = Date.UTC(2026, 0, 1)
  const summary = quotaSummaryOf({
    base_resp: { status_code: 0 },
    current_subscribe_title: 'Token Plan',
    model_remains: [{
      model_name: 'MiniMax-M3',
      current_interval_remaining_percent: 42,
      current_weekly_remaining_percent: 77,
      current_interval_remains_time: 3_600_000,
      weekly_remains_time: 86_400_000,
    }],
  }, now)
  assert.equal(summary.ok, true)
  assert.equal(summary.planName, 'Token Plan')
  assert.equal(summary.models[0].intervalPercent, 42)
  assert.equal(summary.models[0].weeklyPercent, 77)
  assert.equal(summary.models[0].weeklyResetAt, now + 86_400_000)
})

test('the real MiniMax answer shape is parsed', () => {
  // The shape the Token Plan endpoint actually answers.
  const now = 1794712027122
  const summary = quotaSummaryOf({
    model_remains: [{
      start_time: now,
      end_time: now + 18_000_000,
      remains_time: 11_632_372,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      model_name: 'general',
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      weekly_start_time: now - 592_373_391,
      weekly_end_time: now + 6_058_981,
      weekly_remains_time: 6_058_981,
      current_interval_status: 2,
      current_interval_remaining_percent: 0,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 30,
    }],
    base_resp: { status_code: 0, status_msg: 'success' },
  }, now)
  assert.equal(summary.ok, true)
  assert.equal(summary.models[0].intervalPercent, 0)
  assert.equal(summary.models[0].weeklyPercent, 30)
  assert.equal(summary.models[0].weeklyResetAt, now + 6_058_981)
  // The weakest window decides: the 5-hour window is spent, so the key is spent.
  assert.equal(overallRemainingPercent(summary), 0)
})

test('a quota error answer is reported instead of parsed', () => {
  const summary = quotaSummaryOf({ base_resp: { status_code: 1002, status_msg: 'invalid api key' } })
  assert.equal(summary.ok, false)
  assert.match(summary.error, /invalid api key/)
})

test('the weakest window decides the overall remaining share', () => {
  assert.equal(overallRemainingPercent(quota(80, 20, 0)), 20)
  assert.equal(overallRemainingPercent(undefined), undefined)
})

test('the weekly reset is the latest one of the models', () => {
  assert.equal(weeklyResetAt(quota(1, 1, 500)), 500)
  assert.equal(weeklyResetAt(undefined), undefined)
})

test('the 5-hour reset is the latest one of the models', () => {
  assert.equal(intervalResetAt(quota(1, 1, 500)), 500)
  assert.equal(intervalResetAt(undefined), undefined)
})

test('the quota probe sends the key as the bearer token', async () => {
  const seen = []
  const payload = await fetchRemains('cn', 'secret-key', async (url, init) => {
    seen.push({ url, init })
    return new Response(JSON.stringify({ base_resp: { status_code: 0 }, model_remains: [] }), { status: 200 })
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret-key')
  assert.match(seen[0].url, /token_plan\/remains$/)
  assert.equal(payload.base_resp.status_code, 0)
})

// ---------------------------------------------------------------------------
// The switching policy
// ---------------------------------------------------------------------------

test('a key below the threshold rests until its weekly window resets', () => {
  const now = 1_000
  assert.equal(isResting(quota(10, 10, 5_000), 50, now), true)
  assert.equal(isResting(quota(10, 10, 500), 50, now), false, 'a reset that already passed frees the key')
  assert.equal(isResting(quota(80, 80, 5_000), 50, now), false)
  assert.equal(isResting(quota(10, 10, 5_000), 0, now), false, 'a zero threshold never rests a key')
})

test('the remaining policy picks the key whose weekly window resets soonest', () => {
  // The routine path spends the key whose week rolls over soonest: the
  // weekly allowance is the scarcer resource, and a key whose week is about
  // to roll over becomes a fresh key, so it is drained now.
  const chosen = selectKey({
    policy: { mode: 'remaining', thresholdPercent: 20, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 9_000, 9_000),
      candidateWithWindows('B', 'value-b', 9_000, 2_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the 5-hour window decides when the weekly windows reset together', () => {
  // The week is the primary order, so the 5-hour window only breaks the tie
  // between keys whose weeks end at the same moment.
  const chosen = selectKey({
    policy: { mode: 'remaining', thresholdPercent: 20, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 9_000, 3_000),
      candidateWithWindows('B', 'value-b', 2_000, 3_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the remaining policy keeps the key already in use when its week rolls over soonest', () => {
  const chosen = selectKey({
    policy: { mode: 'remaining', thresholdPercent: 20, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 9_000, 2_000),
      candidateWithWindows('B', 'value-b', 9_000, 9_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'A')
})

test('a resting key is skipped while another key is available', () => {
  // A key below the threshold whose week has not rolled over is skipped.
  // The clock is set before the reset, so the window is still open.
  const now = 1_000
  const chosen = selectKey({
    policy: { mode: 'remaining', thresholdPercent: 50, reservePercent: 0 },
    candidates: [
      candidate('A', 'value-a', 10, 9_000),
      candidate('B', 'value-b', 80, 9_000),
    ],
    currentValue: 'value-a',
    now,
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure policy keeps the key already in use', () => {
  const chosen = selectKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [candidate('A', 'value-a', 10, 9_000), candidate('B', 'value-b', 80, 9_000)],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'A')
})

test('no quota known keeps the key already in use instead of churning', () => {
  const chosen = selectKey({
    policy: { mode: 'remaining', thresholdPercent: 20, reservePercent: 0 },
    candidates: [
      { name: 'A', ref: 'A', enabled: true, value: 'value-a', quota: undefined },
      { name: 'B', ref: 'B', enabled: true, value: 'value-b', quota: undefined },
    ],
    currentValue: 'value-b',
  })
  assert.equal(chosen.ref, 'B')
})

// ---------------------------------------------------------------------------
// The selection of the failure path
// ---------------------------------------------------------------------------

test('the failure path picks the key whose weekly window resets soonest', () => {
  // The trigger is the failure; the selection is the reset order. The key
  // that just failed is left out, and among the rest the one whose week
  // rolls over soonest is chosen, so an allowance is not left to expire.
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 9_000, 9_000),
      candidateWithWindows('B', 'value-b', 9_000, 2_000),
      candidateWithWindows('C', 'value-c', 9_000, 5_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure path lets the 5-hour window decide when the weekly windows tie', () => {
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 9_000, 3_000),
      candidateWithWindows('B', 'value-b', 2_000, 3_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure path never hands out the key that just failed', () => {
  // The failed key is the one that did not work: it is left out of the
  // search even when it resets soonest.
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [
      candidateWithWindows('A', 'value-a', 1_000, 9_000),
      candidateWithWindows('B', 'value-b', 9_000, 9_000),
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure path falls back to the failed key when it is the only one', () => {
  // A pool of one key has nothing else to offer, so the failure is answered
  // with that key rather than left unhandled.
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [candidateWithWindows('A', 'value-a', 1_000, 9_000)],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'A')
})

test('the failure path skips a resting key while another key is available', () => {
  const now = 1_000
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 50, reservePercent: 0 },
    candidates: [
      candidate('A', 'value-a', 10, 9_000),
      candidate('B', 'value-b', 80, 9_000),
    ],
    currentValue: 'value-a',
    now,
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure path uses a resting key when every key rests', () => {
  // A failure still has to be answered, so the threshold never leaves the
  // pool with nothing to offer.
  const now = 1_000
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 50, reservePercent: 0 },
    candidates: [
      candidate('A', 'value-a', 10, 9_000),
      candidate('B', 'value-b', 20, 9_000),
    ],
    currentValue: 'value-a',
    now,
  })
  assert.equal(chosen.ref, 'B')
})

test('the failure path searches the pool in its own order when no quota is known', () => {
  // Without a quota answer the reset order is unknown, so the pool is
  // searched deterministically rather than at random.
  const chosen = pickNextKey({
    policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
    candidates: [
      { name: 'A', ref: 'A', enabled: true, value: 'value-a', quota: undefined },
      { name: 'B', ref: 'B', enabled: true, value: 'value-b', quota: undefined },
    ],
    currentValue: 'value-a',
  })
  assert.equal(chosen.ref, 'B')
})

test('the reset order ranks a key with an unknown reset behind a known one', () => {
  const ranked = rankByResetOrder([
    { name: 'A', ref: 'A', enabled: true, value: 'value-a', quota: undefined },
    candidateWithWindows('B', 'value-b', 9_000, 9_000),
  ])
  assert.deepEqual(ranked.map((entry) => entry.ref), ['B', 'A'])
})

test('the reserve holds a healthy key back for the failure path', () => {
  const candidates = [
    candidate('A', 'value-a', 90, 9_000),
    candidate('B', 'value-b', 10, 9_000),
  ]
  const kept = applyReserve(candidates, 50)
  assert.deepEqual(kept.map((entry) => entry.ref), ['B'])
  assert.deepEqual(applyReserve(candidates, 0).map((entry) => entry.ref), ['A', 'B'])
})

test('a percentage out of range is clamped rather than rejected', () => {
  assert.equal(clampPercent(400), 100)
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(Number.NaN), 0)
  assert.equal(clampPercent('x'), 0)
})

// ---------------------------------------------------------------------------
// Provider quota signatures
// ---------------------------------------------------------------------------

test('the MiniMax Token Plan signatures are recognised', () => {
  assert.equal(isProviderQuotaFailure('minimax-cn', { code: 'PI_AI_ERROR', message: 'code 2067 套餐额度已用完' }), true)
  assert.equal(isProviderQuotaFailure('minimax-cn', { code: 'RATE_LIMIT', message: 'code 2056 超出 M Plan 资源限制' }), true)
  assert.equal(isProviderQuotaFailure('minimax', { code: 'PI_AI_ERROR', message: 'code 2067' }), true)
})

test('another provider is not mistaken for a Token Plan failure', () => {
  assert.equal(isProviderQuotaFailure('deepseek', { code: 'PI_AI_ERROR', message: 'code 2067' }), false)
  assert.equal(isProviderQuotaFailure('minimax-cn', { code: 'SERVER', message: 'internal error' }), false)
})

// ---------------------------------------------------------------------------
// Crash regressions
// ---------------------------------------------------------------------------

test('the configuration accepts every value the settings card can produce', () => {
  // The card lets the user switch off every trigger chip, so `rotate_on` may
  // be empty. A schema that rejects it would fail the Loader's activation.
  assert.doesNotThrow(() => Config({ providers: { 'minimax-cn': { enabled: true, rotate_on: [], keys: [], policy: {} } } }))
  // A key row the user has not named yet has an empty name.
  assert.doesNotThrow(() => Config({ providers: { 'minimax-cn': { keys: [{ name: '', ref: 'MINIMAX_CN_API_KEY_POOL_1' }] } } }))
  // A percentage out of range is clamped by the policy, not by a rejection.
  assert.doesNotThrow(() => Config({ providers: { 'minimax-cn': { policy: { thresholdPercent: 400, reservePercent: -5 } } } }))
  // A provider entry the card does not know is kept as plain data.
  assert.doesNotThrow(() => Config({ providers: { 'minimax-cn': { unexpected: true } } }))
})

test('a provider entry the card does not know survives validation', () => {
  const validated = Config({ providers: { 'minimax-cn': { unexpected: true } } })
  const providers = validated.providers.get()
  assert.equal(typeof providers['minimax-cn'], 'object')
})

test('the plugin exposes its Config and inject to the Loader', async () => {
  // The Loader reads `Config`, `inject` and `name` off the *unwrapped* module
  // namespace. A module that also has a default export collapses to that
  // export alone, and the schema disappears — the plugin then has no settings
  // form, so nothing the user configures is ever applied.
  const module = await import('../index.js')
  assert.equal(module.default, undefined, 'a default export hides the named exports from the Loader')
  assert.equal(typeof module.Config, 'function')
  assert.ok(Array.isArray(module.inject))
  assert.equal(module.name, 'llm-key-pool')
})

test('a volatile configuration that cannot be read does not throw', () => {
  // The plugin reads its configuration inside the `agent/request-error` and
  // `llm/stream` waterfalls. A throw there aborts the agent turn, so every
  // read must degrade to "no profiles".
  const hostile = {
    get providers() {
      throw new Error('the configuration is broken')
    },
  }
  assert.doesNotThrow(() => apply(makeContext(), hostile))
})

test('a volatile configuration that is not an accessor does not throw', () => {
  const hostile = { providers: { 'minimax-cn': { enabled: true } } }
  assert.doesNotThrow(() => apply(makeContext(), hostile))
})

test('a configuration whose providers are not an object does not throw', () => {
  assert.doesNotThrow(() => apply(makeContext(), { providers: 'nonsense' }))
  assert.doesNotThrow(() => apply(makeContext(), { providers: [1, 2, 3] }))
  assert.doesNotThrow(() => apply(makeContext(), {}))
})

/**
 * Call the plugin's health route and return the parsed answer.
 *
 * The route is registered through the web server the plugin injects, so the
 * harness records the registration and this helper calls it.
 * @param ctx - the plugin context.
 * @param provider - the provider route id.
 * @returns the parsed body.
 */
async function callHealth(ctx, provider) {
  const route = ctx.routes.get('/llm-key-pool/api/health')
  assert.notEqual(route, undefined, 'the health route must be registered')
  const chunks = []
  const res = {
    statusCode: 200,
    headers: {},
    writeHead(status, headers) {
      this.statusCode = status
      if (headers !== undefined) this.headers = headers
    },
    end(body) {
      if (body !== undefined) chunks.push(String(body))
    },
  }
  await route.handler({ url: `/llm-key-pool/api/health?provider=${encodeURIComponent(provider)}` }, res)
  // The handler answers asynchronously: it probes the quota before it writes
  // the body, so the answer is awaited.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return JSON.parse(chunks.join(''))
}

/** A context that records what the plugin does to it. */
function makeContext() {
  const listeners = new Map()
  const routes = new Map()
  return {
    listeners,
    effects: [],
    routes,
    credentials: {
      store: new Map(),
      async resolve(ref) {
        const value = this.store.get(ref)
        return value === undefined ? undefined : { value, source: 'store' }
      },
      async set(ref, value) {
        this.store.set(ref, value)
      },
    },
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => {}
    },
    emit() {},
    effect(fn) {
      this.effects.push(fn)
      // The effect is RUN, the way Cordis runs it: the plugin registers its
      // web routes inside an effect, so a harness that only collects the
      // functions would never see the route.
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject() {},
    fiber: {},
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => {}
      },
    },
    connection: {},
  }
}

test('the request-error waterfall delegates instead of throwing on a broken configuration', async () => {
  const ctx = makeContext()
  const broken = {
    get providers() {
      throw new Error('the configuration is broken')
    },
  }
  apply(ctx, broken)
  const handler = ctx.listeners.get('agent/request-error')[0]
  const delegated = await handler(
    { provider: 'minimax-cn', failure: { code: 'QUOTA' }, signal: new AbortController().signal },
    () => Promise.resolve('delegated'),
  )
  assert.equal(delegated, 'delegated')
})

test('the llm/stream waterfall passes the stream through on a broken configuration', async () => {
  const ctx = makeContext()
  const broken = {
    get providers() {
      throw new Error('the configuration is broken')
    },
  }
  apply(ctx, broken)
  const handler = ctx.listeners.get('llm/stream')[0]
  const chunks = []
  const stream = handler(
    { provider: 'minimax-cn' },
    async function* upstream() {
      yield { type: 'text', text: 'hello' }
    },
  )
  for await (const chunk of stream) chunks.push(chunk)
  assert.equal(chunks.length, 1)
})

test('the remaining policy does not rewrite the credential on every request', async () => {
  const ctx = makeContext()
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          policy: { mode: 'remaining', thresholdPercent: 10, reservePercent: 0 },
        },
      }),
    },
  }
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')

  const handler = ctx.listeners.get('llm/stream')[0]
  let writes = 0
  const originalSet = ctx.credentials.set.bind(ctx.credentials)
  ctx.credentials.set = async (ref, value) => {
    writes += 1
    return originalSet(ref, value)
  }

  const drain = async () => {
    const stream = handler({ provider: 'minimax-cn' }, async function* upstream() {
      yield { type: 'text', text: 'x' }
    })
    for await (const _chunk of stream) { /* drain */ }
  }

  await drain()
  await drain()
  await drain()

  // The key in use is already the healthiest, so no write may happen.
  assert.equal(writes, 0)
  assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
})

// ---------------------------------------------------------------------------
// The failure path, end to end
// ---------------------------------------------------------------------------

/**
 * A quota answer for one key, with the 5-hour and the weekly window reset
 * at the given moments.
 */
function quotaAnswer(intervalResetAt, weeklyResetAt, intervalPercent = 50, weeklyPercent = 50) {
  const now = Date.now()
  return {
    base_resp: { status_code: 0, status_msg: 'success' },
    current_subscribe_title: 'Token Plan',
    model_remains: [{
      model_name: 'general',
      current_interval_remaining_percent: intervalPercent,
      current_weekly_remaining_percent: weeklyPercent,
      current_interval_end_time: intervalResetAt,
      weekly_end_time: weeklyResetAt,
      end_time: intervalResetAt,
      current_interval_remains_time: Math.max(0, intervalResetAt - now),
      weekly_remains_time: Math.max(0, weeklyResetAt - now),
    }],
  }
}

test('a failure hands out the key whose weekly window resets soonest', async () => {
  const ctx = makeContext()
  const now = Date.now()
  const soon = now + 60_000
  const later = now + 3_600_000

  // The quota endpoint answers per key: the bearer token says which key is
  // being asked about. The WEEKLY window is what differs between the two
  // keys — that is the order the pool follows.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const token = String(init.headers.Authorization).replace('Bearer ', '')
    const payload = token === 'value-b'
      ? quotaAnswer(later, soon)
      : quotaAnswer(later, later)
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(payload)
      },
    }
  }

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [
              { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
              { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
            ],
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')
    // The route is on the first key, and that key is the one that fails.
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')

    const handler = ctx.listeners.get('agent/request-error')[0]
    const action = await handler(
      { provider: 'minimax-cn', failure: { code: 'TOKEN_PLAN' }, signal: new AbortController().signal },
      () => Promise.resolve('delegated'),
    )

    // The plugin took over the request instead of delegating it.
    assert.deepEqual(action, { kind: 'retry' })
    // And it wrote the key whose weekly window resets soonest.
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a second failure moves to the other key, and a third delegates', async () => {
  const ctx = makeContext()
  const now = Date.now()
  const soon = now + 60_000
  const later = now + 3_600_000

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const token = String(init.headers.Authorization).replace('Bearer ', '')
    // The pinned key's week rolls over sooner, but it is the one that
    // failed — so the pool moves to the other key even though its week has
    // more time left.
    const payload = token === 'value-b'
      ? quotaAnswer(later, later)
      : quotaAnswer(soon, soon)
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(payload)
      },
    }
  }

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [
              { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
              { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
            ],
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')

    const handler = ctx.listeners.get('agent/request-error')[0]
    const signal = new AbortController().signal

    await handler(
      { provider: 'minimax-cn', failure: { code: 'TOKEN_PLAN' }, signal },
      () => Promise.resolve('delegated'),
    )
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-b')

    // The key now in use fails too. The other key has not been tried inside
    // the window, so the pool moves to it rather than handing out the key
    // that just failed.
    const second = await handler(
      { provider: 'minimax-cn', failure: { code: 'TOKEN_PLAN' }, signal },
      () => Promise.resolve('delegated'),
    )
    assert.deepEqual(second, { kind: 'retry' })
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')

    // Every key has now failed inside the window, so the failure is
    // delegated rather than answered with a key that already failed.
    const third = await handler(
      { provider: 'minimax-cn', failure: { code: 'TOKEN_PLAN' }, signal },
      () => Promise.resolve('delegated'),
    )
    assert.equal(third, 'delegated')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Pool activation
//
// A configured pool is meant to BE the provider's key, not to wait for a
// failure before it takes over. These tests cover the activation: the pool
// writes its own choice into the route's reference, so the route
// authenticates with a pool key from the first request.
// ---------------------------------------------------------------------------

test('the pool takes over the route as soon as it loads', async () => {
  const ctx = makeContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(quotaAnswer(Date.now() + 3_600_000, Date.now() + 7_200_000))
    },
  })
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [
            { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
            { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
          ],
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  // The route holds its own key — the one Settings → Models stores.
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')

  try {
    // The activation runs after the value refresh settles.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The route now authenticates with a pool key, not with its own.
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the activation writes the key whose weekly window resets soonest', async () => {
  const ctx = makeContext()
  const now = Date.now()
  const soon = now + 60_000
  const later = now + 3_600_000

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const token = String(init.headers.Authorization).replace('Bearer ', '')
    // The WEEKLY window is what differs: the first key's week rolls over
    // sooner, so it is the one the pool spends first.
    const payload = token === 'value-a' ? quotaAnswer(later, soon) : quotaAnswer(later, later)
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(payload)
      },
    }
  }

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [
              { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
              { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
            ],
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The sooner-resetting key wins, even though the other one comes first
    // in the pool.
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the activation does not rewrite the reference when the pool already holds it', async () => {
  const ctx = makeContext()
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
  // The route already holds the pool's key.
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  // Nothing was written: the reference is untouched.
  assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
})

test('a disabled pool leaves the route its own key', async () => {
  const ctx = makeContext()
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: false,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'route-own-key')
})

test('a pool with no stored key leaves the route its own key', async () => {
  const ctx = makeContext()
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)
  // The pool names a slot, but nothing was ever stored in it.

  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'route-own-key')
})

test('the activation runs again when the settings change', async () => {
  const ctx = makeContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(quotaAnswer(Date.now() + 3_600_000, Date.now() + 7_200_000))
    },
  })
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)

  try {
    // The key is added after the plugin loaded.
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    const handler = ctx.listeners.get('settings/document-updated')[0]
    handler(NS)

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// The pinned key
//
// The user can name the key a provider should use. The pin is a PREFERENCE:
// it decides where the pool starts and where the routine path returns to, but
// a failure still rotates away from it.
// ---------------------------------------------------------------------------

test('the activation moves to the pinned key', async () => {
  const ctx = makeContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(quotaAnswer(Date.now() + 3_600_000, Date.now() + 7_200_000))
    },
  })
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [
            { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
            { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
          ],
          // The second key is pinned, even though it comes second in the
          // pool and its window resets later.
          pinned_ref: 'MINIMAX_CN_API_KEY_POOL_2',
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')

  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The pinned key is the one the route authenticates with.
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a pin on a key that is not in the pool changes nothing', async () => {
  const ctx = makeContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(quotaAnswer(Date.now() + 3_600_000, Date.now() + 7_200_000))
    },
  })
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
          // The pin names a slot the pool does not hold.
          pinned_ref: 'MINIMAX_CN_API_KEY_POOL_9',
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')

  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The pool still takes over with its own key.
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-a')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a pinned key is still rotated away from when it fails', async () => {
  const ctx = makeContext()
  const now = Date.now()
  const soon = now + 60_000
  const later = now + 3_600_000

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const token = String(init.headers.Authorization).replace('Bearer ', '')
    // The pinned key has the sooner reset, but it is the one that fails.
    const payload = token === 'value-a'
      ? quotaAnswer(soon, later)
      : quotaAnswer(later, later)
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(payload)
      },
    }
  }

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [
              { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
              { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
            ],
            pinned_ref: 'MINIMAX_CN_API_KEY_POOL_1',
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const handler = ctx.listeners.get('agent/request-error')[0]
    const outcome = await handler(
      { provider: 'minimax-cn', failure: { code: 'QUOTA' }, signal: new AbortController().signal },
      () => Promise.resolve('delegated'),
    )

    // The pin is a preference, not a lock: the failing key is left behind.
    assert.notEqual(outcome, 'delegated')
    assert.equal(ctx.credentials.store.get('MINIMAX_CN_API_KEY'), 'value-b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// The quota windows
//
// The card shows the 5-hour window and the weekly window separately, because
// the switching policy compares them and a key can be empty in one while it
// is full in the other.
// ---------------------------------------------------------------------------

test('the health answer reports both windows of every key', async () => {
  const ctx = makeContext()
  const now = Date.now()
  const intervalReset = now + 1_800_000
  const weeklyReset = now + 86_400_000

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      // The 5-hour window has 20% left, the week has 80%.
      return JSON.stringify(quotaAnswer(intervalReset, weeklyReset, 20, 80))
    },
  })

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [{ name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'route-own-key')
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const body = await callHealth(ctx, 'minimax-cn')
    const key = body.keys[0]
    // The 5-hour window and the week are reported apart from each other.
    assert.equal(key.intervalRemainingPercent, 20)
    assert.equal(key.weeklyRemainingPercent, 80)
    assert.equal(key.intervalResetAt, intervalReset)
    assert.equal(key.weeklyResetAt, weeklyReset)
    // The overall share is still the weaker of the two.
    assert.equal(key.remainingPercent, 20)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the health answer lists the keys in reset order', async () => {
  // The panel shows the pool, and the pool is used in reset order: the key
  // whose WEEK rolls over soonest comes first, and the 5-hour window breaks
  // the tie. The health route answers in that order too, so the panel reads
  // in the order the keys are actually spent in.
  const ctx = makeContext()
  const now = Date.now()
  // The third key's week rolls over soonest; the first key's week rolls
  // over last. The saved configuration lists them the other way round.
  const weekSoon = now + 60_000
  const weekLater = now + 7_200_000

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const token = String(init.headers.Authorization).replace('Bearer ', '')
    // The weekly window is what differs between the keys.
    const payload = token === 'value-b'
      ? quotaAnswer(weekLater, weekSoon)
      : quotaAnswer(weekLater, weekLater)
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(payload)
      },
    }
  }

  try {
    const config = {
      providers: {
        get: () => ({
          'minimax-cn': {
            enabled: true,
            rotate_on: [...DEFAULT_ROTATE_ON],
            keys: [
              { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
              { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
            ],
            policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
          },
        }),
      },
    }
    apply(ctx, config)
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')
    ctx.credentials.store.set('MINIMAX_CN_API_KEY', 'value-a')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const body = await callHealth(ctx, 'minimax-cn')
    // The key whose week rolls over soonest comes first, even though the
    // configuration lists it second.
    assert.deepEqual(body.keys.map((key) => key.name), ['secondary', 'primary'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('the health answer marks the pinned key', async () => {
  const ctx = makeContext()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(quotaAnswer(Date.now() + 3_600_000, Date.now() + 7_200_000))
    },
  })
  const config = {
    providers: {
      get: () => ({
        'minimax-cn': {
          enabled: true,
          rotate_on: [...DEFAULT_ROTATE_ON],
          keys: [
            { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
            { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
          ],
          pinned_ref: 'MINIMAX_CN_API_KEY_POOL_2',
          policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
        },
      }),
    },
  }
  apply(ctx, config)
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_1', 'value-a')
  ctx.credentials.store.set('MINIMAX_CN_API_KEY_POOL_2', 'value-b')

  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const body = await callHealth(ctx, 'minimax-cn')
    assert.equal(body.keys[0].pinned, false)
    assert.equal(body.keys[1].pinned, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Plugin surface
// ---------------------------------------------------------------------------

test('the package identity and the runtime identity stay apart', () => {
  // The package identity is the bundle's name. It is what npm serves, what
  // the market catalog names, and what the Loader resolves the module by.
  // It is rebranded freely.
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(manifest.name, '@danneleung/dsh-multi-key-rotation')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')

  // The runtime identity is stored in users' profiles and in credential
  // references. Renaming any of it would silently break every existing
  // installation, so it is pinned here.
  assert.equal(name, 'llm-key-pool')
  assert.equal(NS, 'llm-key-pool')
  // The quota route path is part of the runtime identity: the browser
  // half calls it by name.
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.equal(source.includes("path: '/llm-key-pool/api/health'"), true)
})

test('the plugin exports the names the loader and the card rely on', () => {
  assert.equal(name, 'llm-key-pool')
  assert.equal(NS, 'llm-key-pool')
  assert.equal(TOKEN_PLAN_CODE, 'TOKEN_PLAN')
  assert.ok(ROTATE_ON_CODES.includes(TOKEN_PLAN_CODE))
  assert.ok(DEFAULT_ROTATE_ON.includes(TOKEN_PLAN_CODE))
})

test('the schema is a Schemastery graph the settings service can project', () => {
  const schema = Config
  assert.equal(typeof schema['~standard'].validate, 'function')
  const result = schema['~standard'].validate({ providers: {} })
  assert.equal(result.issues, undefined)
})
