/**
 * Credential naming, quota probing, and the switching policy for
 * dsh-multi-key-rotation.
 *
 * The plugin owns three things a user should never have to think about:
 *
 * 1. **Naming.** A pool slot is addressed by a *name* the user chooses
 *    ("main", "backup-1"); the credential reference behind it is derived here
 *    as `<ROUTE>_API_KEY_POOL_<n>`. The user never types a reference.
 *
 * 2. **Remaining amount.** MiniMax publishes the remaining quota of a Token
 *    Plan key at `GET /v1/token_plan/remains`, answering with a per-model row
 *    carrying the 5-hour window's and the weekly window's remaining share and
 *    the time left in each window. {@link probeQuota} reads that answer and
 *    reduces it to the one number the switching policy needs.
 *
 * 3. **The switch.** The switch has two halves, and they are separate:
 *    the TRIGGER decides *when* the pool is walked, and the SELECTION
 *    decides *which* key the pool walks to.
 *
 *    The trigger is the failure: the key in use stays in use until it fails.
 *    The selection is the RESET ORDER: the pool is searched for the key
 *    whose WEEK rolls over soonest, and among those the one whose 5-hour
 *    window resets soonest. The weekly allowance is the scarcer resource:
 *    a key whose week is about to roll over becomes a fresh key, so it is
 *    drained now, while a key whose week still has time keeps its allowance
 *    for later.
 *
 *    {@link pickNextKey} is the selection of the failure path, and
 *    {@link selectKey} is the selection of the routine path.
 *
 * @module dsh-multi-key-rotation/pool
 */

/**
 * The grammar of a credential reference: a POSIX shell identifier.
 *
 * The plugin validates a reference itself instead of importing the helper
 * from `@deepseek-ai/dsh-credentials`. That package pulls the whole Cordis
 * runtime in behind it, and a second copy of Cordis inside the plugin would
 * be a second set of runtime identities — the kind of duplication that makes
 * a plugin misbehave in ways that are hard to trace. The check is three
 * characters of regular expression, so the plugin keeps it to itself.
 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Whether a string could name a credential reference at all.
 *
 * A reference outside the grammar names nothing, so it is read as "not set"
 * rather than as a thrown error: a malformed reference must never take the
 * agent loop down.
 * @param value - candidate reference.
 * @returns true when the reference is well-formed.
 */
export function isCredentialRefName(value) {
  return typeof value === 'string' && REF_PATTERN.test(value)
}

/**
 * Validate one credential reference.
 * @param value - candidate reference.
 * @returns the same reference.
 * @throws TypeError when the reference is not a well-formed name.
 */
export function credentialRef(value) {
  if (!isCredentialRefName(value)) {
    throw new TypeError(`credential ref "${String(value)}" must match ${String(REF_PATTERN)}`)
  }
  return value
}

/** The two MiniMax regions a Token Plan key can belong to. */
export const REGIONS = Object.freeze({ global: 'global', cn: 'cn' })

/**
 * The provider routes this plugin supports.
 *
 * The first release is deliberately narrow: **MiniMax Token Plan only**. It is
 * the one subscription whose quota is published as two windows — a 5-hour one
 * and a weekly one — and the one whose spent-plan error the adapter
 * misclassifies, which is the whole reason this plugin exists. Supporting a
 * route whose quota endpoint is unknown would mean showing usage figures the
 * plugin cannot actually know, so such a route is left out rather than
 * half-supported.
 *
 * The list is a *support* list, not an enablement switch: a route that is not
 * in it gets no settings card, no composer indicator, and no quota probe.
 */
export const SUPPORTED_PROVIDERS = Object.freeze(['minimax', 'minimax-cn'])

/**
 * Whether a provider route is one this plugin supports.
 *
 * @param provider - provider route id, such as `minimax-cn`.
 * @returns true when the route is a MiniMax Token Plan route.
 */
export function isSupportedProvider(provider) {
  return typeof provider === 'string' && SUPPORTED_PROVIDERS.includes(provider)
}

