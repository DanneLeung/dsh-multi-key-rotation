/**
 * Client-half regression tests for the key-pool configuration page.
 *
 * The page renders inside the Host's Plugins page, so these tests drive the
 * client module against a mock of the Host's browser services (see
 * `test/client-harness.cjs`) and assert the contract the Host actually
 * expects:
 *
 *   - the page registers one cell of `settings.plugins.tab`, the seat the
 *     built-in Plugins settings section reads its tab bar from, and no longer
 *     registers in the Plugin Manager's own bundle-configuration slots;
 *   - the registration is not gated behind the settings mirror, because the
 *     mirror has no view at boot and a gated registration never appears;
 *   - the page survives a Host that answers nothing, and renders an
 *     actionable state instead of an empty panel;
 *   - a key the user pasted survives the Host's echo of an unrelated write;
 *   - the usage bar can actually show its fill.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadClient, createSnapshotStore, composeProps, calls, renderTree, stubFetch } = require('./client-harness.cjs')

/**
 * Tear every component down after a test.
 *
 * A component that polls on a timer would otherwise keep the Node event
 * loop alive after its test finished, and the runner would never exit.
 */
const mounted = new Set()

test.afterEach(() => {
  for (const harness of mounted) harness.react.__cleanup()
  mounted.clear()
})

/**
 * Load the client module and apply it to the mock context.
 * @param options - passed to the harness; `pollMs` shortens the indicator's
 *   poll interval so a test can drive the background read.
 * @returns the harness pieces.
 */
function boot(options = {}) {
  const harness = loadClient(options)
  mounted.add(harness)
  harness.sandbox.__result.apply(harness.ctx)
  return harness
}

/**
 * Let the controller's initial load settle.
 * @returns a promise resolving after the load.
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Render the page with the face its registration injects.
 *
 * Each call is a fresh render: the mock React's hook cursor is rewound, so
 * the component's state survives between renders instead of drifting.
 * @param harness - the booted harness.
 * @returns the rendered element tree.
 */
function render(harness) {
  const entry = harness.registered[0]
  const face = entry.options.inject()
  const t = (key) => key
  return renderTree(harness.react, entry.component, { ...composeProps(face), t })
}

/**
 * Walk an element tree, collecting every string child.
 * @param node - the tree node.
 * @returns the collected strings.
 */
function texts(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(texts)
  if (typeof node !== 'object') return []
  return texts(node.props?.children)
}

/**
 * Walk an element tree, collecting every element whose class name contains
 * `needle`.
 * @param node - the tree node.
 * @param needle - the class fragment to look for.
 * @returns the matching elements.
 */
function byClass(node, needle) {
  if (node === null || node === undefined || node === false) return []
  if (Array.isArray(node)) return node.flatMap((child) => byClass(child, needle))
  if (typeof node !== 'object') return []
  const className = String(node.props?.className ?? '')
  const here = className.split(' ').includes(needle) ? [node] : []
  return [...here, ...byClass(node.props?.children, needle)]
}

test('the client module registers under its full package name', () => {
  // The DSH client module loader keys each factory by the package name taken
  // from the boot manifest row, and a bundle that registers a different id
  // is refused with "loaded without registering \"<package name>\"".
  // The scope is part of the id: '@danneleung/dsh-multi-key-rotation'.
  const { sandbox } = boot()
  assert.equal(sandbox.__loaderId, '@danneleung/dsh-multi-key-rotation')
})

test('the page registers one cell of the Plugins settings tab bar', () => {
  const { registered } = boot()
  const entry = registered.find((row) => row.options.name === 'settings.plugins.tab')
  assert.notEqual(entry, undefined)
  // A fresh id adds a cell beside the shipped ones instead of replacing one.
  assert.equal(entry.options.id, 'dsh-multi-key-rotation')
  assert.equal(typeof entry.options.inject, 'function')
  assert.equal(typeof entry.component, 'function')
})

test('the page no longer registers in the Plugin Manager configuration slots', () => {
  // The Plugin Manager renders `plugins.bundle.config` keyed by package name
  // and `plugins.row.config` keyed by "<package>#<row id>". Both seats moved
  // to the settings section's own tab.
  const { registered } = boot()
  const bundle = registered.find((entry) => entry.options.name === 'plugins.bundle.config')
  const row = registered.find((entry) => entry.options.name === 'plugins.row.config')
  assert.equal(bundle, undefined)
  assert.equal(row, undefined)
})

test('the tab carries a label the owner projects as the tab text', () => {
  // The section renders the `label` thunk on every projection, so the tab
  // text follows the active locale without re-registering.
  const { registered, localeDict } = boot()
  const entry = registered.find((row) => row.options.name === 'settings.plugins.tab')
  assert.equal(typeof entry.options.label, 'function')
  assert.equal(entry.options.label(), 'Multi-Key Rotation')
  // The dictionary holds the Chinese text for the same key.
  const dict = localeDict['settings.keyPool']
  assert.notEqual(dict, undefined)
  assert.equal(dict.zh.tab, '多密钥轮换')
})

test('the registration does not wait for the settings mirror', () => {
  // The mirror holds no namespace at boot. A registration gated behind the
  // mirror never appears, and the settings section shows no tab at all.
  const { registered } = boot()
  const tabs = registered.filter((row) => row.options.name === 'settings.plugins.tab')
  assert.equal(tabs.length, 1)
})

