import type { DevtoolsEvent } from "./index";
import type { RegisteredStore } from "./storeRegistry";

/** Имя канала: только вкладки одного origin. */
export const DEVTOOLS_BROADCAST_CHANNEL = "mobx-devtools-bridge-v1";

export type BridgeMsg =
  | { type: "sync"; events: DevtoolsEvent[]; maxEvents: number }
  | { type: "evt"; event: DevtoolsEvent }
  | {
      type: "stores";
      stores: { id: string; debugName: string }[];
    }
  | { type: "requestSync" }
  | {
      type: "cmd";
      cmd: "clear" | "clearStoreRegistry" | "setMax";
      max?: number;
    };

const REMOTE_TARGET = Object.freeze({});

function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === "function") return "[Function]";
  if (typeof v === "bigint") return String(v) + "n";
  return v;
}

export function serializeDevtoolsEvent(e: DevtoolsEvent): DevtoolsEvent {
  try {
    return JSON.parse(JSON.stringify(e, jsonReplacer)) as DevtoolsEvent;
  } catch {
    return {
      id: e.id,
      type: e.type,
      name: e.name,
      timestamp: e.timestamp,
      raw: { type: e.type } as DevtoolsEvent["raw"],
    };
  }
}

type HostApi = {
  getRecentEvents: () => readonly DevtoolsEvent[];
  getMaxEvents: () => number;
  subscribe: (listener: (e: DevtoolsEvent) => void) => () => void;
  subscribeBuffer: (listener: () => void) => () => void;
  subscribeStores: (listener: () => void) => () => void;
  getRegisteredStores: () => RegisteredStore[];
  clearEvents: () => void;
  clearStoreRegistry: () => void;
  setMaxEvents: (n: number) => void;
};

let hostApi: HostApi | null = null;

/** Вызывается из `index.ts` при загрузке модуля. */
export function registerDevtoolsHostApi(api: HostApi): void {
  hostApi = api;
}

function postFromHost(msg: BridgeMsg): void {
  try {
    hostChannel?.postMessage(msg);
  } catch {
    /* ignore */
  }
}

function sendFullSync(): void {
  const api = hostApi;
  if (!api) return;
  postFromHost({
    type: "sync",
    events: [...api.getRecentEvents()].map(serializeDevtoolsEvent),
    maxEvents: api.getMaxEvents(),
  });
  postFromHost({
    type: "stores",
    stores: api.getRegisteredStores().map((s) => ({
      id: s.id,
      debugName: s.debugName,
    })),
  });
}

let hostChannel: BroadcastChannel | null = null;
let hostRefCount = 0;
let hostUnsubs: Array<() => void> = [];

function attachHostChannel(): void {
  if (typeof BroadcastChannel === "undefined") return;
  if (hostChannel) return;
  hostChannel = new BroadcastChannel(DEVTOOLS_BROADCAST_CHANNEL);
  hostChannel.onmessage = (ev: MessageEvent<BridgeMsg>) => {
    const api = hostApi;
    if (!api) return;
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "requestSync") {
      sendFullSync();
      return;
    }
    if (m.type === "cmd") {
      if (m.cmd === "clear") {
        api.clearEvents();
        return;
      }
      if (m.cmd === "clearStoreRegistry") {
        api.clearStoreRegistry();
        return;
      }
      if (m.cmd === "setMax" && typeof m.max === "number") {
        api.setMaxEvents(m.max);
      }
    }
  };
}

function detachHostChannel(): void {
  hostChannel?.close();
  hostChannel = null;
}

/**
 * Публикует буфер и новые события в другие вкладки (BroadcastChannel).
 */