/**
 * The official quota hosts of each region, most authoritative first. The
 * `api.*` host is the TLS-stable fallback of the `www.*` documentation host.
 */
export const REMAINS_URLS = Object.freeze({
  global: Object.freeze([
    'https://www.minimax.io/v1/token_plan/remains',
    'https://api.minimax.io/v1/token_plan/remains',
  ]),
  cn: Object.freeze([
    'https://api.minimaxi.com/v1/token_plan/remains',
    'https://www.minimaxi.com/v1/token_plan/remains',
  ]),
})

/** How long a probed quota stays fresh. */
export const QUOTA_TTL_MS = 45_000

/** How long one quota request may take before it is abandoned. */
export const QUOTA_TIMEOUT_MS = 8_000

/**
 * Derive the region of a provider route. Only MiniMax publishes a Token Plan
 * quota endpoint; every other route has no probe.
 * @param provider - provider route id.
 * @returns the region, or undefined when the route has no quota endpoint.
 */
export function regionOfProvider(provider) {
  if (provider === 'minimax-cn') return REGIONS.cn
  if (provider === 'minimax') return REGIONS.global
  return undefined
}

/**
 * Derive the route's own (apiKeyEnv) reference from its provider id by
 * convention. This is the reference the pi-ai profile names as `apiKeyEnv`,
 * and therefore the one an adapter reads on every request.
 * @param provider - provider route id, such as `minimax-cn`.
 * @returns the credential reference, such as `MINIMAX_CN_API_KEY`.
 */
