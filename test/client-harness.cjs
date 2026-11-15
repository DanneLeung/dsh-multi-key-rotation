/**
 * Run the key-pool client half against a faithful mock of the Host's client
 * services, so a render-time crash reproduces here instead of in the browser.
 *
 * The mock mirrors the contracts read out of the installed Host sources:
 *   - `ctx.locale.register(ns, {zh, en})` / `ctx.locale.bind(ns)` -> `t(key, params)`
 *   - `ctx.configForms.get(ns)` -> form with `getSnapshot()/subscribe()/set()`
 *   - `ctx.configForms.whileServed([ns], cb)` -> disposer
 *   - `ctx.slots.inject(key, cb)` / `ctx.slots.register(options, component)`
 *   - `ctx.remote.llm.listProviders()/listConfigurableProviders()`
 *   - `ctx.remote.credentials.describe(refs)/set(ref, value)/unset(ref)`
 */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const CLIENT = path.resolve(__dirname, '..', 'client.js')

/**
 * Minimal React stand-in that records the element tree and runs hooks.
 *
 * The hook state is held per component INSTANCE, not in one flat cursor.
 * A flat cursor misaligns as soon as a component renders fewer children than
 * it did before — a card that collapses drops a subtree, and every later
 * component would then read another component's state. Keying the slots by
 * the instance's path in the tree keeps each component's own state.
 */
function makeReact() {
  // instanceKey -> { slots: [], cursor: number }
  const instances = new Map()
  let current = null
  const react = {
    /** The effects queued by the current render, drained by `__flush`. */
    __pending: [],
    __reset() {
      instances.clear()
      current = null
      react.__pending = []
    },
    /**
     * Run every recorded effect cleanup, the way React does it when a
     * component unmounts. A component that polls on a timer would otherwise
     * keep the Node event loop alive after its test finished.
     */
    __cleanup() {
      react.__pending = []
      for (const instance of instances.values()) {
        for (const slot of instance.slots) {
          // A slot holds either an effect record or a state value, and a
          // state value may be null.
          if (slot === null || slot === undefined) continue;
          if (typeof slot.cleanup === 'function') {
            const cleanup = slot.cleanup
            slot.cleanup = undefined
            cleanup()
          }
        }
      }
    },
    /**
     * Enter a component instance's hook scope.
     *
     * The scope's cursor is rewound, so the instance's hooks are read from
     * the same slots as in its previous render, the way React does it.
     * @param key - the instance's path in the tree.
     */
    __enter(key) {
      if (!instances.has(key)) instances.set(key, { slots: [], cursor: 0 })
      current = instances.get(key)
      current.cursor = 0
    },
    __peek() {
      return [...instances.entries()].map(([key, instance]) => [key, instance.slots])
    },
    useState(initial) {
      const instance = current
      if (instance === null) throw new Error('useState outside a component')
      const index = instance.cursor++
      const set = (value) => {
        const next = typeof value === 'function' ? value(instance.slots[index]) : value
        // The change is visible to the next render, the way a React state
        // update is.
        if (!Object.is(next, instance.slots[index])) instance.slots[index] = next
      }
      if (instance.slots.length <= index) {
        instance.slots[index] = typeof initial === 'function' ? initial() : initial
      }
      return [instance.slots[index], set]
    },
    useEffect(fn, deps) {
      const instance = current
      const index = instance.cursor++
      if (instance.slots.length <= index) instance.slots[index] = { deps: undefined, cleanup: undefined }
      const slot = instance.slots[index]
      const changed = slot.deps === undefined
        || deps === undefined
        || slot.deps.length !== deps.length
        || deps.some((dep, i) => !Object.is(dep, slot.deps[i]))
      if (!changed) return
      if (typeof slot.cleanup === 'function') slot.cleanup()
      slot.deps = deps
      slot.cleanup = undefined
      react.__pending.push(() => {
        const result = fn()
        if (typeof result === 'function') slot.cleanup = result
      })
    },
    useMemo(fn) {
      return fn()
    },
    useCallback(fn) {
      return fn
    },
    useRef(initial) {
      const instance = current
      const index = instance.cursor++
      if (instance.slots.length <= index) instance.slots[index] = { current: initial }
      return instance.slots[index]
    },
    useId() {
      return 'test-id'
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
  return react
}

/** Build the jsx-runtime stand-in. */
function makeJsxRuntime(react) {
  const element = (type, props) => ({ type, props: props ?? {} })
  const jsx = (type, props) => element(type, props)
  jsx.jsxs = jsx
  jsx.jsx = jsx
  jsx.Fragment = Symbol.for('react.fragment')
  return jsx
}

/**
 * Render an element tree with function components invoked, so a test can
 * assert on the text a page actually shows.
 *
 * The mock has no reconciler: it walks the tree once, calling function
 * components with their props and collecting their results. Each component
 * instance gets its own hook scope, keyed by its path in the tree, so a
 * component that renders fewer children than before does not shift another
 * component's state.
 * @param node - the tree node.
 * @param react - the React stand-in.
 * @param path - the instance path of this node.
 * @returns the flattened tree.
 */
function flatten(node, react, path) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) {
    return node
      .map((child, index) => flatten(child, react, `${path}/${index}`))
      .filter((child) => child !== null)
  }
  if (typeof node !== 'object') return null
  if (typeof node.type === 'function') {
    // The instance's key is its path, so two cards of the same component keep
    // separate state.
    const key = `${node.type.name || 'Component'}@${path}`
    react.__enter(key)
    return flatten(node.type(node.props), react, path)
  }
  return { type: node.type, props: { ...node.props, children: flatten(node.props?.children, react, `${path}/c`) } }
}

