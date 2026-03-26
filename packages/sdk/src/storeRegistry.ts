import { getDebugName, isObservableObject, spy } from "mobx";

type SpyEv = Parameters<Parameters<typeof spy>[0]>[0];

export type RegisteredStore = {
  id: string;
  /** Имя из MobX (`getDebugName`) */
  debugName: string;
  target: object;
  /** Снимок из другой вкладки — нет живого observable для правок */
  isRemoteSnapshot?: boolean;
};

const storeListeners = new Set<() => void>();
/** Реестр держит сильные ссылки — только для devtools-сессии. */
const registry = new Map<object, { id: string }>();
let storeSeq = 0;

const MAX_STORES = 400;

function emitStores() {
  storeListeners.forEach((l) => l());
}

/**
 * Вложенные observable (продукт в Map, элемент корзины, `observable.array`) MobX помечает как
 * `ObservableObject@…`, `ObservableArray@…`, `ObservableMap@…` — их не показываем отдельными
 * сторами, чтобы в списке оставались корневые классы (`CartStore@…`, `CatalogStore@…`).
 */
function shouldAutoRegisterStore(obj: object): boolean {
  if (!isObservableObject(obj)) return false;
  let debugName: string;
  try {
    debugName = getDebugName(obj);
  } catch {
    return false;
  }
  return !debugName.startsWith("Observable");
}

function addToRegistry(obj: object): void {
  if (!isObservableObject(obj)) return;
  if (registry.has(obj)) {
    return;
  }
  if (registry.size >= MAX_STORES) {
    const first = registry.keys().next().value as object | undefined;
    if (first !== undefined) registry.delete(first);
  }
  const id = `store-${++storeSeq}`;
  registry.set(obj, { id });
  emitStores();
}

function touchStoreCandidate(obj: object, force: boolean): void {
  if (!force && !shouldAutoRegisterStore(obj)) return;
  addToRegistry(obj);
}

/**
 * Явно добавить корневой стор (например plain `observable({ … })` без класса — он иначе
 * отфильтровывается по префиксу `Observable`).
 */
export function registerRootStore(obj: object): void {
  touchStoreCandidate(obj, true);
}

/**
 * Вызывается из spy-пайплайна: регистрирует только корневые сторы, не вложенные
 * `ObservableObject` / `ObservableArray` / `ObservableMap` из тех же событий.
 */
export function touchStoresFromSpyEvent(raw: SpyEv): void {
  if (!("object" in raw) || raw.object == null) return;
  if (typeof raw.object !== "object") return;
  touchStoreCandidate(raw.object, false);
}

export function getRegisteredStores(): RegisteredStore[] {
  const out: RegisteredStore[] = [];
  for (const [target, meta] of registry) {
    let debugName: string;
    try {
      debugName = getDebugName(target);
    } catch {
      debugName = meta.id;
    }
    out.push({ id: meta.id, debugName, target });
  }
  out.sort((a, b) => a.debugName.localeCompare(b.debugName, "ru"));
  return out;
}

export function subscribeStores(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

export function clearStoreRegistry(): void {
  registry.clear();
  emitStores();
}