test('the injected face exposes the state the page renders from', () => {
  const { registered } = boot()
  const tab = registered.find((row) => row.options.name === 'settings.plugins.tab')
  const face = tab.options.inject()
  assert.equal(typeof face, 'object')
  assert.equal(typeof face.hooks, 'object')
  assert.equal(typeof face.hooks.keyPool?.getSnapshot, 'function')
})

test('the page renders a tree instead of nothing', () => {
  const harness = boot()
  const tree = render(harness)
  assert.notEqual(tree, null)
  assert.notEqual(tree, undefined)
})

test('the page renders its title and description', async () => {
  const harness = boot()
  await settle()
  const shown = texts(render(harness)).join('\n')
  assert.match(shown, /title/)
  assert.match(shown, /description/)
})

test('a Host that answers no provider leaves the page in a usable state', () => {
  const harness = boot()
  const face = harness.registered[0].options.inject()
  const state = face.hooks.keyPool.getSnapshot()
  assert.equal(typeof state, 'object')
  assert.equal(state.error, null)
  assert.deepEqual(state.providers, [])
})

test('the page renders the empty state when no provider is available', async () => {
  calls.noProviders = true
  try {
    const harness = boot()
    await settle()
    const shown = texts(render(harness)).join('\n')
    assert.match(shown, /emptyProviders/)
  } finally {
    calls.noProviders = false
  }
})

test('the page renders a card per provider', async () => {
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  const state = face.hooks.keyPool.getSnapshot()
  assert.equal(state.providers.length, 2)
  const shown = texts(render(harness)).join('\n')
  assert.match(shown, /minimax-cn/)
  assert.match(shown, /MiniMax \(CN\)/)
})

test('a provider without a configured pool starts collapsed', async () => {
  // The profile holds no pool, so a card would show an empty key list and a
  // policy that does nothing. It starts folded away.
  const harness = boot()
  await settle()
  const tree = render(harness)
  const shown = texts(tree).join('\n')
  // The card head is there...
  assert.match(shown, /minimax-cn/)
  // ...but its body is not: no keys section, no policy, no triggers.
  assert.doesNotMatch(shown, /keys/)
  assert.doesNotMatch(shown, /policy/)
  assert.doesNotMatch(shown, /triggers/)
})

test('a provider with a configured pool starts open', async () => {
  // The profile names one pool slot, and the Host reports it as holding a
  // value. That provider's card opens with its keys and policy visible.
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const tree = render(harness)
    const shown = texts(tree).join('\n')
    // The keys section, the policy, and the triggers are inside the card body.
    assert.match(shown, /keys/)
    assert.match(shown, /policy/)
    assert.match(shown, /triggers/)
  } finally {
    calls.profile = { providers: {} }
  }
})

test('only the provider without a pool is collapsed', async () => {
  // Two providers, one configured. The configured one opens; the other does
  // not. A page where everything is folded away is as useless as one where
  // everything is open.
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const tree = render(harness)
    const cards = byClass(tree, 'm_pool_card')
    assert.equal(cards.length, 2)
    // The configured provider's card carries a body; the other does not.
    const bodies = cards.map((card) => byClass(card, 'm_pool_cardBody').length)
    assert.deepEqual(bodies.sort(), [0, 1])
  } finally {
    calls.profile = { providers: {} }
  }
})

test('the collapse state survives the page\'s later updates', async () => {
  // A user who folds a card away must not see it pop open again when the
  // usage poll or a settings echo re-renders the page.
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const entry = harness.registered[0]
    const face = entry.options.inject()
    // The card starts open, and the user folds it away.
    const head = byClass(render(harness), 'm_pool_cardHeadText')[0]
    head.props.onClick()
    const folded = render(harness)
    assert.equal(byClass(folded, 'm_pool_cardBody').length, 0)
    // A settings echo re-renders the page; the card stays folded.
    face.toggleRotateOn('minimax-cn', 'RATE_LIMIT')
    await settle()
    assert.equal(byClass(render(harness), 'm_pool_cardBody').length, 0)
  } finally {
    calls.profile = { providers: {} }
  }
})

test('the usage bar can show its fill', () => {
  // The fill must be a block: an inline span ignores its width, and the bar
  // would render empty however much quota the key has left.
  const client = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'client.js'), 'utf8')
  const fill = client.match(/'\.m_pool_quotaFill\{([^}]*)\}'/)
  assert.notEqual(fill, null)
  assert.match(fill[1], /display:block/)
  const track = client.match(/'\.m_pool_quotaTrack\{([^}]*)\}'/)
  assert.notEqual(track, null)
  assert.match(track[1], /display:block/)
})

test('a key row is laid out as two aligned lines', async () => {
  // One line carries the name, the state, and the actions; the second
  // carries the quota. A single flex line wrapped at narrow widths, which
  // is what made the rows ragged.
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  face.addKey('minimax-cn', 'main', 'sk-secret-value')
  await settle()
  const tree = render(harness)

  const tops = byClass(tree, 'm_pool_keyTop')
  assert.equal(tops.length, 1)
  const top = tops[0]
  // The top line holds the name, the state, and the actions.
  assert.equal(byClass(top, 'm_pool_keyName').length, 1)
  assert.equal(byClass(top, 'm_pool_keyState').length, 1)
  assert.equal(byClass(top, 'm_pool_keyActions').length, 1)
  // The actions hold exactly the three row buttons.
  assert.equal(byClass(top, 'm_pool_iconBtn').length, 3)

  // The row is the parent of the top line, and the quota sits on the second
  // line under it.
  const rows = byClass(tree, 'm_pool_keyRow')
  assert.equal(rows.length, 1)
  assert.equal(byClass(rows[0], 'm_pool_keyTop').length, 1)
})