export function envRefOf(provider) {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Derive the reference holding one pool slot's key.
 *
 * Slot `n` lives in `<ROUTE>_API_KEY_POOL_<n>`, where `n` is 1-based so the
 * name reads like the first, second, and third spare key.
 * @param provider - provider route id, such as `minimax-cn`.
 * @param slot - 1-based pool slot number.
 * @returns the credential reference, such as `MINIMAX_CN_API_KEY_POOL_1`.
 */
export function poolRefOf(provider, slot) {
  return `${envRefOf(provider)}_POOL_${slot}`
}

/**
 * Read the 1-based slot number out of a derived pool reference.
 * @param ref - candidate credential reference.
 * @returns the slot number, or undefined when the reference is not derived.
 */
export function slotOfPoolRef(ref) {
  const match = /_API_KEY_POOL_(\d+)$/.exec(ref)
  return match === null ? undefined : Number(match[1])
}

/** One named key of a provider's pool. */
export function poolEntrySchema(z) {
  return z.object({
    /** The name the user gave this key; the card shows it instead of a reference. */
    name: z.string().default(''),
    /** The credential reference holding this key's value; the plugin derives it. */
    ref: z.string().default(''),
    /**
     * Whether this key is used by the automatic switching. A key the user
     * parked stays stored but is never written into the route's reference.
     */
    enabled: z.boolean().default(true),
  })
}

/**
 * The automatic switching policy of one provider.
 *
 * The policy has two halves. The TRIGGER decides when the pool is walked:
 *   - `failure` — only when a request fails with a trigger code. The key in
 *     use stays in use until it fails.
 *   - `remaining` — also before a request, so the pool moves on its own.
 *
 * The SELECTION decides which key the pool walks to, and it is the same in
 * both modes: the key whose WEEK rolls over soonest, and among those the one
 * whose 5-hour window resets soonest. A key that is about to reset is spent
 * before it expires; a key with more time left keeps its allowance for
 * later.
 *
 * `thresholdPercent` is the remaining share below which a key is rested
 * (0 disables resting). A resting key is skipped while another key is
 * available, so a weekly allowance is not burned before it becomes available
 * again. `reservePercent` keeps a share of the healthy keys back for the
 * failure path: with three keys at 90% and a threshold of 50%, the policy
 * still hands failures a key it has not spent.
 */
export function policySchema(z) {
  return z.object({
    mode: z.union([z.const('failure'), z.const('remaining')]).default('failure'),
    // A percentage the card rounds to an integer; the range check stays loose
    // so an out-of-range value is clamped by the policy rather than failing
    // the whole config.
    thresholdPercent: z.number().default(0),
    reservePercent: z.number().default(0),
  })
}

/**
 * Clamp one percentage into 0…100, treating a non-finite value as zero.
 * @param value - the raw percentage.
 * @returns the usable percentage.
 */
export function clampPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * The quota of one key, reduced to what the switching policy needs.
 */
export function quotaSummaryOf(payload, now = Date.now()) {
  const root = asRecord(payload)
  if (root === undefined) return { ok: false, error: '无法解析用量数据' }
  const base = asRecord(root.base_resp)
  const statusCode = asNumber(base?.status_code)
  if (statusCode !== undefined && statusCode !== 0) {
    const raw = asString(base?.status_msg) ?? `MiniMax 返回错误 (${statusCode})`
    return { ok: false, error: raw }
  }
  const rows = modelRowsOf(root)
  if (rows === undefined || rows.length === 0) return { ok: false, error: '无模型配额数据' }

  const planName = planNameOf(root, rows)
  const models = []
  for (const row of rows) {
    const name = asString(row.model_name) ?? asString(row.name) ?? asString(row.model)
    if (name === undefined || name.length === 0) continue
    const intervalPercent = remainingPercent(row, 'interval')
    const weeklyPercent = remainingPercent(row, 'weekly')
    const intervalResetAt = endAt(row, 'interval', now, remainsMs(row, 'interval'))
    const weeklyResetAt = endAt(row, 'weekly', now, remainsMs(row, 'weekly'))
    models.push({
      name,
      intervalPercent,
      weeklyPercent,
      intervalResetAt,
      weeklyResetAt,
    })
  }
  if (models.length === 0) return { ok: false, error: '无模型配额数据' }
  return { ok: true, planName, models }
}

/**
 * Fetch the remaining quota of one key.
 *
 * The key's own value is the bearer token: MiniMax answers the quota
 * endpoint per key, which is what makes a per-key remaining amount
 * possible at all.
 * @param region - the MiniMax region of the key.
 * @param apiKey - the key's value.
 * @param fetchImpl - the fetch implementation; replaced in tests.
 * @param timeoutMs - how long one request may take.
 * @returns the raw quota payload.
 * @throws Error when every host of the region failed.
 */
export async function fetchRemains(region, apiKey, fetchImpl = fetch, timeoutMs = QUOTA_TIMEOUT_MS) {
  const urls = REMAINS_URLS[region]
  let lastError
  for (const url of urls) {
    try {
      return await fetchOne(url, apiKey, fetchImpl, timeoutMs)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (!isRetryableError(lastError)) throw lastError
    }
  }
  throw lastError ?? new Error('查询失败')
}

/** Read one quota answer from one host. */
async function fetchOne(url, apiKey, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    const text = await response.text()
    let body = {}
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error('无法解析用量数据')
      }
    }
    if (!response.ok) throw new Error(`查询失败 (HTTP ${response.status})`)
    return body
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('查询超时')
    if (error instanceof Error) throw error
    throw new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether one probe failure is worth retrying against the region's fallback
 * host. An auth rejection is the same on every host.
 * @param error - the failure of one probe.
 * @returns true when the fallback host may answer.
 */
export function isRetryableError(error) {
  const detail = `${error.name} ${error.message}`
  return /无法连接|证书|域名|超时|fetch failed|ssl|tls|certificate|ENOTFOUND|ECONN|ETIMEDOUT|AbortError|ECONNRESET/i.test(detail)
}

/**
 * The remaining share of one window, in percent.
 *
 * The endpoint answers either a percentage or a remaining/total pair; the
 * legacy shape answers a `usage_count` that is remaining quota rather than
 * consumed quota.
 * @param row - one model row of the quota answer.
 * @param window - `interval` (the 5-hour window) or `weekly`.
 * @returns the remaining share, or undefined when the row does not say.
 */
