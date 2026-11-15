/**
 * Verify the live MiniMax Token Plan quota endpoint against the plugin's own
 * parsing code.
 *
 * The unit tests use a recorded sample of the quota answer, so they prove the
 * parser handles a shape — not that the shape is the shape MiniMax sends.
 * This script closes that gap: it calls the real endpoint with a real key
 * and runs the raw answer through `quotaSummaryOf`, then checks every parsed
 * number against the raw field it came from.
 *
 * It needs a key. The key is read from the DSH credential store, so no
 * secret ever passes through a command line, an argument, or the output.
 * The key value is never printed.
 *
 * Usage:
 *   node scripts/verify-live-quota.mjs [--refs REF,REF,...]
 *
 * With no arguments it uses `MINIMAX_CN_API_KEY_POOL_1..5` from the
 * credential store.
 */
import { readFileSync } from 'node:fs'
import {
  fetchRemains,
  quotaSummaryOf,
  overallRemainingPercent,
  intervalRemainingPercent,
  weeklyRemainingPercent,
  intervalResetAt,
  weeklyResetAt,
  REGIONS,
} from '../src/pool.js'

const CREDENTIAL_STORE = process.env.DSH_CREDENTIALS ?? 'C:/Users/lshef/.dsh/.credentials.yaml'

/**
 * Pull the value of a credential reference out of the credential store.
 *
 * The store is a flat `refs:` mapping of `REF: value` lines.
 * @param {string} text - the whole credential file.
 * @param {string} ref - the credential reference.
 * @returns {string} the value, or an empty string.
 */
function refValue(text, ref) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_.-]+):\s*(.+?)\s*$/.exec(line)
    if (match && match[1] === ref) return match[2]
  }
  return ''
}

const refsArg = process.argv.includes('--refs')
  ? process.argv[process.argv.indexOf('--refs') + 1]
  : undefined
const refs = refsArg
  ? refsArg.split(',').map((ref) => ref.trim()).filter(Boolean)
  : [1, 2, 3, 4, 5].map((n) => `MINIMAX_CN_API_KEY_POOL_${n}`)

let credText
try {
  credText = readFileSync(CREDENTIAL_STORE, 'utf8')
} catch {
  console.error(`cannot read the credential store: ${CREDENTIAL_STORE}`)
  console.error('set DSH_CREDENTIALS to its path')
  process.exit(1)
}

let failures = 0
/**
 * Assert one condition.
 * @param {boolean} ok - whether the condition holds.
 * @param {string} what - what was checked.
 */
function check(ok, what) {
  if (!ok) failures++
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${what}`)
}

for (const ref of refs) {
  const key = refValue(credText, ref)
  console.log('='.repeat(70))
  console.log(ref)
  if (!key) {
    console.log('    no value in the credential store — skipped')
    continue
  }

  const now = Date.now()
  let raw
  try {
    raw = await fetchRemains(REGIONS.cn, key)
  } catch (error) {
    failures++
    console.log(`    FAIL  the endpoint could not be reached: ${error.message}`)
    continue
  }

  const row = raw.model_remains?.[0]
  const summary = quotaSummaryOf(raw)
  const model = summary.models?.[0]

  check(summary.ok === true, 'quotaSummaryOf ok')
  check(row !== undefined, 'the answer carries model_remains[0]')
  if (row === undefined || model === undefined) continue

  check(row.current_interval_status === 1, 'current_interval_status = 1')
  check(row.current_weekly_status === 1, 'current_weekly_status = 1')
  check(
    model.intervalPercent === row.current_interval_remaining_percent,
    `intervalPercent ${model.intervalPercent} === raw ${row.current_interval_remaining_percent}`,
  )
  check(
    model.weeklyPercent === row.current_weekly_remaining_percent,
    `weeklyPercent ${model.weeklyPercent} === raw ${row.current_weekly_remaining_percent}`,
  )
  check(model.intervalResetAt === row.end_time, 'intervalResetAt === raw end_time')
  check(model.weeklyResetAt === row.weekly_end_time, 'weeklyResetAt === raw weekly_end_time')

  // The countdown the card shows must agree with the raw remains_time.
  const intervalDelta = Math.abs(model.intervalResetAt - now - row.remains_time)
  const weeklyDelta = Math.abs(model.weeklyResetAt - now - row.weekly_remains_time)
  check(intervalDelta < 60_000, `the 5-hour countdown agrees with remains_time (${intervalDelta} ms)`)
  check(weeklyDelta < 60_000, `the weekly countdown agrees with weekly_remains_time (${weeklyDelta} ms)`)

  check(model.weeklyResetAt > model.intervalResetAt, 'the week ends after the 5-hour window')
  check(model.intervalResetAt > now, 'the 5-hour reset is in the future')
  check(model.weeklyResetAt > now, 'the weekly reset is in the future')

  const overall = overallRemainingPercent(summary)
  check(
    overall === Math.min(intervalRemainingPercent(summary), weeklyRemainingPercent(summary)),
    'the overall share is the weakest of the two windows',
  )

  console.log(
    `    ->  5h ${model.intervalPercent}% (resets in ${Math.round((model.intervalResetAt - now) / 60000)} min), ` +
    `weekly ${model.weeklyPercent}% (resets in ${Math.round((model.weeklyResetAt - now) / 3600000)} h)`,
  )
}

console.log('='.repeat(70))
console.log(failures === 0 ? 'RESULT: every live field check passed' : `RESULT: ${failures} check(s) failed`)
if (failures > 0) process.exit(1)