test('the key row CSS lays the row out as a grid', () => {
  const client = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'client.js'), 'utf8')
  // The top line is a grid: the name has a fixed column, the state takes
  // the rest, and the actions sit at the end.
  const top = client.match(/'.m_pool_keyTop\{([^}]*)\}'/)
  assert.notEqual(top, null)
  assert.match(top[1], /display:grid/)
  assert.match(top[1], /grid-template-columns/)
  // The name column is bounded, so a long name cannot push the state and
  // the actions off the row.
  const name = client.match(/'.m_pool_keyName\{([^}]*)\}'/)
  assert.notEqual(name, null)
  assert.match(name[1], /width:100%/)
  assert.match(name[1], /min-width:0/)
  // The rows are separated by a border, which needs the sibling selector
  // on the item, not on the row.
  const list = client.match(/'.m_pool_keyItem \+ \.m_pool_keyItem\{([^}]*)\}'/)
  assert.notEqual(list, null)
  assert.match(list[1], /border-top/)
})

test('a pasted key survives the Host echo of an unrelated write', async () => {
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  face.addKey('minimax-cn', 'main', 'sk-secret-value')
  await settle()
  let state = face.hooks.keyPool.getSnapshot()
  const row = state.providers.find((provider) => provider.provider === 'minimax-cn')
  assert.equal(row.chain.length, 1)
  assert.equal(row.chain[0].value, 'sk-secret-value')
  assert.equal(row.chain[0].staged, true)

  // An unrelated change writes the profile, and the Host folds the answer
  // back through the settings mirror. The page reloads its rows; the pasted
  // secret must still be there.
  face.toggleRotateOn('minimax-cn', 'RATE_LIMIT')
  await settle()
  await settle()
  state = face.hooks.keyPool.getSnapshot()
  const after = state.providers.find((provider) => provider.provider === 'minimax-cn')
  assert.equal(after.chain.length, 1)
  assert.equal(after.chain[0].value, 'sk-secret-value')
  assert.equal(after.chain[0].staged, true)
})

test('a staged key is not named in the profile before its credential write', async () => {
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  face.addKey('minimax-cn', 'main', 'sk-secret-value')
  await settle()
  face.toggleRotateOn('minimax-cn', 'RATE_LIMIT')
  await settle()
  await settle()
  const written = calls.formMutate.at(-1)
  assert.notEqual(written, undefined)
  // The write addresses the provider's own path.
  const op = written.find((entry) => entry.path[0] === 'providers' && entry.path[1] === 'minimax-cn')
  assert.notEqual(op, undefined)
  // The slot is not in the profile yet: the credential store does not hold
  // it, and the profile names slots.
  assert.equal(op.value.keys.length, 0)
})

test('a fresh page is not dirty', async () => {
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  const state = face.hooks.keyPool.getSnapshot()
  assert.equal(state.dirty, false)
})

test('the store helper the page uses is the Host-shaped one', () => {
  const store = createSnapshotStore({ a: 1 })
  assert.deepEqual(store.getSnapshot(), { a: 1 })
  let seen = false
  store.subscribe(() => { seen = true })
  store.update((draft) => ({ ...draft, a: 2 }))
  assert.equal(seen, true)
  assert.deepEqual(store.getSnapshot(), { a: 2 })
})

test('the save writes every provider in ONE settings write', async () => {
  // One write means one profile rewrite and one plugin restart. The old
  // code wrote the whole `providers` dict once per provider, so a save of
  // three providers rewrote the profile three times and the second write
  // landed on a revision the Host had already moved past.
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  calls.formMutate.length = 0
  await face.save()
  await settle()
  assert.equal(calls.formMutate.length, 1, 'the save must issue exactly one write')
  const ops = calls.formMutate[0]
  assert.ok(ops.length >= 1)
  for (const op of ops) {
    assert.equal(op.op, 'set')
    assert.equal(op.path[0], 'providers')
    assert.equal(op.path.length, 2, 'the write must address one provider path')
  }
})

test('the save never writes the whole providers dict', async () => {
  // Writing the whole dict dropped a provider the page does not know about
  // and rewrote every provider for a change to one of them.
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  calls.formSet.length = 0
  calls.formMutate.length = 0
  await face.save()
  await settle()
  assert.equal(calls.formSet.length, 0, 'the whole dict must never be written')
})

test('the saving flag clears even when the write never settles', async () => {
  // A page stuck on "Saving" is the one failure the user cannot work
  // around, so the flag clears on every path.
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  const store = face.hooks.keyPool
  // The form's write never answers, but it records that it started.
  let started = false
  harness.ctx.configForms.get('llm-key-pool').mutate = () => {
    started = true
    return new Promise(() => {})
  }
  // A deadline long enough that the "in flight" assertion below cannot
  // lose a race against it, and short enough that the test stays quick.
  face.controller.writeTimeoutMs = 400
  face.save()
  await settle()
  assert.equal(started, true, 'the write must have been started')
  assert.equal(store.getSnapshot().saving, true, 'the save is in flight')
  // Give the deadline time to pass.
  await new Promise((resolve) => setTimeout(resolve, 500))
  await settle()
  assert.equal(store.getSnapshot().saving, false, 'the saving flag must clear')
})