export function remainingPercent(row, window) {
  const percent = pickNumber(row, [
    `current_${window}_remaining_percent`,
    `${window}_remaining_percent`,
    `current_${window}_remain_percent`,
  ])
  if (percent !== undefined) return clamp(percent, 0, 100)
  const remaining = pickNumber(row, [
    `current_${window}_remaining_count`,
    `current_${window}_remains_count`,
    `${window}_remaining_count`,
    `${window}_remains_count`,
  ])
  const total = pickNumber(row, [`current_${window}_total_count`, `${window}_total_count`])
  if (remaining !== undefined && total !== undefined && total > 0) {
    return clamp((remaining / total) * 100, 0, 100)
  }
  const usageAsRemaining = pickNumber(row, [`current_${window}_usage_count`, `${window}_usage_count`])
  if (usageAsRemaining !== undefined && total !== undefined && total > 0) {
    return clamp((usageAsRemaining / total) * 100, 0, 100)
  }
  return undefined
}

/**
 * The time left in one window, in milliseconds.
 * @param row - one model row of the quota answer.
 * @param window - `interval` or `weekly`.
 * @returns the remaining time, or undefined when the row does not say.
 */
export function remainsMs(row, window) {
  const keys = window === 'interval'
    ? ['remains_time', 'current_interval_remains_time', 'interval_remains_time']
    : ['weekly_remains_time', 'current_weekly_remains_time']
  const value = pickNumber(row, keys)
  if (value === undefined || value < 0) return undefined
  return value
}

/**
 * The moment one window resets.
 * @param row - one model row of the quota answer.
 * @param window - `interval` or `weekly`.
 * @param now - the current epoch in milliseconds.
 * @param remainsTimeMs - the remaining time of the window.
 * @returns the reset moment in epoch milliseconds, or undefined.
 */
export function endAt(row, window, now, remainsTimeMs) {
  const raw = pickNumber(row, [
    window === 'interval' ? 'end_time' : 'weekly_end_time',
    `current_${window}_end_time`,
    `${window}_end_time`,
  ])
  const normalized = normalizeEpochMs(raw)
  if (normalized !== undefined) return normalized
  if (remainsTimeMs !== undefined) return now + remainsTimeMs
  return undefined
}

/**
 * The overall remaining share of one key, in percent.
 *
 * A key's share is the *weakest* of the windows it carries: a key with a full
 * weekly allowance but no 5-hour headroom is not usable now, and a key with
 * 5-hour headroom but an exhausted week is not usable for long. Taking the
 * minimum keeps the policy from handing out a key that fails immediately.
 * @param quota - the reduced quota of one key.
 * @returns the remaining share, or undefined when no window is known.
 */
export function overallRemainingPercent(quota) {
  if (quota === undefined || !quota.ok) return undefined
  const values = []
  for (const model of quota.models) {
    for (const percent of [model.intervalPercent, model.weeklyPercent]) {
      if (percent !== undefined) values.push(percent)
    }
  }
  if (values.length === 0) return undefined
  return Math.min(...values)
}

/**
 * The remaining share of ONE window, in percent.
 *
 * A key can carry several models, and each model has its own allowance. The
 * window's share is the WEAKEST of them: a key is only as usable as its
 * most exhausted model, so the smallest share is the number that tells the
 * user whether the window still has room.
 *
 * The 5-hour window and the weekly window are reported separately, because
 * they answer different questions — "how long can I keep going" and "how
 * long before the week is spent" — and a key can be in good shape in one
 * and empty in the other.
 * @param quota - the reduced quota of one key.
 * @param window - the 5-hour window ("interval") or the weekly one.
 * @returns the remaining share, or undefined when no window is known.
 */
export function windowRemainingPercent(quota, window) {
  if (quota === undefined || !quota.ok) return undefined
  const values = []
  for (const model of quota.models) {
    const percent = window === 'interval' ? model.intervalPercent : model.weeklyPercent
    if (percent !== undefined) values.push(percent)
  }
  if (values.length === 0) return undefined
  return Math.min(...values)
}

