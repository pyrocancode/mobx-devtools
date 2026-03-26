import {
  getDebugName,
  getDependencyTree,
  getObserverTree,
  isObservableObject,
  keys,
  spy,
  type IDependencyTree,
  type IObserverTree,
} from "mobx";
import { touchStoresFromSpyEvent } from "./storeRegistry";

export type { IDependencyTree, IObserverTree };

/** Событие из `spy` (публичный API MobX не экспортирует `PureSpyEvent`). */
export type MobxSpyEvent = Parameters<Parameters<typeof spy>[0]>[0];

export type DevtoolsEvent = {
  id: string;
  type: string;
  name?: string;
  timestamp: number;
  raw: MobxSpyEvent;
};

const listeners = new Set<(e: DevtoolsEvent) => void>();
const bufferListeners = new Set<() => void>();
let seq = 0;
let started = false;

let maxEvents = 500;
const ring: DevtoolsEvent[] = [];

function emitBuffer(): void {
  bufferListeners.forEach((l) => l());
}

function spyEventName(raw: MobxSpyEvent): string | undefined {
  if ("name" in raw && raw.name != null) return String(raw.name);
  return undefined;
}

function pushEvent(raw: MobxSpyEvent): DevtoolsEvent {
  touchStoresFromSpyEvent(raw);
  const evt: DevtoolsEvent = {
    id: `${Date.now()}-${++seq}`,
    type: raw.type,
    name: spyEventName(raw),
    timestamp: performance.now(),
    raw,
  };
  ring.push(evt);
  while (ring.length > maxEvents) ring.shift();
  return evt;
}

/**
 * Включает глобальный spy MobX. Безопасно вызывать один раз на приложение.
 */
export function initMobxDevtools(): void {
  if (started) return;
  started = true;
  spy((event) => {
    const devEvt = pushEvent(event);
    listeners.forEach((l) => l(devEvt));
  });
  startDevtoolsHostBroadcast();
}

export function subscribe(listener: (e: DevtoolsEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Вызывается при `clearEvents` и смене лимита буфера — чтобы UI синхронизировался. */
export function subscribeBuffer(listener: () => void): () => void {
  bufferListeners.add(listener);
  return () => bufferListeners.delete(listener);
}

export function getRecentEvents(): readonly DevtoolsEvent[] {
  return ring;
}

export function clearEvents(): void {
  ring.length = 0;
  emitBuffer();
}

export function getMaxEvents(): number {
  return maxEvents;
}

export function setMaxEvents(next: number): void {
  maxEvents = Math.max(50, Math.min(5000, Math.floor(next)));
  while (ring.length > maxEvents) ring.shift();
  emitBuffer();
}

/** Observable / объект из spy-события (если поле есть). */
export function getSubjectFromSpyEvent(raw: MobxSpyEvent): unknown {
  if ("object" in raw && raw.object != null) return raw.object;
  return null;
}

export type SubjectExplain = {
  dependency: IDependencyTree;
  observers: IObserverTree;
};

function mobxPropertyArg(key: PropertyKey): string {
  return typeof key === "symbol" ? String(key) : String(key);
}

/**
 * Деревья зависимостей и наблюдателей MobX для переданного субъекта.
 *
 * Для observable-объекта (класс + makeAutoObservable) MobX не даёт вызвать
 * `getDependencyTree(obj)` без имени поля — только `getDependencyTree(obj, key)`.
 * Поэтому собираем лес по `keys(obj)`.
 */
export function explainSubject(subject: unknown): SubjectExplain | null {
  if (subject == null || typeof subject !== "object") return null;

  if (isObservableObject(subject)) {
    const rootName = getDebugName(subject);
    const depChildren: IDependencyTree[] = [];
    const obsChildren: IObserverTree[] = [];
    for (const key of keys(subject)) {
      const prop = mobxPropertyArg(key);
      try {
        depChildren.push(getDependencyTree(subject, prop));
      } catch {
        /* не observable: action, служебное поле и т.п. */
      }
      try {
        obsChildren.push(getObserverTree(subject, prop));
      } catch {
        /* то же */
      }
    }
    return {
      dependency: { name: rootName, dependencies: depChildren },
      observers: { name: rootName, observers: obsChildren },
    };
  }

  try {
    return {
      dependency: getDependencyTree(subject),
      observers: getObserverTree(subject),
    };
  } catch {
    return null;
  }
}

export {
  explainMobxEvent,
  type EventExplain,
  type ExplainInputEvent,
  type ExplainLine,
} from "./explainEvent";

export {
  clearStoreRegistry,
  getRegisteredStores,
  registerRootStore,
  subscribeStores,
  type RegisteredStore,
} from "./storeRegistry";

export {
  scanZombieObservables,
  type ZombieFinding,
  type ZombieKind,
  type ZombieScanOptions,
  type ZombieScanResult,
} from "./zombieScan";

export {
  analyzeStoreStructure,
  type StoreStructureAnalyzerOptions,
  type StoreStructureReport,
  type StoreStructureSummary,
  type StructureIssue,
  type StructureIssueKind,
  type StructureSeverity,
} from "./storeStructureAnalyzer";

export {
  buildMultiStoreLinkGraph,
  type MultiStoreGraphEdge,
  type MultiStoreGraphNode,
  type MultiStoreGraphOptions,
  type MultiStoreGraphResult,
} from "./multiStoreGraph";

import {
  clearStoreRegistry,
  getRegisteredStores,
  subscribeStores,
} from "./storeRegistry";
import {
  connectDevtoolsRemote,
  getRemoteMaxEvents,
  getRemoteRecentEvents,
  getRemoteRegisteredStores,
  registerDevtoolsHostApi,
  sendDevtoolsRemoteCommand,
  startDevtoolsHostBroadcast,
  subscribeRemote,
  subscribeRemoteBuffer,
  subscribeRemoteStores,
} from "./remoteBridge";

registerDevtoolsHostApi({
  getRecentEvents,
  getMaxEvents,
  subscribe,
  subscribeBuffer,
  subscribeStores,
  getRegisteredStores,
  clearEvents,
  clearStoreRegistry,
  setMaxEvents,
});

export {
  connectDevtoolsRemote,
  getRemoteMaxEvents,
  getRemoteRecentEvents,
  getRemoteRegisteredStores,
  sendDevtoolsRemoteCommand,
  startDevtoolsHostBroadcast,
  subscribeRemote,
  subscribeRemoteBuffer,
  subscribeRemoteStores,
};

export { getDependencyTree, getObserverTree } from "mobx";