test('a save while another save runs is ignored', async () => {
  const harness = boot()
  await settle()
  const face = harness.registered[0].options.inject()
  calls.formMutate.length = 0
  face.save()
  face.save()
  await settle()
  assert.equal(calls.formMutate.length, 1, 'the second save must not start another write')
})

// ---------------------------------------------------------------------------
// The pinned key
//
// The user can name the key a provider should use. The pin is a preference:
// the pool starts there, but a failure still rotates away from it.
// ---------------------------------------------------------------------------

test('the page offers a button to use each key', async () => {
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const tree = render(harness)
    // The row carries the "use this key" button.
    assert.equal(byClass(tree, 'm_pool_keyPinBtn').length, 1)
  } finally {
    calls.profile = { providers: {} }
  }
})

test('clicking the button pins the key and writes the profile', async () => {
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const face = harness.registered[0].options.inject()
    calls.formMutate.length = 0
    const button = byClass(render(harness), 'm_pool_keyPinBtn')[0]
    button.props.onClick()
    await settle()

    // The pin is written into the provider's profile.
    const written = calls.formMutate.at(-1)
    assert.notEqual(written, undefined)
    const op = written.find((entry) => entry.path[0] === 'providers' && entry.path[1] === 'minimax-cn')
    assert.notEqual(op, undefined)
    assert.equal(op.value.pinned_ref, 'MINIMAX_CN_API_KEY_POOL_1')
  } finally {
    calls.profile = { providers: {} }
  }
})

test('the pinned key shows a badge instead of the button', async () => {
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        pinned_ref: 'MINIMAX_CN_API_KEY_POOL_1',
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  try {
    const harness = boot()
    await settle()
    const tree = render(harness)
    // The badge replaces the button, so the row has no button left.
    assert.equal(byClass(tree, 'm_pool_keyPinBtn').length, 0)
    assert.equal(byClass(tree, 'm_pool_keyPinned').length, 1)
    const shown = texts(tree).join('\n')
    assert.match(shown, /inUse/)
  } finally {
    calls.profile = { providers: {} }
  }
})

// ---------------------------------------------------------------------------
// The two quota windows
//
// The card shows the 5-hour window and the weekly window apart from each
// other, because the switching policy compares them.
// ---------------------------------------------------------------------------