/**
 * The remaining share of the 5-hour window, in percent.
 * @param quota - the reduced quota of one key.
 * @returns the remaining share, or undefined when no window is known.
 */
export function intervalRemainingPercent(quota) {
  return windowRemainingPercent(quota, 'interval')
}

/**
 * The remaining share of the weekly window, in percent.
 * @param quota - the reduced quota of one key.
 * @returns the remaining share, or undefined when no window is known.
 */
export function weeklyRemainingPercent(quota) {
  return windowRemainingPercent(quota, 'weekly')
}

/**
 * The moment the weekly allowance of one key becomes available again.
 * @param quota - the reduced quota of one key.
 * @returns the reset moment in epoch milliseconds, or undefined.
 */
export function weeklyResetAt(quota) {
  if (quota === undefined || !quota.ok) return undefined
  const values = []
  for (const model of quota.models) {
    if (model.weeklyResetAt !== undefined) values.push(model.weeklyResetAt)
  }
  if (values.length === 0) return undefined
  return Math.max(...values)
}

/**
 * The moment the 5-hour window of one key resets.
 *
 * A key with several models resets at the LAST of their moments: until then
 * one of the models still holds the window open, so the key is worth nothing
 * to spend early.
 * @param quota - the reduced quota of one key.
 * @returns the reset moment in epoch milliseconds, or undefined.
 */
export function intervalResetAt(quota) {
  if (quota === undefined || !quota.ok) return undefined
  const values = []
  for (const model of quota.models) {
    if (model.intervalResetAt !== undefined) values.push(model.intervalResetAt)
  }
  if (values.length === 0) return undefined
  return Math.max(...values)
}

/**
 * The moment BOTH windows of one key reset.
 *
 * This is the moment the key is worth nothing: after it, the key is as
 * good as a fresh one. A key whose windows reset later keeps its allowance
 * for longer, so the routine path spends the sooner-resetting key first.
 * @param quota - the reduced quota of one key.
 * @returns the reset moment in epoch milliseconds, or undefined.
 */
export function fullResetAt(quota) {
  if (quota === undefined || !quota.ok) return undefined
  const values = []
  for (const model of quota.models) {
    for (const moment of [model.intervalResetAt, model.weeklyResetAt]) {
      if (moment !== undefined) values.push(moment)
    }
  }
  if (values.length === 0) return undefined
  return Math.max(...values)
}

/**
 * Decide whether one key has nothing left in either window.
 *
 * A key is EXHAUSTED when the 5-hour window is at zero, or when the weekly
 * window is at zero — either one is enough. A key with a full week but an
 * empty 5-hour window cannot serve a request until the 5-hour window rolls
 * over, and a key with 5-hour headroom but an exhausted week cannot serve
 * one until the week rolls over. Handing out such a key spends a request on a
 * key that can only fail.
 *
 * This rule is deliberately separate from {@link isResting}: resting is a
 * *policy* about how much headroom to keep (and it lasts until the week
 * resets), while exhaustion is a *fact* about the key's allowance. A key
 * that is exhausted is skipped no matter what the threshold says, and no
 * matter how the user pinned it.
 *
 * A key whose quota could not be read is NOT exhausted: an unknown allowance
 * is not a known-empty one, and refusing to use a key whose quota the probe
 * could not reach would take the route down.
 * @param quota - the reduced quota of one key.
 * @returns true when the key has nothing left in the 5-hour or the weekly
 * window.
 */
export function isExhausted(quota) {
  if (quota === undefined || !quota.ok) return false
  for (const model of quota.models) {
    if (model.intervalPercent === 0) return true
    if (model.weeklyPercent === 0) return true
  }
  return false
}