export function startDevtoolsHostBroadcast(): () => void {
  if (!hostApi) return () => {};
  attachHostChannel();
  hostRefCount++;
  if (hostRefCount > 1) {
    return () => {
      hostRefCount--;
      if (hostRefCount <= 0) {
        hostUnsubs.forEach((u) => u());
        hostUnsubs = [];
        detachHostChannel();
      }
    };
  }

  sendFullSync();

  const api = hostApi;
  hostUnsubs.push(
    api.subscribe((e) => {
      postFromHost({ type: "evt", event: serializeDevtoolsEvent(e) });
    }),
  );
  hostUnsubs.push(
    api.subscribeBuffer(() => {
      sendFullSync();
    }),
  );
  hostUnsubs.push(
    api.subscribeStores(() => {
      postFromHost({
        type: "stores",
        stores: api.getRegisteredStores().map((s) => ({
          id: s.id,
          debugName: s.debugName,
        })),
      });
    }),
  );

  return () => {
    hostRefCount--;
    if (hostRefCount <= 0) {
      hostUnsubs.forEach((u) => u());
      hostUnsubs = [];
      detachHostChannel();
    }
  };
}

/* ——— потребитель (отдельная вкладка) ——— */

let mirrorRing: DevtoolsEvent[] = [];
let mirrorMax = 500;
/** Любое изменение зеркала (новое событие или полная синхронизация). */
const mirrorListeners = new Set<() => void>();
let remoteStoreSummaries: { id: string; debugName: string }[] = [];
const mirrorStoreListeners = new Set<() => void>();

function pushMirror(evt: DevtoolsEvent): void {
  mirrorRing.push(evt);
  while (mirrorRing.length > mirrorMax) mirrorRing.shift();
}

function emitMirrorListeners(): void {
  mirrorListeners.forEach((l) => l());
}

function emitMirrorStores(): void {
  mirrorStoreListeners.forEach((l) => l());
}

function applySync(events: DevtoolsEvent[], maxEvents: number): void {
  mirrorRing = [...events];
  mirrorMax = Math.max(50, Math.min(5000, Math.floor(maxEvents)));
  while (mirrorRing.length > mirrorMax) mirrorRing.shift();
  emitMirrorListeners();
}

function handleConsumerMessage(data: BridgeMsg): void {
  if (data.type === "sync") {
    applySync(data.events, data.maxEvents);
    return;
  }
  if (data.type === "evt") {
    pushMirror(data.event);
    emitMirrorListeners();
    return;
  }
  if (data.type === "stores") {
    remoteStoreSummaries = data.stores;
    emitMirrorStores();
  }
}

let consumerChannel: BroadcastChannel | null = null;

export function getRemoteRecentEvents(): readonly DevtoolsEvent[] {
  return mirrorRing;
}

export function getRemoteMaxEvents(): number {
  return mirrorMax;
}

export function subscribeRemote(listener: () => void): () => void {
  mirrorListeners.add(listener);
  return () => mirrorListeners.delete(listener);
}

export function subscribeRemoteBuffer(listener: () => void): () => void {
  mirrorListeners.add(listener);
  return () => mirrorListeners.delete(listener);
}

export function getRemoteRegisteredStores(): RegisteredStore[] {
  return remoteStoreSummaries.map((s) => ({
    id: s.id,
    debugName: s.debugName,
    target: REMOTE_TARGET as object,
    isRemoteSnapshot: true,
  }));
}

export function subscribeRemoteStores(listener: () => void): () => void {
  mirrorStoreListeners.add(listener);
  return () => mirrorStoreListeners.delete(listener);
}

export function connectDevtoolsRemote(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  consumerChannel = new BroadcastChannel(DEVTOOLS_BROADCAST_CHANNEL);
  consumerChannel.onmessage = (ev: MessageEvent<BridgeMsg>) => {
    handleConsumerMessage(ev.data);
  };
  try {
    consumerChannel.postMessage({ type: "requestSync" } satisfies BridgeMsg);
  } catch {
    /* ignore */
  }
  return () => {
    consumerChannel?.close();
    consumerChannel = null;
    mirrorRing = [];
    mirrorMax = 500;
    remoteStoreSummaries = [];
    emitMirrorListeners();
    emitMirrorStores();
  };
}

export function sendDevtoolsRemoteCommand(
  msg: Extract<BridgeMsg, { type: "cmd" }>,
): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(DEVTOOLS_BROADCAST_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch {
    /* ignore */
  }
}