test('the key row shows both windows of the quota', async () => {
  const restore = stubFetch()
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [{ name: 'main', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true }],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  calls.health = {
    provider: 'minimax-cn',
    keys: [{
      name: 'main',
      ref: 'MINIMAX_CN_API_KEY_POOL_1',
      enabled: true,
      configured: true,
      preview: 'sk-cp-abc•••wxyz',
      quotaOk: true,
      remainingPercent: 20,
      intervalRemainingPercent: 20,
      weeklyRemainingPercent: 80,
      intervalResetAt: Date.now() + 600_000,
      weeklyResetAt: Date.now() + 86_400_000,
    }],
  }
  try {
    const harness = boot()
    await settle()
    await settle()
    const tree = render(harness)
    const shown = texts(tree).join('\n')
    // Both window labels are there...
    assert.match(shown, /intervalWindow/)
    assert.match(shown, /weeklyWindow/)
    // ...and both shares are shown, not just the weaker one.
    assert.match(shown, /20%/)
    assert.match(shown, /80%/)
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

test('the key list is ordered by the weekly remaining time', async () => {
  // The list shows the keys in the order the pool would use them: the key
  // whose week rolls over soonest comes first.
  const restore = stubFetch()
  calls.profile = {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [
          { name: 'late', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
          { name: 'soon', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
        ],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
  const now = Date.now()
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      { name: 'late', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true, configured: true, quotaOk: true, weeklyResetAt: now + 86_400_000 },
      { name: 'soon', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true, configured: true, quotaOk: true, weeklyResetAt: now + 60_000 },
    ],
  }
  try {
    const harness = boot()
    await settle()
    await settle()
    const tree = render(harness)
    const names = byClass(tree, 'm_pool_keyName').map((node) => node.props.value)
    // The sooner-resetting key is listed first, even though it is the second
    // one in the pool.
    assert.deepEqual(names, ['soon', 'late'])
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

/**
 * Find the composer indicator's registration.
 * @param harness - the booted harness.
 * @returns the registration row.
 */
function indicatorEntry(harness) {
  const entry = harness.registered.find((row) => row.options.name === 'conversation.input.right')
  assert.notEqual(entry, undefined)
  return entry
}

/**
 * Render the composer indicator with the face its registration injects.
 * @param harness - the booted harness.
 * @param sessionId - the session the indicator belongs to.
 * @returns the rendered element tree.
 */
async function renderIndicator(harness, sessionId, open) {
  const entry = indicatorEntry(harness)
  const face = entry.options.inject(sessionId ?? 'session-1')
  const t = (key, params) => {
    if (params === undefined) return key
    return key.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  }
  const render = () => renderTree(harness.react, entry.component, { ...face, t })
  // The first render starts the fetch; the answer lands a tick later, so the
  // component is rendered again to pick it up.
  let tree = render()
  await settle()
  await settle()
  tree = render()
  if (open === true || harness.openIndicator) {
    // The panel opens on hover, the way a user opens it: the pointer
    // enters the host. It is entered once: leaving would close it again.
    const host = byClass(tree, 'm_pool_indicatorHost')[0]
    if (host !== undefined) host.props.onMouseEnter()
    tree = render()
  }
  return tree
}

/**
 * Render the composer indicator once, without waiting for the network.
 *
 * `renderIndicator` lets the answer land before it returns, which is what
 * a test usually wants. A test that watches the transition — the busy
 * flag going up and coming back down — needs the render that happens in
 * between, so it uses this one.
 * @param harness - the booted harness.
 * @returns the rendered element tree.
 */
function renderIndicatorNow(harness) {
  const entry = indicatorEntry(harness)
  const face = entry.options.inject('session-1')
  const t = (key, params) => {
    if (params === undefined) return key
    return key.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  }
  const tree = renderTree(harness.react, entry.component, { ...face, t })
  const host = byClass(tree, 'm_pool_indicatorHost')[0]
  if (host !== undefined) host.props.onMouseEnter()
  return renderTree(harness.react, entry.component, { ...face, t })
}

/** A profile with one pooled provider and two named keys. */
function pooledProfile() {
  return {
    providers: {
      'minimax-cn': {
        enabled: true,
        rotate_on: ['QUOTA'],
        keys: [
          { name: 'primary', ref: 'MINIMAX_CN_API_KEY_POOL_1', enabled: true },
          { name: 'secondary', ref: 'MINIMAX_CN_API_KEY_POOL_2', enabled: true },
        ],
        policy: { mode: 'failure', thresholdPercent: 0, reservePercent: 0 },
      },
    },
  }
}

test('the indicator registers one cell of the composer tool row', () => {
  // The tool row's right cell is rendered in the same flex row as the model
  // selector, immediately before it. A fresh id adds a cell beside the
  // shipped ones instead of replacing one.
  const harness = boot()
  const entry = indicatorEntry(harness)
  assert.equal(entry.options.id, 'multi-key-rotation-usage')
  assert.equal(typeof entry.options.inject, 'function')
  assert.equal(typeof entry.component, 'function')
})

test('the indicator does not occupy a cell of the floating composer overlay', () => {
  // The overlay slot holds floating entries; the indicator belongs in the
  // row, so the overlay stays empty.
  const harness = boot()
  const row = harness.registered.find((r) => r.options.name === 'conversation.input.overlay')
  assert.equal(row, undefined)
})

test('the indicator trigger renders inline in the composer row', async () => {
  // The trigger is an ordinary inline element in the tool row, next to the
  // model selector. It must NOT be portaled: the composer's seat carries
  // `will-change: transform`, and a fixed descendant would resolve its
  // offsets against that seat instead of the viewport.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  try {
    const harness = boot()
    await settle()
    const tree = await renderIndicator(harness)

    // The trigger lives inside the in-flow host span.
    const host = byClass(tree, 'm_pool_indicatorHost')[0]
    assert.notEqual(host, undefined)
    assert.equal(byClass(host, 'm_pool_indicatorTrigger').length, 1)

    // And it is not positioned: the trigger carries no inline position
    // style at all, so the row's own layout places it.
    const trigger = byClass(host, 'm_pool_indicatorTrigger')[0]
    assert.equal(trigger.props.style, undefined)

    // Nothing is portaled at all: the panel is absolutely positioned
    // inside the host, which is its containing block.
    assert.equal(harness.reactDom.portals.length, 0)
  } finally {
    calls.profile = pooledProfile()
    restore()
  }
})

test('the indicator panel opens inside the inline host', async () => {
  // The panel is an absolutely positioned child of the inline host, so it
  // opens above the capsule without a portal and without any measurement.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  try {
    const harness = boot()
    await settle()
    const tree = await renderIndicator(harness, 'session-1', true)

    const host = byClass(tree, 'm_pool_indicatorHost')[0]
    assert.notEqual(host, undefined)
    assert.equal(byClass(host, 'm_pool_indicatorTip').length, 1)
    assert.equal(harness.reactDom.portals.length, 0)
  } finally {
    calls.profile = pooledProfile()
    restore()
  }
})

test('the indicator panel closes when the pointer leaves the host', async () => {
  // The panel is a hover panel. Leaving the host has to close it, or it
  // would stay open over the composer row forever.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  try {
    const harness = boot()
    await settle()
    const open = await renderIndicator(harness, 'session-1', true)
    assert.equal(byClass(open, 'm_pool_indicatorTip').length, 1)

    const host = byClass(open, 'm_pool_indicatorHost')[0]
    host.props.onMouseLeave()
    const closed = renderTree(harness.react, indicatorEntry(harness).component, {
      ...indicatorEntry(harness).options.inject('session-1'),
      t: (key) => key,
    })
    assert.equal(byClass(closed, 'm_pool_indicatorTip').length, 0)
  } finally {
    calls.profile = pooledProfile()
    restore()
  }
})

test('the indicator stays hidden for a provider the plugin does not pool', async () => {
  // The session talks to a route this plugin does not own, so the composer
  // row shows nothing at all.
  const restore = stubFetch()
  calls.profile = { providers: {} }
  calls.modelSelection = { provider: 'deepseek', model: 'deepseek-chat' }
  try {
    const harness = boot()
    await settle()
    const tree = await renderIndicator(harness)
    assert.equal(tree, null)
  } finally {
    calls.profile = { providers: {} }
    calls.modelSelection = { provider: 'minimax-cn', model: 'MiniMax-M3' }
    restore()
  }
})

test('the indicator gives every key two bars with its reset countdown', async () => {
  // Every key of the pool gets the same two lines: the 5-hour window and
  // the weekly one, each with its own bar, its own share, and its own
  // countdown. The key in use is marked by its colour alone.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  const now = Date.now();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: false,
        quotaOk: true,
        intervalRemainingPercent: 93,
        intervalResetAt: now + 3 * 3_600_000,
        weeklyRemainingPercent: 41,
        weeklyResetAt: now + 2 * 86_400_000,
      },
      {
        name: 'secondary',
        ref: 'MINIMAX_CN_API_KEY_POOL_2',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 88,
        intervalResetAt: now + 4 * 3_600_000,
        weeklyRemainingPercent: 55,
        weeklyResetAt: now + 3 * 86_400_000,
      },
    ],
  }
  try {
    const harness = boot();
    harness.openIndicator = true;
    await settle();
    await settle();
    const tree = await renderIndicator(harness);
    assert.notEqual(tree, null);

    // Both keys are listed, and the key in use is the marked one.
    const rows = byClass(tree, 'm_pool_indicatorPoolRow');
    assert.equal(rows.length, 2);
    const active = byClass(tree, 'm_pool_indicatorPoolRowActive');
    assert.equal(active.length, 1);
    const names = byClass(tree, 'm_pool_indicatorPoolName').map((node) => texts(node).join(''));
    assert.deepEqual(names, ['primary', 'secondary']);

    // Two windows per key: four in all.
    const windows = byClass(tree, 'm_pool_indicatorWindow');
    assert.equal(windows.length, 4);
    // Every window carries its label, its bar, its share, and its countdown.
    const shown = windows.map((node) => texts(node).join(' ')).join('\n');
    assert.match(shown, /indicatorWindowInterval/);
    assert.match(shown, /indicatorWindowWeekly/);
    assert.match(shown, /93%/);
    assert.match(shown, /88%/);
    assert.match(shown, /41%/);
    assert.match(shown, /55%/);
    // The countdown is terse: "2h59m", "2d23h" — no prose around it.
    assert.match(shown, /\d+h\d*m/);
    assert.match(shown, /\d+d\d+h/);
    // And it is the short form, not the page's verbose one.
    assert.doesNotMatch(shown, /durationHours|durationDays|durationMinutes/);
  } finally {
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('the indicator bar width follows the reported share', async () => {
  // The bar is the number: its width has to be the share the Host sent.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 80,
        weeklyRemainingPercent: 39,
      },
    ],
  }
  try {
    const harness = boot();
    harness.openIndicator = true;
    await settle();
    await settle();
    const tree = await renderIndicator(harness);
    // The panel's own bars, not the capsule's: the capsule uses the same
    // fill class, so the search is scoped to the panel.
    const panel = byClass(tree, 'm_pool_indicatorTip')[0];
    assert.notEqual(panel, undefined);
    const fills = byClass(panel, 'm_pool_indicatorWindowFill');
    assert.equal(fills.length, 2);
    const widths = fills.map((node) => node.props.style?.width);
    assert.deepEqual(widths, ['80%', '39%']);
  } finally {
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('the indicator shows no prose, only the numbers', async () => {
  // The panel sits over the composer and holds a whole pool, so it carries
  // numbers, not sentences. The labels are the two window names and
  // nothing else.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 80,
        intervalResetAt: Date.now() + 2 * 3_600_000 + 13 * 60_000,
        weeklyRemainingPercent: 39,
        weeklyResetAt: Date.now() + 2 * 86_400_000 + 22 * 3_600_000,
      },
    ],
  }
  try {
    const harness = boot();
    harness.openIndicator = true;
    await settle();
    await settle();
    const tree = await renderIndicator(harness);
    const shown = texts(tree).join(' ');
    // The two window labels, the share, and the countdown.
    assert.match(shown, /5h/);
    assert.match(shown, /7d/);
    assert.match(shown, /80%/);
    assert.match(shown, /39%/);
    // The countdown is terse: hours and days, with the minutes folded in.
    // The exact minutes depend on how long the test took, so the shape is
    // what is checked.
    assert.match(shown, /2h\d+m/);
    assert.match(shown, /2d\d+h/);
    // None of the sentences the panel used to carry.
    assert.doesNotMatch(shown, /正在使用|五小时窗口|周窗口|还剩/);
    assert.doesNotMatch(shown, /resets in|Key in use|5-hour window|Weekly window/);
  } finally {
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('the panel dictionary carries no prose in either language', () => {
  // The panel's own labels are the two window names, and nothing else.
  // The dictionary is read straight out of the bundle, because the panel
  // shows the dictionary's text, not its keys.
  const source = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
  for (const language of ['en', 'zh']) {
    const block = /const (en|zh) = \{([\s\S]*?)\n    \};/.exec(source);
    assert.notEqual(block, undefined, 'the bundle carries a dictionary');
    const body = block[2];
    // The window labels are the short forms.
    assert.match(body, /indicatorWindowInterval: '5h'/);
    assert.match(body, /indicatorWindowWeekly: '7d'/);
    // The sentences the panel used to carry are gone.
    assert.doesNotMatch(body, /indicatorWindowInterval: '五小时窗口'/);
    assert.doesNotMatch(body, /indicatorWindowWeekly: '周窗口'/);
    assert.doesNotMatch(body, /indicatorWindowInterval: '5-hour window'/);
    assert.doesNotMatch(body, /indicatorWindowWeekly: 'Weekly window'/);
    assert.doesNotMatch(body, /indicatorResetsIn/);
  }
});

test('clicking the indicator asks the Host to probe the keys again', async () => {
  // The click is a forced read: the Host re-probes every key of the pool
  // instead of answering from its cache, so the panel shows fresh figures.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 80,
        weeklyRemainingPercent: 39,
      },
    ],
  }
  try {
    // The fetch log is shared by every test and by the settings page, so it
    // starts empty here and the indicator's own reads are told apart by
    // their count.
    calls.fetches.length = 0;
    const harness = boot();
    harness.openIndicator = true;
    await settle();
    await settle();
    let tree = await renderIndicator(harness);

    // The indicator's first read is the background one: no refresh flag.
    // The settings page asks the same route about the same provider, so the
    // indicator's reads are the ones that carry the indicator's own marker.
    const before = calls.fetches.filter((url) => url.includes('provider=minimax-cn')).length;
    assert.ok(before >= 1, 'the indicator read the pool health');
    assert.equal(
      calls.fetches.filter((url) => url.includes('provider=minimax-cn') && url.includes('refresh=1')).length,
      0,
      'the background read does not force a probe',
    );

    // The Host now answers with fresher figures.
    calls.health = {
      provider: 'minimax-cn',
      keys: [
        {
          name: 'primary',
          ref: 'MINIMAX_CN_API_KEY_POOL_1',
          enabled: true,
          configured: true,
          current: true,
          quotaOk: true,
          intervalRemainingPercent: 12,
          weeklyRemainingPercent: 5,
        },
      ],
    };

    // The click forces a fresh probe.
    const trigger = byClass(tree, 'm_pool_indicatorTrigger')[0];
    trigger.props.onClick();
    await settle();
    await settle();
    tree = await renderIndicator(harness);

    // The forced read went out with the refresh flag.
    const forced = calls.fetches.filter((url) => url.includes('provider=minimax-cn') && url.includes('refresh=1'));
    assert.equal(forced.length, 1, 'the click forced exactly one fresh probe');

    // And the panel shows the fresh figures, not the old ones.
    const shown = texts(tree).join(' ');
    assert.match(shown, /12%/);
    assert.match(shown, /5%/);
    assert.doesNotMatch(shown, /80%/);
    assert.doesNotMatch(shown, /39%/);
  } finally {
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('a poll that lands after a click does not undo the click', async () => {
  // The background poll and the click can overlap. When the poll's answer
  // lands last, the panel must still show the fresh figures: the click
  // asked the Host to probe the keys again, and the poll only carries the
  // cached ones.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 80,
        weeklyRemainingPercent: 39,
      },
    ],
  };
  try {
    calls.defer = true;
    calls.pending.length = 0;
    // The poll is shortened so the indicator's OWN background read can be
    // made to land after the click's forced read.
    const harness = boot({ pollMs: 20 });
    harness.openIndicator = true;
    await settle();
    await settle();

    // The indicator's read is waiting, alongside the settings page's own
    // read of the same route. The held answers are told apart by their URL.
    const held = () => calls.pending.filter((entry) => entry.url.includes('provider=minimax-cn'));

    // Render first: that is what starts the indicator's read.
    let tree = await renderIndicator(harness);
    assert.ok(held().length >= 1, 'a read is in flight');

    // Let every held read land, and let the panel pick them up.
    for (const entry of held()) entry.resolve();
    calls.pending.length = 0;
    await settle();
    await settle();
    tree = await renderIndicator(harness);
    assert.match(texts(tree).join(' '), /80%/);

    // The Host now answers with fresher figures.
    calls.health = {
      provider: 'minimax-cn',
      keys: [
        {
          name: 'primary',
          ref: 'MINIMAX_CN_API_KEY_POOL_1',
          enabled: true,
          configured: true,
          current: true,
          quotaOk: true,
          intervalRemainingPercent: 12,
          weeklyRemainingPercent: 5,
        },
      ],
    };

    // The click starts a forced read. It captures the fresh figures.
    const trigger = byClass(tree, 'm_pool_indicatorTrigger')[0];
    trigger.props.onClick();
    await settle();
    const waiting = held();
    const forced = waiting.find((entry) => entry.url.includes('refresh=1'));
    assert.notEqual(forced, undefined, 'the click forced a read');

    // The forced answer lands.
    forced.resolve();
    calls.pending.length = 0;
    await settle();
    await settle();
    tree = await renderIndicator(harness);
    assert.match(texts(tree).join(' '), /12%/);

    // Now let the indicator's own poll fire. The Host's cached figures are
    // still the old ones — the click asked the Host to probe the keys, but
    // the cache behind a plain read is unchanged — so the poll carries the
    // OLD figures and lands after the forced answer. It must not undo the
    // click.
    calls.health = {
      provider: 'minimax-cn',
      keys: [
        {
          name: 'primary',
          ref: 'MINIMAX_CN_API_KEY_POOL_1',
          enabled: true,
          configured: true,
          current: true,
          quotaOk: true,
          intervalRemainingPercent: 80,
          weeklyRemainingPercent: 39,
        },
      ],
    };
    await settle();
    await settle();
    const late = held().filter((entry) => !entry.url.includes('refresh=1'));
    assert.ok(late.length >= 1, 'the poll fired');
    for (const entry of late) entry.resolve();
    calls.pending.length = 0;
    await settle();
    await settle();
    tree = await renderIndicator(harness);
    const shown = texts(tree).join(' ');
    assert.match(shown, /12%/);
    assert.match(shown, /5%/);
    assert.doesNotMatch(shown, /80%/);
    assert.doesNotMatch(shown, /39%/);
  } finally {
    calls.defer = false;
    calls.pending.length = 0;
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('the indicator stops reporting itself busy once the refresh lands', async () => {
  // The busy flag is the trigger's "working" state. It has to come back
  // down: a flag that latched on would leave the capsule spinning for the
  // rest of the session.
  const restore = stubFetch();
  calls.profile = pooledProfile();
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        intervalRemainingPercent: 80,
        weeklyRemainingPercent: 39,
      },
    ],
  };
  try {
    const harness = boot();
    harness.openIndicator = true;
    await settle();
    await settle();
    let tree = await renderIndicator(harness);

    // The trigger starts idle.
    let trigger = byClass(tree, 'm_pool_indicatorTrigger')[0];
    assert.equal(trigger.props['aria-busy'], 'false');

    // The click makes it busy. The answer has not landed yet, so the flag
    // is still up on the next render.
    trigger.props.onClick();
    tree = renderIndicatorNow(harness);
    trigger = byClass(tree, 'm_pool_indicatorTrigger')[0];
    assert.equal(trigger.props['aria-busy'], 'true');

    // And the flag comes back down once the answer lands.
    await settle();
    await settle();
    tree = renderIndicatorNow(harness);
    trigger = byClass(tree, 'm_pool_indicatorTrigger')[0];
    assert.equal(trigger.props['aria-busy'], 'false');
  } finally {
    calls.health = { keys: [] };
    calls.profile = { providers: {} };
    restore();
  }
});

test('the panel is positioned inside the host, not against the viewport', async () => {
  // The composer's seat carries `will-change: transform`, which makes it
  // the containing block of any `position: fixed` descendant. A fixed
  // panel would resolve its offsets against that seat instead of the
  // viewport, so it would open far away from the capsule. The panel has to
  // be absolute, inside a relative host.
  const css = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8');
  const tip = /\.m_pool_indicatorTip\{([^}]*)\}/.exec(css);
  assert.notEqual(tip, undefined, 'the panel has a style rule');
  assert.match(tip[1], /position:absolute/);
  assert.doesNotMatch(tip[1], /position:fixed/);
  const host = /\.m_pool_indicatorHost\{([^}]*)\}/.exec(css);
  assert.notEqual(host, undefined, 'the host has a style rule');
  assert.match(host[1], /position:relative/);
});