/**
 * The candidates that still have something left in either window.
 *
 * The exhausted candidates are taken out first, and the rest are returned in
 * their original order. When EVERY candidate is exhausted the original list
 * is returned unchanged: a request still has to be answered, and a key with
 * an empty window fails no worse than a key with no quota data at all.
 * @param candidates - the candidates to filter.
 * @returns the candidates that are not exhausted.
 */
export function dropExhausted(candidates) {
  const alive = candidates.filter((candidate) => !isExhausted(candidate.quota))
  return alive.length > 0 ? alive : candidates
}

/**
 * Decide whether one key is resting below the policy's threshold.
 *
 * A key rests when its remaining share is below the threshold *and* its
 * weekly window has not reset yet: once the week rolls over, the key becomes
 * available again without any user action.
 * @param quota - the reduced quota of one key.
 * @param thresholdPercent - the resting threshold.
 * @param now - the current epoch in milliseconds.
 * @returns true when the key must not be used.
 */
export function isResting(quota, thresholdPercent, now = Date.now()) {
  if (thresholdPercent <= 0) return false
  const remaining = overallRemainingPercent(quota)
  if (remaining === undefined) return false
  if (remaining >= thresholdPercent) return false
  const resetAt = weeklyResetAt(quota)
  if (resetAt !== undefined && resetAt <= now) return false
  return true
}

/**
 * Choose the key a provider should use for its next ROUTINE request.
 *
 * This is the routine path, and it is not the failure path: when a request
 * fails, the key to move to is chosen by {@link pickNextKey}.
 *
 * In `failure` mode the current key stays in use — the pool is walked only
 * by a failure, and the routine path leaves the credential alone. In
 * `remaining` mode the routine path itself moves the pool, onto the key
 * whose WEEK rolls over soonest, and among those the one whose 5-hour window
 * resets soonest.
 *
 * A key that is EXHAUSTED — with nothing left in the 5-hour window, or in
 * the weekly window, or in both — is never handed out, by any mode and
 * under no pin: such a key can only fail. A key whose quota is unknown is
 * not treated as exhausted.
 *
 * A key that is resting — below the policy threshold with its week not yet
 * rolled over — is skipped while another key is available; a key whose
 * weekly window has already reset becomes eligible again even when it
 * looked spent a moment ago.
 *
 * The "current key" is identified by its *value*, not by a reference: the
 * route's own reference (`MINIMAX_CN_API_KEY`) holds a copy of one pool
 * slot's value, so it never equals a candidate's slot reference. Matching on
 * the value is what lets the policy recognise that the chosen key is already
 * the key in use and leave the credential alone.
 * @param options - the policy, the candidates, and the clock.
 * @returns the chosen candidate, or undefined when every candidate rests.
 */
export function selectKey({ policy, candidates, currentValue, pinnedRef, now = Date.now() }) {
  const usable = candidates.filter((candidate) => candidate.enabled)
  if (usable.length === 0) return undefined
  // A key with nothing left in either window is taken out before anything
  // else: the pin, the threshold and the reset order all rank the candidates,
  // and none of them may rank a key that cannot serve a request.
  const alive = dropExhausted(usable)
  // A pinned key wins. The user named the key this provider should use, and
  // as long as it is usable it stays in use.
  const pinned = alive.find((candidate) => candidate.ref === pinnedRef)
  if (pinned !== undefined) return pinned
  if (policy.mode !== 'remaining') {
    return alive.find((candidate) => candidate.value === currentValue) ?? alive[0]
  }

  const resting = new Set()
  for (const candidate of alive) {
    if (isResting(candidate.quota, policy.thresholdPercent, now)) resting.add(candidate.ref)
  }
  const available = alive.filter((candidate) => !resting.has(candidate.ref))
  const pool = available.length > 0 ? available : alive

  // Without a quota answer the reset order is unknown, so the routine path
  // must not churn the credential on a guess: the key already in use stays
  // in use.
  const known = pool.filter((candidate) => intervalResetAt(candidate.quota) !== undefined
    || weeklyResetAt(candidate.quota) !== undefined)
  if (known.length === 0) {
    return pool.find((candidate) => candidate.value === currentValue) ?? pool[0]
  }

  // The reset order decides which key the routine path uses. The key
  // whose WEEK rolls over soonest wins outright: if the key already in use
  // is that one, it stays in use, which falls out of the ranking.
  return rankByResetOrder(pool)[0]
}

