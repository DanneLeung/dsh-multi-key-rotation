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
 * @returns the harness pieces.
 */
function boot() {
  const harness = loadClient()
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
  const entry = harness.registered.find((row) => row.options.name === 'conversation.input.overlay')
  assert.notEqual(entry, undefined)
  return entry
}

/**
 * Render the composer indicator with the face its registration injects.
 * @param harness - the booted harness.
 * @param sessionId - the session the indicator belongs to.
 * @returns the rendered element tree.
 */
async function renderIndicator(harness, sessionId) {
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
  if (harness.openIndicator) {
    // The panel opens on a click, the way a user opens it. It is clicked
    // once: a second click would close the panel again.
    const trigger = byClass(tree, 'm_pool_indicatorTrigger')[0]
    if (trigger !== undefined) trigger.props.onClick()
    tree = render()
  }
  return tree
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

test('the indicator registers one cell of the floating composer overlay', () => {
  // `conversation.input.overlay` holds the floating entries of the composer
  // card, and a fixed overlay portals to the document body. A fresh id adds a
  // cell beside the shipped ones instead of replacing one.
  const harness = boot()
  const entry = indicatorEntry(harness)
  assert.equal(entry.options.id, 'multi-key-rotation-usage')
  assert.equal(typeof entry.options.inject, 'function')
  assert.equal(typeof entry.component, 'function')
})

test('the indicator does not occupy a cell of the composer tool row', () => {
  // The tool row is a fixed layout: a cell there changes the input's
  // geometry. The indicator must not take one.
  const harness = boot()
  const row = harness.registered.find((r) => r.options.name === 'conversation.input.right')
  assert.equal(row, undefined)
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

test('the indicator shows the key in use and both windows', async () => {
  // The Host answers with the key the route authenticates with, and the two
  // windows of that key.
  const restore = stubFetch()
  calls.profile = pooledProfile()
  const now = Date.now()
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
    const harness = boot()
    harness.openIndicator = true
    await settle()
    await settle()
    const tree = await renderIndicator(harness)
    assert.notEqual(tree, null)
    // The key in use is the one in the main block, marked as active.
    const active = byClass(tree, 'm_pool_indicatorKeyActive')
    assert.equal(active.length, 1)
    const name = byClass(tree, 'm_pool_indicatorKeyName').map((node) => texts(node).join(''))
    assert.deepEqual(name, ['secondary'])
    // The rest of the pool is listed compactly beside it.
    const pool = byClass(tree, 'm_pool_indicatorPoolName').map((node) => texts(node).join(''))
    assert.deepEqual(pool, ['primary', 'secondary'])
    // Both windows are reported for the key in use.
    const metrics = byClass(tree, 'm_pool_indicatorMetric')
    const shown = metrics.map((node) => texts(node).join(' ')).join('\n')
    assert.match(shown, /indicatorWindowInterval/)
    assert.match(shown, /indicatorWindowWeekly/)
    assert.match(shown, /88%/)
    assert.match(shown, /55%/)
    // The reset countdown is rendered for both windows.
    assert.match(shown, /indicatorResetsIn/)
  } finally {
    calls.health = { keys: [] }
    calls.profile = { providers: {} }
    restore()
  }
})

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