/**
 * Render a page component as a fresh render.
 *
 * The React stand-in keeps its per-instance hook state between renders, so a
 * component's state survives a re-render the way it does in the browser.
 *
 * The root is a component FUNCTION, not an element: the walker calls it
 * exactly once, inside its own hook scope. Calling it outside the walker
 * would run its hooks a second time, in a scope the walker never reads, and
 * the page's state would appear to be lost between renders.
 * @param react - the React stand-in.
 * @param component - the root component function.
 * @param props - the props to pass it.
 * @returns the flattened tree.
 */
function renderTree(react, component, props) {
  const tree = flatten({ type: component, props }, react, 'root')
  // The effects queued by this render run right after it, the way React runs
  // them after the commit.
  const queued = react.__pending
  react.__pending = []
  for (const effect of queued) effect()
  return tree
}

/** A snapshot store mirroring the Host's `createSnapshotStore`. */
function createSnapshotStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    update: (fn) => {
      value = fn(value)
      for (const fn2 of listeners) fn2()
    },
    set: (next) => {
      value = next
      for (const fn2 of listeners) fn2()
    },
  }
}

/**
 * The captured Host calls, so a test can assert on them.
 *
 * `profile` is the settings section the mock form serves. A test replaces it
 * to put a saved pool in the profile; the default is a profile with no
 * provider configured.
 */
const calls = {
  credentialsSet: [],
  credentialsUnset: [],
  formSet: [],
  formMutate: [],
  fetches: [],
  noProviders: false,
  profile: { providers: {} },
  /**
   * The health answer the stubbed fetch hands back. A test sets it to give
   * the card per-key usage figures; the default answers no keys.
   */
  health: { keys: [] },
  /**
   * The session's selected model. The indicator reads the provider from it,
   * so a test sets it to point the composer at one provider.
   */
  modelSelection: { provider: 'minimax-cn', model: 'MiniMax-M3' },
}

/**
 * Build the mock client context.
 * @returns the mock context and the registered tab entry.
 */