/**
 * Rank the candidates by the moment their windows reset.
 *
 * The order is the WEEKLY window first and the 5-hour window second: the key
 * whose week rolls over soonest is spent first, and among keys whose week
 * rolls over equally soon the one whose 5-hour window resets sooner is spent
 * first.
 *
 * The reasoning is that the weekly allowance is the scarcer resource. A key
 * whose week resets soonest is about to become a fresh key, so it is drained
 * now; a key whose week still has time keeps its allowance for later, and
 * spending it now would waste allowance with a long life. The 5-hour window
 * only breaks the tie between keys whose weeks end at the same moment.
 *
 * A key whose reset moment is unknown sorts last: an unknown reset is not
 * known to be near, and the policy must not spend a key it knows nothing
 * about ahead of one it does know about.
 * @param candidates - the candidates to rank.
 * @returns the candidates, soonest reset first.
 */
export function rankByResetOrder(candidates) {
  const scored = candidates.map((candidate) => ({
    candidate,
    interval: intervalResetAt(candidate.quota),
    weekly: weeklyResetAt(candidate.quota),
  }))
  return scored
    .sort((a, b) => {
      // The weekly window decides.
      if (a.weekly !== b.weekly) {
        if (a.weekly === undefined) return 1
        if (b.weekly === undefined) return -1
        return a.weekly - b.weekly
      }
      // Among keys whose week rolls over equally soon, the 5-hour window
      // decides.
      if (a.interval !== b.interval) {
        if (a.interval === undefined) return 1
        if (b.interval === undefined) return -1
        return a.interval - b.interval
      }
      return 0
    })
    .map((entry) => entry.candidate)
}

/**
 * Choose the key the pool switches to after a failure.
 *
 * This is the selection half of the switching policy, and it is separate
 * from the trigger half: the trigger is the failure, and the pool is
 * searched here for the key to move to.
 *
 * The pool is searched in RESET ORDER: the key whose WEEK rolls over soonest
 * comes first, and among those the one whose 5-hour window resets soonest. A
 * key that is about to reset is spent before its allowance expires, while a
 * key with more time left keeps its allowance for later.
 *
 * The key that just failed is left out of the search — it is the key that
 * did not work. A key with nothing left in either window is left out too:
 * moving onto it would only trade one failure for another. A key resting
 * below the policy's threshold is skipped while another key is available;
 * when every key rests, the resting ones are used anyway, because a failure
 * still has to be answered.
 *
 * With no quota known for any key, the pool is searched in its own order,
 * which keeps the walk deterministic instead of random.
 * @param options - the policy, the candidates, and the key that failed.
 * @returns the chosen candidate, or undefined when the pool is empty.
 */
export function pickNextKey({ policy, candidates, currentValue, pinnedRef, now = Date.now() }) {
  const usable = candidates.filter((candidate) => candidate.enabled)
  if (usable.length === 0) return undefined

  // The failed key is the one that did not work.
  //
  // A key with nothing left in either window is skipped before the search:
  // moving the route onto a key that cannot serve a request would only trade
  // one failure for another.
  //
  // The exhausted keys are taken out of the whole pool, not just out of the
  // search, because the search may be left with nothing but exhausted keys
  // while a healthy key is still sitting in the pool — the key that just
  // failed is excluded from the search, and excluding it must not make the
  // walk fall back onto an empty key when another key is still usable.
  const alive = dropExhausted(usable)
  const aliveSearch = alive.filter((candidate) => candidate.value !== currentValue)
  const search = aliveSearch.length > 0 ? aliveSearch : alive

  const resting = new Set()
  for (const candidate of search) {
    if (isResting(candidate.quota, policy.thresholdPercent, now)) resting.add(candidate.ref)
  }
  const available = search.filter((candidate) => !resting.has(candidate.ref))
  const pool = available.length > 0 ? available : search

  // A pinned key is the key the user wants this provider to use, so the walk
  // heads back to it when it is available. The pin is a preference, not a
  // lock: the failed key is still left out of the search, so a pin on the
  // key that just failed does not hand it out again.
  const pinned = pool.find((candidate) => candidate.ref === pinnedRef)
  if (pinned !== undefined) return pinned

  const ranked = rankByResetOrder(pool)
  if (ranked.length === 0) return pool[0]
  return ranked[0]
}