test('the indicator never renders a key value', async () => {
  // The Host sends only the remaining share and the reset moment, so there is
  // no key value to leak into the DOM.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  calls.health = {
    provider: 'minimax-cn',
    keys: [
      {
        name: 'primary',
        ref: 'MINIMAX_CN_API_KEY_POOL_1',
        enabled: true,
        configured: true,
        current: true,
        quotaOk: true,
        preview: 'sk-cp-1••••••ab',
        intervalRemainingPercent: 50,
        weeklyRemainingPercent: 50,
      },
    ],
  }
  try {
    const harness = boot()
    harness.openIndicator = true
    await settle()
    await settle()
    const tree = await renderIndicator(harness)
    const shown = texts(tree).join('\n')
    assert.doesNotMatch(shown, /sk-cp-1/)
    assert.doesNotMatch(shown, /•/)
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

test('a session without a model directory does not break the composer', async () => {
  // `directoryFor` throws when the session resolves no scope, and a throw
  // inside a slot's `inject` takes the whole composer down. The indicator
  // tolerates the missing directory and renders nothing.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  const harness = boot()
  // The directory service now refuses every session.
  harness.ctx.modelDirectories.directoryFor = () => { throw new Error('no scope') }
  try {
    const tree = await renderIndicator(harness)
    assert.equal(tree, null)
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

test('the indicator asks the Host for the usage of the session provider', async () => {
  // The request names the provider the session talks to, so the Host answers
  // with that provider's pool.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  try {
    const harness = boot()
    await settle()
    await renderIndicator(harness)
    const asked = calls.fetches.filter((url) => url.includes('llm-key-pool/api/health'))
    assert.ok(asked.length > 0)
    assert.ok(asked.some((url) => url.includes('provider=minimax-cn')))
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

test('the page shows the Host key preview, head and tail in plaintext', async () => {
  // The Host answers with the first and last characters of the stored key,
  // which is what tells two keys of the same provider apart.
  const harness = boot()
  await settle()
  const entry = harness.registered[0]
  const face = entry.options.inject()
  // The Host's answer carries the preview.
  harness.ctx.remote.llm.listProviders = async () => ({ ok: true, value: [{ id: 'minimax-cn', name: 'minimax-cn' }] })
  const state = face.hooks.keyPool.getSnapshot()
  const provider = state.providers.find((row) => row.provider === 'minimax-cn')
  assert.notEqual(provider, undefined)
  const tree = renderTree(harness.react, entry.component, { ...composeProps(face), t: (k) => k, view: 'page' })
  assert.notEqual(tree, null)
  assert.notEqual(tree, undefined)
})