function makeContext() {
  const react = makeReact()
  const jsxRuntime = makeJsxRuntime(react)

  const localeDict = { zh: {}, en: {} }
  const locale = {
    register(ns, dicts) {
      localeDict[ns] = dicts
      return () => {}
    },
    bind(ns) {
      const dicts = localeDict[ns] ?? {}
      return (key, params) => {
        const template = dicts.en?.[key] ?? dicts.zh?.[key] ?? key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
      }
    },
    getSnapshot: () => ({ active: 'en', revision: 0 }),
    subscribe: () => () => {},
  }

  const form = {
    getSnapshot: () => ({ status: 'ready', value: calls.profile, writable: true, revision: 1 }),
    subscribe: () => () => {},
    set: async (field, value) => {
      calls.formSet.push([field, value])
      return true
    },
    unset: async () => true,
    // The Host's form writes a PATH, so a page that saves several providers
    // sends one operation per provider.
    mutate: async (ops) => {
      calls.formMutate.push(ops)
      return true
    },
  }

  // The namespaces the Host serves in its settings describe mirror.
  const served = { namespaces: new Set() }

  const configForms = {
    get: (ns) => (ns === 'llm-key-pool' ? form : undefined),
    // Faithful to the Host: the callback runs only once the mirror holds one
    // of the namespaces. At boot the mirror has no view yet, so it does not.
    whileServed(namespaces, cb) {
      const held = served.namespaces
      if (!namespaces.some((ns) => held.has(ns))) return () => {}
      return cb(new Set(held))
    },
    describe: () => ({}),
  }

  const registered = []
  const slots = {
    inject(key, cb) {
      const disposer = cb()
      return disposer
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
    getVersion: () => 0,
    entries: () => [],
    subscribe: () => () => {},
  }
  const remote = {
    llm: {
      listProviders: async () => ({
        ok: true,
        value: calls.noProviders
          ? []
          : [
            { id: 'minimax-cn', name: 'minimax-cn' },
            { id: 'deepseek', name: 'deepseek' },
          ],
      }),
      listConfigurableProviders: async () => ({
        ok: true,
        value: calls.noProviders ? [] : [{ provider: 'minimax-cn', displayName: 'MiniMax (CN)' }],
      }),
    },
    credentials: {
      describe: async (refs) => {
        const out = {}
        for (const ref of refs) out[ref] = { configured: true, writable: true, masked: 'sk-***' }
        return { ok: true, value: out }
      },
      set: async (ref, value) => {
        calls.credentialsSet.push([ref, value])
        return { ok: true, value: {} }
      },
      unset: async (ref) => {
        calls.credentialsUnset.push(ref)
        return { ok: true, value: {} }
      },
    },
    settings: {},
    $on: () => () => {},
  }

  // The session-scoped model directory. The indicator reads the selected
  // model from it, so a test decides which provider the session talks to.
  const modelDirectories = {
    directoryFor: (sessionId) => ({
      store: {
        getSnapshot: () => ({
          current: calls.modelSelection,
          routable: calls.modelSelection !== null,
          groups: [],
          failures: [],
          status: 'ready',
          pending: null,
          error: null,
        }),
        subscribe: () => () => {},
        set: (next) => { calls.modelSelection = next },
        update: () => {},
      },
      sessionId,
    }),
  }

  const ctx = {
    effect: (fn) => {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale,
    configForms,
    slots,
    remote,
    modelDirectories,
    // The Cordis fibre inject. The mock answers with a scope holding the
    // services it was asked for, so a plugin that takes an optional service
    // behaves the way it does in a profile that serves it.
    inject: (names, cb) => {
      const scope = {}
      for (const name of names) {
        if (name === 'modelDirectories') scope[name] = modelDirectories
      }
      const disposer = cb(scope)
      return typeof disposer === 'function' ? disposer : () => {}
    },
    logger: { error: (...args) => console.error(...args), warn: () => {}, info: () => {} },
  }
  return { ctx, registered, react, jsxRuntime, localeDict, served, modelDirectories }
}

/**
 * Load the client module against the mock.
 * @returns the module exports.
 */
function loadClient() {
  const { ctx, registered, react, jsxRuntime, served, localeDict } = makeContext()
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') return jsxRuntime
    if (request === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const code = fs.readFileSync(CLIENT, 'utf8')
    const sandbox = { window: { __ModuleLoader__: { load: (spec) => { sandbox.__loaderId = spec.id; sandbox.__result = spec.factory(requireShim) } } } }
    const requireShim = (name) => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
      throw new Error(`unexpected require("${name}")`)
    }
    // eslint-disable-next-line no-new-func
    new Function('window', 'require', 'module', 'exports', code)(sandbox.window, requireShim, sandbox, sandbox.__result)
    return { sandbox, registered, ctx, react, jsxRuntime, served, localeDict }
  } finally {
    Module._load = originalLoad
  }
}

/**
 * Compose the props the Host's slot layer hands a component.
 *
 * The Host turns each `hooks` entry named `key` into a prop named
 * `useKey` (see the slot layer's `InjectFace`): a snapshot selector hook
 * over the entry's observable.
 * @param face - the injected face.
 * @returns the composed props.
 */
function composeProps(face) {
  const props = { ...face }
  for (const [name, source] of Object.entries(face.hooks ?? {})) {
    const prop = `use${name[0].toUpperCase()}${name.slice(1)}`
    props[prop] = (selector) => (selector === undefined ? source.getSnapshot() : selector(source.getSnapshot()))
  }
  return props
}

/**
 * Install a fetch stub for the duration of a test.
 *
 * The card asks the Host's health route for the usage figures. The stub
 * answers with `calls.health`, so a test decides what the card sees.
 * @returns a function that puts the real fetch back.
 */
function stubFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.fetches.push(String(url))
    return {
      ok: true,
      status: 200,
      async json() {
        return calls.health
      },
    }
  }
  return () => {
    globalThis.fetch = original
  }
}

module.exports = { loadClient, makeContext, createSnapshotStore, calls, composeProps, flatten, renderTree, stubFetch }

if (require.main === module) {
  const { sandbox, registered } = loadClient()
  console.log('module loaded; exports:', Object.keys(sandbox.__result ?? {}))
  console.log('registered tabs:', registered.map((r) => r.options.id))
}