/**
 * The keys that must be kept back for the failure path.
 *
 * `reservePercent` is the minimum remaining share a key must hold to be
 * treated as reserve: a key above that share is held back for a failure, so
 * the routine path cannot spend the last healthy key and leave nothing to
 * fall back to. A key at or below the share is used routinely. With no
 * reserve configured, every key stays usable.
 * @param candidates - the eligible candidates.
 * @param reservePercent - the remaining share to keep in reserve.
 * @returns the candidates that may be used for a routine request.
 */
export function applyReserve(candidates, reservePercent) {
  if (reservePercent <= 0) return candidates
  const scored = candidates
    .map((candidate) => ({ candidate, remaining: overallRemainingPercent(candidate.quota) }))
    .filter((entry) => entry.remaining !== undefined)
  if (scored.length === 0) return candidates
  // A key with nothing left is never reserve: it is not a key the failure
  // path could fall back to, so holding it back would only take a usable key
  // out of the routine path for nothing.
  const reservable = scored.filter((entry) => entry.remaining > reservePercent && !isExhausted(entry.candidate.quota))
  if (reservable.length === 0) return candidates
  const reserved = new Set(reservable.map((entry) => entry.candidate.ref))
  const rest = candidates.filter((candidate) => !reserved.has(candidate.ref))
  return rest.length > 0 ? rest : candidates
}

/** Read a plain object, or undefined for anything else. */
function asRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value
}

/** Read an array, or undefined for anything else. */
function asArray(value) {
  return Array.isArray(value) ? value : undefined
}

/** Read a finite number, or undefined for anything else. */
function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a non-empty string, or undefined for anything else. */
function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read the first defined number among the named keys. */
function pickNumber(row, keys) {
  for (const key of keys) {
    const value = asNumber(row[key])
    if (value !== undefined) return value
  }
  return undefined
}

/** Clamp a percentage into 0…100. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** The model rows of a quota answer. */
function modelRowsOf(root) {
  const raw = root.model_remains ?? root.models ?? root.data
  const list = asArray(raw)
  if (list === undefined) return undefined
  const rows = []
  for (const item of list) {
    const record = asRecord(item)
    if (record !== undefined) rows.push(record)
  }
  return rows
}

/** The plan name of a quota answer. */
function planNameOf(root, rows) {
  const fromRoot = asString(root.current_subscribe_title)
    ?? asString(root.plan_name)
    ?? asString(root.subscribe_title)
    ?? asString(root.plan)
  if (fromRoot !== undefined) return fromRoot
  for (const row of rows) {
    const fromRow = asString(row.current_subscribe_title)
      ?? asString(row.plan_name)
      ?? asString(row.subscribe_title)
      ?? asString(row.plan)
    if (fromRow !== undefined) return fromRow
  }
  return undefined
}

/**
 * Normalize a timestamp that may be seconds, milliseconds, or a string.
 * @param value - the raw timestamp.
 * @returns epoch milliseconds, or undefined.
 */
function normalizeEpochMs(value) {
  if (value === undefined || value <= 0) return undefined
  // A 10-digit value is a second-based stamp; a 13-digit one is already
  // milliseconds.
  const asNumberValue = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(asNumberValue)) return undefined
  return asNumberValue < 1e12 ? asNumberValue * 1000 : asNumberValue
}
