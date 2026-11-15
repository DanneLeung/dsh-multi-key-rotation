/**
 * A faithful mock of the Host's settings write path.
 *
 * The installed Host's client half (`dsh-client-ui-settings`) models a
 * settings write as a SERIALIZED queue over one shared mirror:
 *
 *   - `ConfigFormController.mutate` queues its wire call behind the previous
 *     one (`this.tail`), reads `expectedRevision` from the CURRENT snapshot,
 *     and folds the write answer back with `mirror.acceptView(...)`.
 *   - `SettingsDescribeMirror.acceptView` publishes the folded view, which
 *     notifies every `mirror.subscribe` listener, which notifies every
 *     `form.subscribe` listener.
 *   - The Host answers a write whose expected revision no longer matches
 *     with a conflict rejection.
 *
 * This mock reproduces those semantics so a client bug that only shows up
 * against the real Host — a write that never settles, a revision conflict,
 * an echo that rebuilds state mid-save — reproduces here instead.
 */

/** The Host's conflict error. */
class SettingsConflictError extends Error {
  constructor(ns, expected, actual) {
    super(`settings namespace "${ns}" changed since it was read (expected revision ${String(expected)}, now ${String(actual)})`)
    this.name = 'SettingsConflictError'
    this.ns = ns
    this.expected = expected
    this.actual = actual
  }
}

/**
 * The Host's snapshot store.
 * @param initial - the first snapshot.
 * @returns the store.
 */
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
      for (const listener of [...listeners]) listener()
    },
    set: (next) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Build a Host-faithful settings mirror + config form pair.
 *
 * @param options - the harness options.
 * @param options.namespace - the settings namespace.
 * @param options.initial - the namespace's first value.
 * @param options.onDescribe - called with the namespace value; returns the
 *   Host's view of it (the value plus its revision).
 * @param options.onMutate - the Host's write. Receives the ops and the
 *   expected revision; returns the new view, or throws.
 * @returns the mirror, the form, and a call log.
 */
function makeHostForm(options) {
  const namespace = options.namespace ?? 'llm-key-pool'
  const calls = { describe: 0, mutate: [], subscribeFires: 0 }
  const revision = { value: 0 }

  const mirrorStore = createSnapshotStore({
    status: 'idle',
    view: undefined,
    error: null,
  })

  const mirror = {
    getSnapshot: () => mirrorStore.getSnapshot(),
    subscribe: (fn) => mirrorStore.subscribe(fn),
    ensure: async () => {},
    acceptView: (view) => {
      const before = mirrorStore.getSnapshot()
      if (before.view === undefined) return
      const namespaces = before.view.namespaces.some((row) => row.ns === view.ns)
        ? before.view.namespaces.map((row) => row.ns === view.ns ? view : row)
        : [...before.view.namespaces, view]
      mirrorStore.set({ ...before, view: { ...before.view, namespaces } })
    },
  }

  // The mirror's first read.
  const first = options.onDescribe ? options.onDescribe() : { value: options.initial ?? {}, revision: 0 }
  mirrorStore.set({ status: 'ready', view: { namespaces: [{ ns: namespace, value: first.value, revision: first.revision }], writable: true }, error: null })

  const formStore = createSnapshotStore({
    status: 'ready',
    value: first.value,
    base: first.value,
    user: first.value,
    revision: first.revision,
    writable: true,
  })

  const form = {
    getSnapshot: () => formStore.getSnapshot(),
    subscribe: (fn) => formStore.subscribe(fn),
    set: (field, value) => form.mutate([{ op: 'set', path: [field], value }]),
    unset: (field) => form.mutate([{ op: 'unset', path: [field] }]),
    mutate: (ops, expectedRevision) => {
      const owned = JSON.parse(JSON.stringify(ops))
      const generation = ++writeGeneration
      return enqueue(async () => {
        const revision = expectedRevision ?? pendingRevision ?? formStore.getSnapshot().revision
        calls.mutate.push({ ops: owned, expected: revision })
        const response = await options.onMutate(owned, revision, namespace)
        if (!response.ok) {
          pendingRevision = undefined
          return false
        }
        if (generation === writeGeneration) {
          pendingRevision = undefined
          mirror.acceptView(response.value)
        } else {
          pendingRevision = response.value.revision
        }
        return true
      })
    },
  }

  let tail = Promise.resolve()
  let writeGeneration = 0
  let pendingRevision
  const enqueue = (operation) => {
    const task = tail.then(async () => operation())
    tail = task.then(() => {}, () => {})
    return task
  }

  // The form derives from the mirror, exactly as the Host's controller does.
  mirror.subscribe(() => {
    const view = mirror.getSnapshot().view?.namespaces.find((row) => row.ns === namespace)
    if (view === undefined) return
    formStore.update((draft) => {
      draft.revision = view.revision
      draft.value = view.value
    })
  })

  return { mirror, form, calls, revision }
}

module.exports = { makeHostForm, createSnapshotStore, SettingsConflictError }
