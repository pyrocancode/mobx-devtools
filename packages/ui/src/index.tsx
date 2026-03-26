import {
  type DevtoolsEvent,
  type IDependencyTree,
  type IObserverTree,
  type RegisteredStore,
  clearEvents,
  clearStoreRegistry,
  connectDevtoolsRemote,
  explainMobxEvent,
  explainSubject,
  getMaxEvents,
  getRecentEvents,
  getRegisteredStores,
  getRemoteMaxEvents,
  getRemoteRecentEvents,
  getRemoteRegisteredStores,
  getSubjectFromSpyEvent,
  initMobxDevtools,
  analyzeStoreStructure,
  sendDevtoolsRemoteCommand,
  setMaxEvents,
  subscribe,
  subscribeBuffer,
  subscribeRemote,
  subscribeRemoteStores,
  scanZombieObservables,
  subscribeStores,
  type StoreStructureReport,
  type StructureIssueKind,
  type ZombieKind,
  type ZombieScanResult,
} from "@mobx-devtools/sdk";
import {
  isComputedProp,
  isObservableArray,
  isObservableMap,
  isObservableObject,
  isObservableProp,
  keys,
  runInAction,
  set as setObservable,
  toJS,
} from "mobx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import {
  formatFiberChainForDebug,
  inspectReactDomElement,
  type ReactDomInspectResult,
} from "./reactDomInspect";
import { MultiStoreExplorerGraph } from "./MultiStoreExplorerGraph";

export type MobxDevtoolsProps = {
  initialIsOpen?: boolean;
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  /** Встроенный оверлей (по умолчанию) или отдельная вкладка — только зеркало по BroadcastChannel */
  mode?: "embedded" | "remote";
  /**
   * Если задано, в шапке появится кнопка «Во вкладке» (например `/devtools.html` в Vite MPA).
   */
  standaloneDevtoolsHref?: string;
};

type TabId =
  | "overview"
  | "timeline"
  | "inspect"
  | "uiInspect"
  | "stores"
  | "zombies"
  | "structure"
  | "settings";

const theme = {
  bg: "#1a1a1a",
  bgRaised: "#222222",
  bgHover: "#2a2a2a",
  bgActiveRow: "rgba(66, 184, 131, 0.18)",
  border: "#333333",
  borderSubtle: "#2a2a2a",
  accent: "#42b883",
  accentMuted: "rgba(66, 184, 131, 0.25)",
  text: "#e4e4e4",
  textMuted: "#8a8a8a",
  value: "#c678dd",
  typeLabel: "#569cd6",
  fontSans:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontMono:
    'ui-monospace, "JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
} as const;

/** Исключаем узлы панели DevTools при выборе элемента на странице. */
const DEVTOOLS_ROOT_SEL = "[data-mobx-devtools-root]";

const PICK_OVERLAY_Z = 99990;

const positionStyle: Record<
  NonNullable<MobxDevtoolsProps["position"]>,
  CSSProperties
> = {
  "bottom-left": { bottom: 12, left: 12 },
  "bottom-right": { bottom: 12, right: 12 },
  "top-left": { top: 12, left: 12 },
  "top-right": { top: 12, right: 12 },
};

function IconInfo({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.75" />
      <path
        d="M12 10v7M12 7h.01"
        stroke={c}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTimeline({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke={c} strokeWidth="1.75" />
      <path
        d="M12 7v5l3 2"
        stroke={c}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGraph({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="18" r="2.25" fill={c} />
      <circle cx="18" cy="6" r="2.25" fill={c} />
      <circle cx="15" cy="17" r="2.25" fill={c} />
      <path
        d="M8 17l7-9 2 8"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStores({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke={c} strokeWidth="1.5" />
      <path
        d="M4 6v5c0 1.66 3.58 3 8 3s8-1.34 8-3V6"
        stroke={c}
        strokeWidth="1.5"
      />
      <path
        d="M4 11v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5"
        stroke={c}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IconUiInspect({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 4l4 4M20 4l-4 4M4 20l4-4M20 20l-4-4M12 8v8M8 12h8"
        stroke={c}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3" stroke={c} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function IconZombie({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <ellipse cx="12" cy="13" rx="7" ry="8" stroke={c} strokeWidth="1.5" />
      <path
        d="M9 11h2M13 11h2M9.5 16c1 1.5 4 1.5 5 0"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 5l2 2M17 5l-2 2"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconStructure({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18h16M4 13h10M4 8h14M4 3h8"
        stroke={c}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSettings({ active }: { active: boolean }) {
  const c = active ? theme.accent : theme.textMuted;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 100-6 3 3 0 000 6z"
        stroke={c}
        strokeWidth="1.75"
      />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke={c}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TABS: {
  id: TabId;
  label: string;
  Icon: (p: { active: boolean }) => ReactElement;
}[] = [
  { id: "overview", label: "Обзор", Icon: IconInfo },
  { id: "timeline", label: "Таймлайн", Icon: IconTimeline },
  { id: "inspect", label: "Граф", Icon: IconGraph },
  { id: "uiInspect", label: "UI", Icon: IconUiInspect },
  { id: "stores", label: "Сторы", Icon: IconStores },
  { id: "zombies", label: "Зомби", Icon: IconZombie },
  { id: "structure", label: "Структура", Icon: IconStructure },
  { id: "settings", label: "Настройки", Icon: IconSettings },
];

function formatRawPreview(raw: DevtoolsEvent["raw"]): string {
  try {
    return JSON.stringify(raw, replacerSafe, 2);
  } catch {
    return String(raw);
  }
}

function replacerSafe(_key: string, value: unknown) {
  if (typeof value === "function") return "[Function]";
  if (typeof value === "bigint") return value.toString() + "n";
  return value;
}

/**
 * `toJS` из MobX для ObservableMap возвращает нативный `Map`; `JSON.stringify(Map)` даёт `{}`.
 * Рекурсивно приводим Map/Set к обычным объектам и массивам для превью в UI.
 */
function jsonPlainForPreview(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const o: Record<string, unknown> = {};
    value.forEach((v, k) => {
      o[String(k)] = jsonPlainForPreview(v);
    });
    return o;
  }
  if (value instanceof Set) {
    return [...value].map(jsonPlainForPreview);
  }
  if (Array.isArray(value)) {
    return value.map(jsonPlainForPreview);
  }
  const o: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    o[key] = jsonPlainForPreview(
      (value as Record<string, unknown>)[key],
    );
  }
  return o;
}

function safeJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(jsonPlainForPreview(toJS(value)), replacerSafe, 2);
  } catch {
    try {
      return JSON.stringify(jsonPlainForPreview(value), replacerSafe, 2);
    } catch {
      return String(value);
    }
  }
}

type StoreEditRow =
  | { key: string; mode: "primitive"; value: string | number | boolean | null }
  | { key: string; mode: "computed"; value: unknown }
  | { key: string; mode: "nested"; value: unknown };

function mobxKeyString(k: PropertyKey): string {
  return typeof k === "symbol" ? String(k) : String(k);
}

function coercePrimitiveInput(
  prev: unknown,
  raw: string,
): { ok: true; value: unknown } | { ok: false } {
  if (prev === null && raw.trim() === "") return { ok: true, value: null };
  if (typeof prev === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) return { ok: false };
    return { ok: true, value: n };
  }
  if (typeof prev === "boolean") {
    return { ok: true, value: raw === "true" || raw === "1" };
  }
  if (typeof prev === "string") return { ok: true, value: raw };
  return { ok: true, value: raw };
}

type ObservableMapLike<K = PropertyKey, V = unknown> = {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
};

const nestedPreStyle: CSSProperties = {
  margin: 0,
  padding: "6px 8px",
  borderRadius: 4,
  border: `1px solid ${theme.borderSubtle}`,
  background: theme.bg,
  fontFamily: theme.fontMono,
  fontSize: 9,
  color: theme.value,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowX: "auto",
};

function NestedObservableValue({
  value,
  depth,
  syncKey,
}: {
  value: unknown;
  depth: number;
  syncKey: number;
}) {
  if (value != null && typeof value === "object" && isObservableMap(value)) {
    return (
      <ObservableMapNestedEditor
        map={value as ObservableMapLike}
        depth={depth}
        syncKey={syncKey}
      />
    );
  }
  if (value != null && typeof value === "object" && isObservableArray(value)) {
    return (
      <ObservableArrayNestedEditor
        arr={value as unknown[]}
        depth={depth}
        syncKey={syncKey}
      />
    );
  }
  if (value != null && typeof value === "object" && isObservableObject(value)) {
    return (
      <StoreQuickEdit subject={value as object} depth={depth} syncKey={syncKey} />
    );
  }
  return <pre style={nestedPreStyle}>{safeJsonPreview(value)}</pre>;
}

function ObservableMapNestedEditor({
  map,
  depth,
  syncKey,
}: {
  map: ObservableMapLike;
  depth: number;
  syncKey: number;
}) {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const entries = useMemo(() => {
    const out: { k: PropertyKey; v: unknown }[] = [];
    try {
      for (const k of keys(map as object)) {
        out.push({ k, v: map.get(k as never) });
      }
    } catch {
      /* ignore */
    }
    return out;
  }, [map, tick, syncKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map(({ k, v }) => {
        const keyStr = mobxKeyString(k);
        return (
          <div key={keyStr}>
            <span
              style={{
                fontFamily: theme.fontMono,
                fontSize: 10,
                color: theme.typeLabel,
              }}
            >
              {keyStr}
            </span>
            {v === null ||
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean" ? (
              <div style={{ marginTop: 4 }}>
                {typeof v === "boolean" ? (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={v}
                      onChange={(e) => {
                        runInAction(() => {
                          map.set(k as never, e.target.checked as never);
                        });
                        refresh();
                      }}
                    />
                    {String(v)}
                  </label>
                ) : keyStr.length + String(v ?? "").length > 60 ? (
                  <textarea
                    key={`${keyStr}-${tick}`}
                    defaultValue={v === null ? "" : String(v)}
                    rows={2}
                    onBlur={(e) => {
                      const r = coercePrimitiveInput(v, e.currentTarget.value);
                      if (!r.ok) return;
                      runInAction(() => {
                        map.set(k as never, r.value as never);
                      });
                      refresh();
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      resize: "vertical",
                      minHeight: 36,
                      padding: "6px 8px",
                      borderRadius: 4,
                      border: `1px solid ${theme.border}`,
                      background: theme.bg,
                      color: theme.text,
                      fontFamily: theme.fontMono,
                      fontSize: 10,
                    }}
                  />
                ) : (
                  <input
                    key={`${keyStr}-${tick}`}
                    type={typeof v === "number" ? "number" : "text"}
                    defaultValue={v === null ? "" : String(v)}
                    onBlur={(e) => {
                      const r = coercePrimitiveInput(v, e.currentTarget.value);
                      if (!r.ok) return;
                      runInAction(() => {
                        map.set(k as never, r.value as never);
                      });
                      refresh();
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "6px 8px",
                      borderRadius: 4,
                      border: `1px solid ${theme.border}`,
                      background: theme.bg,
                      color: theme.text,
                      fontFamily: theme.fontMono,
                      fontSize: 10,
                    }}
                  />
                )}
              </div>
            ) : (
              <div style={{ marginTop: 4 }}>
                <NestedObservableValue
                  value={v}
                  depth={depth + 1}
                  syncKey={syncKey + tick}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ObservableArrayNestedEditor({
  arr,
  depth,
  syncKey,
}: {
  arr: unknown[];
  depth: number;
  syncKey: number;
}) {
  const len = arr.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: len }, (_, idx) => (
        <div key={`${syncKey}-${idx}`}>
          <span
            style={{
              fontSize: 10,
              color: theme.textMuted,
              fontFamily: theme.fontMono,
            }}
          >
            [{idx}]
          </span>
          <NestedObservableValue
            value={arr[idx]}
            depth={depth + 1}
            syncKey={syncKey}
          />
        </div>
      ))}
    </div>
  );
}

/** Редактирование примитивных observable-полей выбранного store (object из spy). */
function StoreQuickEdit({
  subject,
  depth = 0,
  syncKey = 0,
}: {
  subject: object;
  depth?: number;
  syncKey?: number;
}) {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const rows = useMemo((): StoreEditRow[] => {
    if (!isObservableObject(subject)) return [];
    const list: StoreEditRow[] = [];
    for (const k of keys(subject)) {
      const key = mobxKeyString(k);
      try {
        if (isComputedProp(subject, key)) {
          list.push({
            key,
            mode: "computed",
            value: (subject as Record<string, unknown>)[key],
          });
          continue;
        }
        if (!isObservableProp(subject, key)) continue;
        const v = (subject as Record<string, unknown>)[key];
        if (
          v === null ||
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          list.push({ key, mode: "primitive", value: v as never });
        } else {
          list.push({ key, mode: "nested", value: v });
        }
      } catch {
        /* ключ недоступен */
      }
    }
    return list;
  }, [subject, tick]);

  if (rows.length === 0) return null;

  function applyPrimitive(key: string, prev: unknown, raw: string) {
    const r = coercePrimitiveInput(prev, raw);
    if (!r.ok) return;
    runInAction(() => {
      setObservable(subject, key, r.value);
    });
    refresh();
  }

  const childSync = syncKey + tick;

  return (
    <div
      style={{
        ...(depth === 0
          ? {
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              borderBottom: `1px solid ${theme.borderSubtle}`,
            }
          : {
              marginTop: 4,
              paddingLeft: 8,
              borderLeft: `1px solid ${theme.borderSubtle}`,
            }),
        display: "flex",
        flexDirection: "column",
      }}
    >
      {depth === 0 ? (
        <div
          style={{
            flexShrink: 0,
            padding: "8px 10px 0",
            fontWeight: 700,
            color: theme.accent,
            marginBottom: 8,
            fontFamily: theme.fontSans,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Store
        </div>
      ) : null}
      <div
        style={{
          ...(depth === 0
            ? { flex: 1, minHeight: 0, overflow: "auto" }
            : {}),
          padding: depth === 0 ? "0 10px 8px" : "0 0 4px",
        }}
      >
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            marginBottom: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: theme.fontMono,
              fontSize: 10,
              color: theme.typeLabel,
            }}
          >
            {row.key}
            {row.mode === "computed" ? (
              <span style={{ color: theme.textMuted, marginLeft: 6 }}>
                (computed)
              </span>
            ) : null}
            {row.mode === "nested" ? (
              <span style={{ color: theme.textMuted, marginLeft: 6 }}>
                (вложенное)
              </span>
            ) : null}
          </span>
          {row.mode === "primitive" ? (
            typeof row.value === "boolean" ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={row.value}
                  onChange={(e) => {
                    runInAction(() => {
                      setObservable(subject, row.key, e.target.checked);
                    });
                    refresh();
                  }}
                />
                {String(row.value)}
              </label>
            ) : row.key.length + String(row.value).length > 60 ? (
              <textarea
                key={`${row.key}-${tick}`}
                defaultValue={row.value === null ? "" : String(row.value)}
                rows={2}
                onBlur={(e) =>
                  applyPrimitive(row.key, row.value, e.currentTarget.value)
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "vertical",
                  minHeight: 36,
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: `1px solid ${theme.border}`,
                  background: theme.bg,
                  color: theme.text,
                  fontFamily: theme.fontMono,
                  fontSize: 10,
                }}
              />
            ) : (
              <input
                key={`${row.key}-${tick}`}
                type={typeof row.value === "number" ? "number" : "text"}
                defaultValue={
                  row.value === null ? "" : String(row.value)
                }
                onBlur={(e) =>
                  applyPrimitive(row.key, row.value, e.currentTarget.value)
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: `1px solid ${theme.border}`,
                  background: theme.bg,
                  color: theme.text,
                  fontFamily: theme.fontMono,
                  fontSize: 10,
                }}
              />
            )
          ) : row.mode === "computed" ? (
            <pre
              style={{
                ...nestedPreStyle,
                color: theme.textMuted,
              }}
            >
              {safeJsonPreview(row.value)}
            </pre>
          ) : (
            <NestedObservableValue
              value={row.value}
              depth={depth + 1}
              syncKey={childSync}
            />
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

function StoresPane({
  storesSource,
}: {
  storesSource: "embedded" | "remote";
}) {
  const remote = storesSource === "remote";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [storesListW, setStoresListW] = useState(() =>
    readStoredColW(LS_STORES_LIST, 280, 160, 640),
  );
  const storesListWLive = useRef(storesListW);
  storesListWLive.current = storesListW;
  const storesSplitDrag = useRef<{ startX: number; startW: number } | null>(
    null,
  );

  const [stores, setStores] = useState<RegisteredStore[]>(() =>
    remote ? getRemoteRegisteredStores() : getRegisteredStores(),
  );
  const [selId, setSelId] = useState<string | null>(null);
  const [storesPaneMode, setStoresPaneMode] = useState<"edit" | "graph">(
    "edit",
  );

  useEffect(() => {
    if (remote) {
      setStores(getRemoteRegisteredStores());
      return subscribeRemoteStores(() =>
        setStores(getRemoteRegisteredStores()),
      );
    }
    setStores(getRegisteredStores());
    return subscribeStores(() => setStores(getRegisteredStores()));
  }, [remote]);

  useEffect(() => {
    if (selId && !stores.some((s) => s.id === selId)) setSelId(null);
  }, [stores, selId]);

  const selected = stores.find((s) => s.id === selId) ?? null;

  function onStoresSplitMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    storesSplitDrag.current = {
      startX: e.clientX,
      startW: storesListWLive.current,
    };
    const onMove = (ev: MouseEvent) => {
      const d = storesSplitDrag.current;
      if (!d) return;
      const cw = wrapRef.current?.clientWidth ?? window.innerWidth;
      const handle = 12;
      const minRight = 260;
      const maxLeft = Math.max(160, cw - minRight - handle);
      const dx = ev.clientX - d.startX;
      const w = Math.min(
        maxLeft,
        Math.max(160, Math.round(d.startW + dx)),
      );
      storesListWLive.current = w;
      setStoresListW(w);
    };
    const onUp = () => {
      storesSplitDrag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem(LS_STORES_LIST, String(storesListWLive.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const graphTheme = {
    bg: theme.bg,
    bgRaised: theme.bgRaised,
    border: theme.border,
    accent: theme.accent,
    text: theme.text,
    textMuted: theme.textMuted,
  };

  const modeBtn = (active: boolean): CSSProperties => ({
    padding: "5px 10px",
    borderRadius: 5,
    border: `1px solid ${active ? theme.accent : theme.border}`,
    background: active ? theme.accentMuted : theme.bgRaised,
    color: active ? theme.accent : theme.textMuted,
    cursor: "pointer",
    fontFamily: theme.fontSans,
    fontSize: 10,
    fontWeight: active ? 700 : 500,
  });

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderBottom: `1px solid ${theme.borderSubtle}`,
          background: theme.bg,
        }}
      >
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: theme.textMuted,
          }}
        >
          Сторы · {stores.length}
          {remote ? (
            <span
              style={{
                display: "block",
                marginTop: 4,
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: "normal",
              }}
            >
              Зеркало из основного окна; правка полей только там.
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setStoresPaneMode("edit")}
            style={modeBtn(storesPaneMode === "edit")}
          >
            Редактор
          </button>
          <button
            type="button"
            onClick={() => setStoresPaneMode("graph")}
            style={modeBtn(storesPaneMode === "graph")}
          >
            Карта связей
          </button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
      <div
        style={{
          flex: `0 0 ${storesListW}px`,
          minWidth: 160,
          borderRight: `1px solid ${theme.borderSubtle}`,
          display: "flex",
          flexDirection: "column",
          background: theme.bg,
        }}
      >
        <div
          style={{
            padding: "6px 10px 8px",
            borderBottom: `1px solid ${theme.borderSubtle}`,
            fontSize: 10,
            color: theme.textMuted,
            lineHeight: 1.4,
          }}
        >
          {storesPaneMode === "graph"
            ? "Клик по узлу на карте выделяет стор в списке."
            : "Выберите стор для правки полей."}
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            overflow: "auto",
            flex: 1,
          }}
        >
          {stores.map((s) => {
            const on = s.id === selId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelId(s.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderLeft: on
                      ? `3px solid ${theme.accent}`
                      : "3px solid transparent",
                    background: on ? theme.bgActiveRow : "transparent",
                    color: theme.text,
                    cursor: "pointer",
                    fontFamily: theme.fontSans,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{s.debugName}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: theme.textMuted,
                      fontFamily: theme.fontMono,
                    }}
                  >
                    {s.id}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <ColumnResizeHandle
        label="Ширина списка сторов"
        onMouseDown={onStoresSplitMouseDown}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: theme.bgRaised,
        }}
      >
        {storesPaneMode === "graph" ? (
          <MultiStoreExplorerGraph
            stores={stores}
            selectedId={selId}
            onSelectStore={setSelId}
            isRemote={remote}
            graphTheme={graphTheme}
          />
        ) : selected ? (
          <>
            <div
              style={{
                flexShrink: 0,
                padding: "10px 12px",
                borderBottom: `1px solid ${theme.borderSubtle}`,
                fontFamily: theme.fontMono,
                fontSize: 11,
                color: theme.value,
              }}
            >
              {selected.debugName}
            </div>
            {!selected.isRemoteSnapshot ? (
              <StoreQuickEdit subject={selected.target} />
            ) : null}
          </>
        ) : (
          <div style={{ padding: 16, color: theme.textMuted, fontSize: 12 }}>
            {remote ? (
              <>
                Ожидание данных из вкладки с приложением. Убедись, что там открыт MobX DevTools
                (трансляция через BroadcastChannel, тот же origin).
              </>
            ) : (
              <>
                Сторы регистрируются из{" "}
                <code style={{ fontFamily: theme.fontMono }}>spy</code>, когда в событии есть
                observable-объект в поле{" "}
                <code style={{ fontFamily: theme.fontMono }}>object</code> (чаще всего host
                action). Выбери store слева — редактируй примитивы; computed и вложенные структуры
                только для просмотра. Вкладка «Карта связей» — граф зависимостей между сторами.
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const ZOMBIE_KIND_RU: Record<ZombieKind, string> = {
  observable: "Observable",
  computed: "Computed",
  boxed: "Box",
  array: "Array",
  map: "Map",
  set: "Set",
};

function ZombieObservablesPane({
  storesSource,
}: {
  storesSource: "embedded" | "remote";
}) {
  const remote = storesSource === "remote";
  const [stores, setStores] = useState<RegisteredStore[]>(() =>
    remote ? getRemoteRegisteredStores() : getRegisteredStores(),
  );
  const [search, setSearch] = useState("");
  const [lastScan, setLastScan] = useState<ZombieScanResult | null>(null);

  useEffect(() => {
    if (remote) {
      setStores(getRemoteRegisteredStores());
      return subscribeRemoteStores(() =>
        setStores(getRemoteRegisteredStores()),
      );
    }
    setStores(getRegisteredStores());
    return subscribeStores(() => setStores(getRegisteredStores()));
  }, [remote]);

  const runScan = useCallback(() => {
    setLastScan(scanZombieObservables(stores));
  }, [stores]);

  const filtered = useMemo(() => {
    if (!lastScan) return [];
    const q = search.trim().toLowerCase();
    if (!q) return lastScan.findings;
    return lastScan.findings.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.kind.toLowerCase().includes(q) ||
        ZOMBIE_KIND_RU[f.kind].toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q),
    );
  }, [lastScan, search]);

  if (remote) {
    return (
      <div
        style={{
          flex: 1,
          padding: 16,
          color: theme.textMuted,
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        <p style={{ margin: "0 0 8px", fontSize: 13, color: theme.text }}>
          Нужен живой MobX из приложения
        </p>
        <p style={{ margin: 0 }}>
          Детектор зомби вызывает{" "}
          <code style={{ fontFamily: theme.fontMono }}>getObserverTree</code> по
          сторам. В отдельной вкладке в реестре только имена — без observable.
          Откройте панель в том же окне, что и приложение (embedded), чтобы
          сканировать.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        padding: "10px 12px",
      }}
    >
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          color: theme.textMuted,
          lineHeight: 1.5,
        }}
      >
        Узлы MobX без наблюдателей: ни реакций, ни{" "}
        <code style={{ fontFamily: theme.fontMono }}>autorun</code>, ни React{" "}
        <code style={{ fontFamily: theme.fontMono }}>observer</code>. Сканируются
        сторы из реестра (как на вкладке «Сторы»). Вложенные observable-объекты
        как целое не помечаются — только поля; чтение вне трекинга даёт ложные
        срабатывания.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={runScan}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${theme.accent}`,
            background: theme.accentMuted,
            color: theme.accent,
            cursor: "pointer",
            fontFamily: theme.fontSans,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Сканировать
        </button>
        <span style={{ fontSize: 11, color: theme.textMuted }}>
          Сторов: {stores.length}
          {lastScan
            ? ` · находок: ${lastScan.findings.length}${
                lastScan.truncated ? "+" : ""
              }`
            : ""}
        </span>
        <input
          type="search"
          placeholder="Поиск по пути, типу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!lastScan}
          style={{
            marginLeft: "auto",
            minWidth: 160,
            flex: "1 1 180px",
            maxWidth: 320,
            boxSizing: "border-box",
            padding: "6px 10px",
            borderRadius: 4,
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.text,
            fontFamily: theme.fontSans,
            fontSize: 11,
            outline: "none",
            opacity: lastScan ? 1 : 0.45,
          }}
        />
      </div>
      {lastScan && lastScan.skippedRemoteStores > 0 ? (
        <p style={{ margin: "0 0 8px", fontSize: 10, color: theme.typeLabel }}>
          Пропущено remote-сторов: {lastScan.skippedRemoteStores}
        </p>
      ) : null}
      {lastScan && lastScan.truncated ? (
        <p style={{ margin: "0 0 8px", fontSize: 10, color: theme.typeLabel }}>
          Список обрезан по лимиту — уточните сторы или поднимите лимит в SDK (
          <code style={{ fontFamily: theme.fontMono }}>maxFindings</code>).
        </p>
      ) : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          border: `1px solid ${theme.borderSubtle}`,
          borderRadius: 6,
          background: theme.bgRaised,
        }}
      >
        {!lastScan ? (
          <div style={{ padding: 16, color: theme.textMuted, fontSize: 12 }}>
            Нажмите «Сканировать», чтобы проверить зарегистрированные сторы.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 16, color: theme.textMuted, fontSize: 12 }}>
            {lastScan.findings.length === 0
              ? "Мёртвого state не найдено (или всё имеет наблюдателей)."
              : "Нет совпадений с поиском."}
          </div>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              fontSize: 11,
              fontFamily: theme.fontMono,
            }}
          >
            {filtered.map((f, i) => (
              <li
                key={`${f.label}-${f.kind}-${i}`}
                style={{
                  padding: "8px 10px",
                  borderBottom: `1px solid ${theme.borderSubtle}`,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px 12px",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    flex: "0 0 72px",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    color: theme.accent,
                  }}
                >
                  {ZOMBIE_KIND_RU[f.kind]}
                </span>
                <span style={{ color: theme.value, wordBreak: "break-word" }}>
                  {f.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const STRUCTURE_ISSUE_RU: Record<StructureIssueKind, string> = {
  store_too_large: "Размер стора",
  too_many_top_level_fields: "Много полей сверху",
  deep_observable_nesting: "Вложенность",
  wide_object: "Ширина объекта",
  dependency_cycle: "Цикл",
  dependency_graph_truncated: "Граф обрезан",
};

function StoreStructurePane({
  storesSource,
}: {
  storesSource: "embedded" | "remote";
}) {
  const remote = storesSource === "remote";
  const [stores, setStores] = useState<RegisteredStore[]>(() =>
    remote ? getRemoteRegisteredStores() : getRegisteredStores(),
  );
  const [search, setSearch] = useState("");
  const [last, setLast] = useState<StoreStructureReport | null>(null);

  useEffect(() => {
    if (remote) {
      setStores(getRemoteRegisteredStores());
      return subscribeRemoteStores(() =>
        setStores(getRemoteRegisteredStores()),
      );
    }
    setStores(getRegisteredStores());
    return subscribeStores(() => setStores(getRegisteredStores()));
  }, [remote]);

  const runAnalyze = useCallback(() => {
    setLast(analyzeStoreStructure(stores));
  }, [stores]);

  const filteredIssues = useMemo(() => {
    if (!last) return [];
    const q = search.trim().toLowerCase();
    if (!q) return last.issues;
    return last.issues.filter((issue) => {
      const kindRu = STRUCTURE_ISSUE_RU[issue.kind].toLowerCase();
      return (
        issue.title.toLowerCase().includes(q) ||
        issue.detail.toLowerCase().includes(q) ||
        issue.kind.toLowerCase().includes(q) ||
        kindRu.includes(q) ||
        (issue.storeDebugName?.toLowerCase().includes(q) ?? false) ||
        (issue.path?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [last, search]);

  const filteredSummaries = useMemo(() => {
    if (!last) return [];
    const q = search.trim().toLowerCase();
    if (!q) return last.summaries;
    return last.summaries.filter(
      (s) =>
        s.storeDebugName.toLowerCase().includes(q) ||
        s.storeId.toLowerCase().includes(q),
    );
  }, [last, search]);

  if (remote) {
    return (
      <div
        style={{
          flex: 1,
          padding: 16,
          color: theme.textMuted,
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        <p style={{ margin: "0 0 8px", fontSize: 13, color: theme.text }}>
          Нужен живой MobX из приложения
        </p>
        <p style={{ margin: 0 }}>
          Анализ структуры обходит observable-деревья и вызывает{" "}
          <code style={{ fontFamily: theme.fontMono }}>getDependencyTree</code>
          . Во вкладке remote нет живых сторов — откройте панель в embedded-режиме.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        padding: "10px 12px",
      }}
    >
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          color: theme.textMuted,
          lineHeight: 1.5,
        }}
      >
        Метрики по реестру сторов: перегруз полями, глубина вложенных{" "}
        <code style={{ fontFamily: theme.fontMono }}>observable</code>-объектов,
        «ширина» одного объекта; отдельно — поиск циклов в графе{" "}
        <strong>прямых</strong> зависимостей MobX между атомами (как во вкладке
        «Граф», но по всем полям сторов сразу).
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={runAnalyze}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${theme.accent}`,
            background: theme.accentMuted,
            color: theme.accent,
            cursor: "pointer",
            fontFamily: theme.fontSans,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Анализировать
        </button>
        <span style={{ fontSize: 11, color: theme.textMuted }}>
          Сторов: {stores.length}
          {last
            ? ` · узлов графа: ${last.dependencyNodeCount}, рёбер: ${last.dependencyEdgeCount}${
                last.truncatedDependencies ? "+" : ""
              }`
            : ""}
        </span>
        <input
          type="search"
          placeholder="Поиск по замечаниям и сторам…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!last}
          style={{
            marginLeft: "auto",
            minWidth: 160,
            flex: "1 1 180px",
            maxWidth: 320,
            boxSizing: "border-box",
            padding: "6px 10px",
            borderRadius: 4,
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.text,
            fontFamily: theme.fontSans,
            fontSize: 11,
            outline: "none",
            opacity: last ? 1 : 0.45,
          }}
        />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {!last ? (
          <div
            style={{
              padding: 16,
              color: theme.textMuted,
              fontSize: 12,
              border: `1px solid ${theme.borderSubtle}`,
              borderRadius: 6,
              background: theme.bgRaised,
            }}
          >
            Нажмите «Анализировать», чтобы собрать метрики и проверить циклы.
          </div>
        ) : (
          <>
            <div
              style={{
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: 6,
                background: theme.bgRaised,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: `1px solid ${theme.borderSubtle}`,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: theme.textMuted,
                  textTransform: "uppercase",
                }}
              >
                Замечания ({filteredIssues.length}
                {search.trim() ? ` / ${last.issues.length}` : ""})
              </div>
              {filteredIssues.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12, color: theme.textMuted }}>
                  {last.issues.length === 0
                    ? "Замечаний нет — пороги не превышены и циклов не найдено."
                    : "Нет совпадений с поиском."}
                </div>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    fontSize: 11,
                  }}
                >
                  {filteredIssues.map((issue, i) => (
                    <li
                      key={`${issue.kind}-${issue.title}-${i}`}
                      style={{
                        padding: "10px 10px",
                        borderBottom: `1px solid ${theme.borderSubtle}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "6px 10px",
                          alignItems: "center",
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            color:
                              issue.severity === "warn"
                                ? theme.typeLabel
                                : theme.textMuted,
                          }}
                        >
                          {issue.severity === "warn" ? "WARN" : "INFO"}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: theme.accent,
                          }}
                        >
                          {STRUCTURE_ISSUE_RU[issue.kind]}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: theme.text,
                            fontFamily: theme.fontSans,
                          }}
                        >
                          {issue.title}
                        </span>
                        {issue.storeDebugName ? (
                          <span
                            style={{
                              fontFamily: theme.fontMono,
                              fontSize: 10,
                              color: theme.value,
                            }}
                          >
                            {issue.storeDebugName}
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          fontFamily: theme.fontMono,
                          fontSize: 10,
                          lineHeight: 1.45,
                          color: theme.textMuted,
                          wordBreak: "break-word",
                        }}
                      >
                        {issue.detail}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div
              style={{
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: 6,
                background: theme.bgRaised,
                overflow: "auto",
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: `1px solid ${theme.borderSubtle}`,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: theme.textMuted,
                  textTransform: "uppercase",
                }}
              >
                Сводка по сторам
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 10,
                  fontFamily: theme.fontMono,
                }}
              >
                <thead>
                  <tr style={{ color: theme.textMuted, textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", fontWeight: 600 }}>Стор</th>
                    <th style={{ padding: "8px 6px", fontWeight: 600 }}>Верх</th>
                    <th style={{ padding: "8px 6px", fontWeight: 600 }}>Всего</th>
                    <th style={{ padding: "8px 6px", fontWeight: 600 }}>Глуб.</th>
                    <th style={{ padding: "8px 6px", fontWeight: 600 }}>Макс. шир.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummaries.map((s) => (
                    <tr
                      key={s.storeId}
                      style={{
                        borderTop: `1px solid ${theme.borderSubtle}`,
                        color: theme.text,
                      }}
                    >
                      <td style={{ padding: "6px 10px", color: theme.value }}>
                        {s.storeDebugName}
                      </td>
                      <td style={{ padding: "6px 6px" }}>{s.topLevelReactive}</td>
                      <td style={{ padding: "6px 6px" }}>
                        {s.totalReactiveFields}
                      </td>
                      <td style={{ padding: "6px 6px" }}>
                        {s.maxObservableObjectDepth}
                      </td>
                      <td style={{ padding: "6px 6px" }}>
                        {s.maxReactiveKeysOnOneObject}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Плавающий оверлей: тёмная панель в духе Vue DevTools — левый бар вкладок, список, детали.
 */
const LS_OPEN = "mobx-devtools-open";
const LS_EXPLAIN_EXPANDED = "mobx-devtools-explain-expanded";
const LS_FULL_VIEWPORT = "mobx-devtools-full-viewport";
const LS_COL_INSTANCE = "mobx-devtools-col-instance-w";
const LS_COL_DETAIL = "mobx-devtools-col-detail-w";
const LS_STORES_LIST = "mobx-devtools-stores-list-w";

function readStoredColW(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (Number.isFinite(v)) return Math.min(max, Math.max(min, Math.round(v)));
  } catch {
    /* ignore */
  }
  return fallback;
}

function ColumnResizeHandle({
  label,
  onMouseDown,
}: {
  label: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onMouseDown={onMouseDown}
      style={{
        flex: "0 0 12px",
        cursor: "col-resize",
        alignSelf: "stretch",
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        flexShrink: 0,
        touchAction: "none",
        background: "transparent",
        zIndex: 3,
        marginLeft: -2,
        marginRight: -2,
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <span
        style={{
          width: 1,
          alignSelf: "stretch",
          background: theme.border,
          opacity: 0.75,
        }}
      />
    </div>
  );
}

export function MobxDevtools({
  initialIsOpen = false,
  position = "bottom-left",
  mode = "embedded",
  standaloneDevtoolsHref,
}: MobxDevtoolsProps) {
  const isRemote = mode === "remote";
  const [open, setOpen] = useState(() => {
    if (isRemote) return true;
    try {
      const v = localStorage.getItem(LS_OPEN);
      if (v !== null) return v === "1";
    } catch {
      /* ignore */
    }
    return initialIsOpen;
  });
  const [viewportFull, setViewportFull] = useState(() => {
    try {
      return localStorage.getItem(LS_FULL_VIEWPORT) === "1";
    } catch {
      return false;
    }
  });
  const [tab, setTab] = useState<TabId>("timeline");
  const [events, setEvents] = useState<readonly DevtoolsEvent[]>(() => [
    ...(isRemote ? getRemoteRecentEvents() : getRecentEvents()),
  ]);
  const [bufferLimit, setBufferLimit] = useState(() =>
    isRemote ? getRemoteMaxEvents() : getMaxEvents(),
  );
  const [query, setQuery] = useState("");
  const [detailQuery, setDetailQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explainExpanded, setExplainExpanded] = useState(() => {
    try {
      const v = localStorage.getItem(LS_EXPLAIN_EXPANDED);
      if (v !== null) return v === "1";
    } catch {
      /* ignore */
    }
    return true;
  });
  /** Пустой массив = все типы; иначе только перечисленные. */
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [storeRegVersion, setStoreRegVersion] = useState(0);

  const [instanceColW, setInstanceColW] = useState(() =>
    readStoredColW(LS_COL_INSTANCE, 140, 88, 320),
  );
  const [detailColW, setDetailColW] = useState(() =>
    readStoredColW(LS_COL_DETAIL, 440, 240, 2000),
  );
  const [colResize, setColResize] = useState<null | "instance" | "detail">(null);
  const colDragRef = useRef({ startX: 0, startInstance: 140, startDetail: 440 });
  const instanceColWLive = useRef(instanceColW);
  const detailColWLive = useRef(detailColW);
  instanceColWLive.current = instanceColW;
  detailColWLive.current = detailColW;

  useEffect(() => {
    if (!colResize) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - colDragRef.current.startX;
      if (colResize === "instance") {
        const w = Math.min(
          320,
          Math.max(88, Math.round(colDragRef.current.startInstance + dx)),
        );
        instanceColWLive.current = w;
        setInstanceColW(w);
      } else {
        const rail = 48;
        const handles = 24; // сплиттер после «Приложение» + сплиттер до деталей
        const minTimeline = 120;
        const maxDetail = Math.max(
          280,
          window.innerWidth -
            instanceColWLive.current -
            rail -
            handles -
            minTimeline,
        );
        const w = Math.min(
          maxDetail,
          Math.max(240, Math.round(colDragRef.current.startDetail + dx)),
        );
        detailColWLive.current = w;
        setDetailColW(w);
      }
    };
    const onUp = () => {
      setColResize(null);
      try {
        localStorage.setItem(LS_COL_INSTANCE, String(instanceColWLive.current));
        localStorage.setItem(LS_COL_DETAIL, String(detailColWLive.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp, true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [colResize]);

  useEffect(() => {
    if (isRemote) return;
    try {
      localStorage.setItem(LS_OPEN, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open, isRemote]);

  useEffect(() => {
    if (isRemote) return;
    try {
      localStorage.setItem(LS_FULL_VIEWPORT, viewportFull ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [viewportFull, isRemote]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_EXPLAIN_EXPANDED, explainExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [explainExpanded]);

  useEffect(() => {
    if (isRemote) {
      const disconnect = connectDevtoolsRemote();
      const sync = () => {
        setEvents([...getRemoteRecentEvents()]);
        setBufferLimit(getRemoteMaxEvents());
      };
      sync();
      const unsub = subscribeRemote(sync);
      return () => {
        unsub();
        disconnect();
      };
    }
    initMobxDevtools();
    const sync = () => {
      setEvents([...getRecentEvents()]);
      setBufferLimit(getMaxEvents());
    };
    sync();
    const u1 = subscribe(() => sync());
    const u2 = subscribeBuffer(() => sync());
    return () => {
      u1();
      u2();
    };
  }, [isRemote]);

  useEffect(() => {
    if (isRemote) {
      return subscribeRemoteStores(() => setStoreRegVersion((v) => v + 1));
    }
    return subscribeStores(() => setStoreRegVersion((v) => v + 1));
  }, [isRemote]);

  const registeredStoreCount = useMemo(() => {
    if (isRemote) return getRemoteRegisteredStores().length;
    return getRegisteredStores().length;
  }, [storeRegVersion, isRemote]);

  const pos = useMemo(() => positionStyle[position], [position]);

  const eventTypes = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) s.add(e.type);
    return [...s].sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...events].reverse();
    if (activeTypes.length > 0) {
      const allow = new Set(activeTypes);
      list = list.filter((e) => allow.has(e.type));
    }
    if (!q) return list;
    return list.filter((e) => {
      const hay = `${e.type} ${e.name ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [events, query, activeTypes]);

  const selected = useMemo(
    () => filteredEvents.find((e) => e.id === selectedId) ?? null,
    [filteredEvents, selectedId],
  );

  const selectedSubject = useMemo(
    () => (selected ? getSubjectFromSpyEvent(selected.raw) : null),
    [selected],
  );

  const detailText = useMemo(() => {
    if (!selected) return "";
    const raw = formatRawPreview(selected.raw);
    const dq = detailQuery.trim().toLowerCase();
    if (!dq) return raw;
    return raw
      .split("\n")
      .filter((line) => line.toLowerCase().includes(dq))
      .join("\n");
  }, [selected, detailQuery]);

  const selectedExplain = useMemo(
    () => (selected ? explainMobxEvent(selected, events) : null),
    [selected, events],
  );

  const panelOffset =
    position.startsWith("bottom") ? { bottom: 52 } : { top: 52 };
  const dockBottom = position.startsWith("bottom");
  const fullViewport = viewportFull || isRemote;

  const titleBarBtn: CSSProperties = {
    border: `1px solid ${theme.border}`,
    background: theme.bg,
    color: theme.textMuted,
    cursor: "pointer",
    fontSize: 11,
    fontFamily: theme.fontSans,
    padding: "4px 10px",
    borderRadius: 4,
  };

  return (
    <>
      {!isRemote ? (
        <button
          type="button"
          data-mobx-devtools-root
          onClick={() => setOpen((v) => !v)}
          style={{
            position: "fixed",
            zIndex: 99998,
            fontFamily: theme.fontSans,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: theme.bg,
            color: theme.accent,
            cursor: "pointer",
            boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
            ...pos,
          }}
          aria-expanded={open}
          aria-label="MobX DevTools"
        >
          MobX
        </button>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-label="MobX DevTools"
          data-mobx-devtools-root
          style={{
            position: "fixed",
            zIndex: 99999,
            width: "100%",
            boxSizing: "border-box",
            height: fullViewport ? "100vh" : "min(520px, 78vh)",
            maxHeight: fullViewport ? "100vh" : undefined,
            display: "flex",
            flexDirection: "column",
            fontFamily: theme.fontSans,
            fontSize: 12,
            lineHeight: 1.45,
            color: theme.text,
            background: theme.bg,
            border: fullViewport ? "none" : `1px solid ${theme.border}`,
            borderRadius: fullViewport
              ? 0
              : dockBottom
                ? "10px 10px 0 0"
                : "0 0 10px 10px",
            boxShadow: fullViewport ? "none" : "0 16px 48px rgba(0,0,0,0.55)",
            overflow: "hidden",
            ...(fullViewport
              ? { top: 0, bottom: 0, left: 0, right: 0 }
              : { ...pos, ...panelOffset, left: 0, right: 0 }),
          }}
        >
          {/* Title bar */}
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 12px",
              borderBottom: `1px solid ${theme.borderSubtle}`,
              background: theme.bgRaised,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, minWidth: 0 }}>
              MobX DevTools
              {isRemote ? (
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    fontSize: 10,
                    color: theme.textMuted,
                    marginTop: 2,
                  }}
                >
                  Зеркало основной вкладки
                </span>
              ) : null}
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
              }}
            >
              {!isRemote && standaloneDevtoolsHref ? (
                <button
                  type="button"
                  style={titleBarBtn}
                  onClick={() => {
                    window.open(
                      standaloneDevtoolsHref,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  Во вкладке
                </button>
              ) : null}
              {!isRemote ? (
                <button
                  type="button"
                  style={titleBarBtn}
                  onClick={() => setViewportFull((v) => !v)}
                >
                  {fullViewport ? "Свернуть" : "На весь экран"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (isRemote) {
                    window.close();
                    return;
                  }
                  setOpen(false);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: theme.textMuted,
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: "0 4px",
                }}
                aria-label={isRemote ? "Закрыть вкладку" : "Закрыть"}
              >
                ×
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Col 1: icon rail */}
            <nav
              role="tablist"
              aria-label="Разделы"
              style={{
                width: 48,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: `1px solid ${theme.borderSubtle}`,
                background: theme.bg,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              {TABS.map(({ id, label, Icon }, i) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={label}
                    title={label}
                    onClick={() => setTab(id)}
                    style={{
                      width: "100%",
                      height: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      cursor: "pointer",
                      background: active ? theme.accentMuted : "transparent",
                      borderLeft: active
                        ? `3px solid ${theme.accent}`
                        : "3px solid transparent",
                      color: theme.text,
                      marginTop: i === TABS.length - 1 ? "auto" : 0,
                    }}
                  >
                    <Icon active={active} />
                  </button>
                );
              })}
            </nav>

            {/* Col 2: instance strip (как App 1 / App 2) */}
            <div
              style={{
                flex: `0 0 ${instanceColW}px`,
                flexShrink: 0,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                background: theme.bgRaised,
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: theme.textMuted,
                  borderBottom: `1px solid ${theme.borderSubtle}`,
                }}
              >
                Приложение
              </div>
              <button
                type="button"
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  cursor: "default",
                  background: theme.accent,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                App (default)
              </button>
            </div>

            <ColumnResizeHandle
              label="Ширина колонки приложения"
              onMouseDown={(e) => {
                e.preventDefault();
                colDragRef.current.startX = e.clientX;
                colDragRef.current.startInstance = instanceColW;
                setColResize("instance");
              }}
            />

            {/* Main + detail */}
            <div
              style={{
                display: "flex",
                flex: 1,
                minWidth: 0,
                minHeight: 0,
              }}
            >
              {tab === "overview" && (
                <OverviewPane
                  eventCount={events.length}
                  maxEvents={getMaxEvents()}
                />
              )}
              {tab === "timeline" && (
                <>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 10px",
                        borderBottom: `1px solid ${theme.borderSubtle}`,
                      }}
                    >
                      <input
                        type="search"
                        placeholder="Найти событие…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "6px 10px",
                          borderRadius: 4,
                          border: `1px solid ${theme.border}`,
                          background: theme.bgRaised,
                          color: theme.text,
                          fontFamily: theme.fontSans,
                          fontSize: 12,
                          outline: "none",
                        }}
                      />
                      {eventTypes.length > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                            marginTop: 8,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveTypes([])}
                            style={{
                              padding: "3px 8px",
                              borderRadius: 4,
                              border: `1px solid ${theme.border}`,
                              background:
                                activeTypes.length === 0
                                  ? theme.accentMuted
                                  : "transparent",
                              color:
                                activeTypes.length === 0
                                  ? theme.accent
                                  : theme.textMuted,
                              cursor: "pointer",
                              fontFamily: theme.fontSans,
                              fontSize: 10,
                            }}
                          >
                            Все типы
                          </button>
                          {eventTypes.map((t) => {
                            const active = activeTypes.includes(t);
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  setActiveTypes((prev) => {
                                    if (prev.length === 0) return [t];
                                    if (prev.includes(t)) {
                                      const next = prev.filter((x) => x !== t);
                                      return next;
                                    }
                                    return [...prev, t];
                                  });
                                }}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 4,
                                  border: `1px solid ${active ? theme.accent : theme.border}`,
                                  background: active
                                    ? theme.accentMuted
                                    : "transparent",
                                  color: active ? theme.accent : theme.textMuted,
                                  cursor: "pointer",
                                  fontFamily: theme.fontMono,
                                  fontSize: 10,
                                }}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: "none",
                        overflow: "auto",
                        flex: 1,
                      }}
                    >
                      {filteredEvents.map((e) => {
                        const sel = e.id === selectedId;
                        return (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(e.id)}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 12px",
                                border: "none",
                                borderLeft: sel
                                  ? `3px solid ${theme.accent}`
                                  : "3px solid transparent",
                                background: sel
                                  ? theme.bgActiveRow
                                  : "transparent",
                                color: theme.text,
                                cursor: "pointer",
                                fontFamily: theme.fontMono,
                                fontSize: 11,
                              }}
                            >
                              <span style={{ color: theme.accent }}>
                                {e.type}
                              </span>
                              {e.name != null ? (
                                <span style={{ color: theme.value }}>
                                  {" "}
                                  {String(e.name)}
                                </span>
                              ) : null}
                              <span
                                style={{
                                  color: theme.textMuted,
                                  display: "block",
                                  marginTop: 2,
                                  fontSize: 10,
                                }}
                              >
                                t = {e.timestamp.toFixed(1)} ms
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <ColumnResizeHandle
                    label="Ширина панели деталей"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      colDragRef.current.startX = e.clientX;
                      colDragRef.current.startDetail = detailColW;
                      setColResize("detail");
                    }}
                  />
                  <div
                    style={{
                      flex: `0 0 ${detailColW}px`,
                      flexShrink: 0,
                      minWidth: 240,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      background: theme.bgRaised,
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 10px",
                        borderBottom: `1px solid ${theme.borderSubtle}`,
                        fontFamily: theme.fontMono,
                        fontSize: 11,
                        fontWeight: 600,
                        color: theme.text,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        {selected ? (
                          <>
                            <span style={{ color: theme.accent }}>
                              {selected.type}
                            </span>
                            {selected.name != null ? (
                              <span style={{ color: theme.value }}>
                                {" "}
                                {String(selected.name)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span style={{ color: theme.textMuted }}>
                            Событие не выбрано
                          </span>
                        )}
                      </span>
                      {selected && selectedSubject != null ? (
                        <button
                          type="button"
                          onClick={() => setTab("inspect")}
                          style={{
                            flexShrink: 0,
                            fontSize: 10,
                            padding: "4px 8px",
                            borderRadius: 4,
                            border: `1px solid ${theme.accent}`,
                            background: theme.accentMuted,
                            color: theme.accent,
                            cursor: "pointer",
                            fontFamily: theme.fontSans,
                            fontWeight: 600,
                          }}
                        >
                          Граф
                        </button>
                      ) : null}
                    </div>
                    {selected && selectedExplain ? (
                      <div
                        style={{
                          borderBottom: `1px solid ${theme.borderSubtle}`,
                          fontSize: 11,
                          lineHeight: 1.45,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setExplainExpanded((v) => !v)}
                          aria-expanded={explainExpanded}
                          aria-label={
                            explainExpanded
                              ? "Свернуть Explain"
                              : "Развернуть Explain"
                          }
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 10px",
                            border: "none",
                            background: explainExpanded
                              ? theme.bgRaised
                              : "transparent",
                            cursor: "pointer",
                            fontFamily: theme.fontSans,
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              color: theme.textMuted,
                              width: 14,
                              flexShrink: 0,
                            }}
                            aria-hidden
                          >
                            {explainExpanded ? "▼" : "▶"}
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: theme.accent,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              flexShrink: 0,
                            }}
                          >
                            Explain
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: theme.textMuted,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                            }}
                          >
                            {selectedExplain.lines[0]
                              ? `${selectedExplain.lines[0].label}: ${selectedExplain.lines[0].text}`
                              : ""}
                          </span>
                        </button>
                        {explainExpanded ? (
                          <div
                            style={{
                              padding: "4px 10px 10px 32px",
                              maxHeight: "min(220px, 36vh)",
                              overflow: "auto",
                            }}
                          >
                            {selectedExplain.lines.map((line, i) => (
                              <div key={i} style={{ marginBottom: 5 }}>
                                <span style={{ color: theme.textMuted }}>
                                  {line.label}:{" "}
                                </span>
                                <span
                                  style={{
                                    color: theme.text,
                                    fontFamily: theme.fontMono,
                                    fontSize: 10,
                                  }}
                                >
                                  {line.text}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedSubject != null &&
                    typeof selectedSubject === "object" ? (
                      <StoreQuickEdit subject={selectedSubject} />
                    ) : null}
                    <div
                      style={{
                        flexShrink: 0,
                        padding: "8px 10px",
                      }}
                    >
                      <input
                        type="search"
                        placeholder="Фильтр полей…"
                        value={detailQuery}
                        onChange={(e) => setDetailQuery(e.target.value)}
                        disabled={!selected}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "6px 10px",
                          borderRadius: 4,
                          border: `1px solid ${theme.border}`,
                          background: theme.bg,
                          color: theme.text,
                          fontFamily: theme.fontSans,
                          fontSize: 11,
                          outline: "none",
                          opacity: selected ? 1 : 0.45,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        paddingBottom: 10,
                      }}
                    >
                      <pre
                        style={{
                          margin: 0,
                          padding: "0 10px 0",
                          fontFamily: theme.fontMono,
                          fontSize: 10,
                          lineHeight: 1.45,
                          color: theme.value,
                          whiteSpace: "pre",
                          wordBreak: "normal",
                          overflowX: "auto",
                          tabSize: 2,
                        }}
                      >
                        {selected ? (
                          detailText || "— нет совпадений —"
                        ) : (
                          <span style={{ color: theme.textMuted }}>
                            Выберите строку слева, чтобы увидеть payload spy.
                          </span>
                        )}
                      </pre>
                    </div>
                  </div>
                </>
              )}
              {tab === "inspect" && (
                <InspectPane selected={selected} setTab={setTab} />
              )}
              {tab === "uiInspect" && (
                <UiInspectPane isRemote={isRemote} />
              )}
              {tab === "stores" && (
                <StoresPane storesSource={isRemote ? "remote" : "embedded"} />
              )}
              {tab === "zombies" && (
                <ZombieObservablesPane
                  storesSource={isRemote ? "remote" : "embedded"}
                />
              )}
              {tab === "structure" && (
                <StoreStructurePane
                  storesSource={isRemote ? "remote" : "embedded"}
                />
              )}
              {tab === "settings" && (
                <SettingsPane
                  eventCount={events.length}
                  registeredStoreCount={registeredStoreCount}
                  bufferLimit={bufferLimit}
                  onLimitChange={(n) => {
                    setBufferLimit(n);
                    if (isRemote) {
                      sendDevtoolsRemoteCommand({
                        type: "cmd",
                        cmd: "setMax",
                        max: n,
                      });
                    } else {
                      setMaxEvents(n);
                    }
                  }}
                  onClear={() => {
                    if (isRemote) {
                      sendDevtoolsRemoteCommand({ type: "cmd", cmd: "clear" });
                    } else {
                      clearEvents();
                    }
                    setSelectedId(null);
                  }}
                  onClearStoreRegistry={() => {
                    if (isRemote) {
                      sendDevtoolsRemoteCommand({
                        type: "cmd",
                        cmd: "clearStoreRegistry",
                      });
                    } else {
                      clearStoreRegistry();
                    }
                    setStoreRegVersion((v) => v + 1);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function pickElementOutsideDevtools(
  clientX: number,
  clientY: number,
): Element | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    if (node.closest(DEVTOOLS_ROOT_SEL)) continue;
    return node;
  }
  return null;
}

function UiInspectPane({ isRemote }: { isRemote: boolean }) {
  const [picking, setPicking] = useState(false);
  const [hoverEl, setHoverEl] = useState<Element | null>(null);
  const [result, setResult] = useState<ReactDomInspectResult | null>(null);
  const [fiberDebug, setFiberDebug] = useState("");
  const [noFiberOnLastPick, setNoFiberOnLastPick] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const armUntilRef = useRef(0);

  const hoverRect = useMemo(() => {
    if (!hoverEl) return null;
    void layoutTick;
    const r = hoverEl.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, [hoverEl, layoutTick]);

  const startPicking = useCallback(() => {
    armUntilRef.current = Date.now() + 500;
    setPicking(true);
    setHoverEl(null);
  }, []);

  useEffect(() => {
    if (!picking) return;
    const onScrollResize = () => setLayoutTick((t) => t + 1);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [picking]);

  useEffect(() => {
    if (!picking) return;
    const onMove = (e: MouseEvent) => {
      const el = pickElementOutsideDevtools(e.clientX, e.clientY);
      setHoverEl(el);
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() < armUntilRef.current) return;
      const el = pickElementOutsideDevtools(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setPicking(false);
      setHoverEl(null);
      const ins = inspectReactDomElement(el);
      setResult(ins);
      setNoFiberOnLastPick(!ins);
      setFiberDebug(formatFiberChainForDebug(el));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPicking(false);
        setHoverEl(null);
      }
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [picking]);

  if (isRemote) {
    return (
      <div
        style={{
          flex: 1,
          padding: 16,
          color: theme.textMuted,
          fontSize: 12,
        }}
      >
        Инспектор UI доступен только во встроенной панели на странице с приложением,
        не во вкладке-зеркале.
      </div>
    );
  }

  const overlay =
    picking &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        {hoverRect != null && hoverRect.width > 0 && hoverRect.height > 0 ? (
          <div
            style={{
              position: "fixed",
              pointerEvents: "none",
              zIndex: PICK_OVERLAY_Z,
              top: hoverRect.top,
              left: hoverRect.left,
              width: hoverRect.width,
              height: hoverRect.height,
              boxSizing: "border-box",
              border: `2px solid ${theme.accent}`,
              borderRadius: 4,
              background: "rgba(66, 184, 131, 0.14)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: PICK_OVERLAY_Z,
            pointerEvents: "none",
            padding: "10px 16px",
            borderRadius: 8,
            background: theme.bgRaised,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            fontFamily: theme.fontSans,
            fontSize: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            maxWidth: "min(480px, 92vw)",
            textAlign: "center",
          }}
        >
          Наведи курсор на элемент и кликни.{" "}
          <strong style={{ color: theme.accent }}>Esc</strong> — отмена.
        </div>
      </>,
      document.body,
    );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "auto",
        padding: 16,
      }}
    >
      {overlay}
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 14,
          fontWeight: 600,
          color: theme.text,
        }}
      >
        Инспектор React UI
      </h2>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: theme.textMuted }}>
        Читает внутренний fiber с DOM-узла (<code>__reactFiber$…</code>). Путь к файлу
        в dev виден путь из React (_debugSource или _debugStack в React 19); в production часто отсутствует.
      </p>
      <button
        type="button"
        onClick={startPicking}
        disabled={picking}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          borderRadius: 6,
          border: `1px solid ${theme.accent}`,
          background: picking ? theme.bgHover : theme.accentMuted,
          color: theme.accent,
          cursor: picking ? "wait" : "pointer",
          fontFamily: theme.fontSans,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {picking ? "Выбор…" : "Выбрать элемент на странице"}
      </button>

      {noFiberOnLastPick && !result ? (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: theme.bgHover,
            fontSize: 11,
            color: theme.textMuted,
          }}
        >
          На выбранном DOM-узле нет ключа <code>__reactFiber$…</code> — это не дерево
          React или узел без привязки fiber (например, чистый HTML).
        </div>
      ) : null}
      {result ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${theme.borderSubtle}`,
            background: theme.bgRaised,
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: theme.textMuted }}>DOM: </span>
            <code style={{ color: theme.typeLabel, fontFamily: theme.fontMono }}>
              &lt;{result.hostTag}&gt;
            </code>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: theme.textMuted }}>Компонент: </span>
            <strong style={{ color: theme.value }}>{result.componentName}</strong>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: theme.textMuted,
                marginBottom: 4,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Родители (к корню)
            </div>
            {result.parentChain.length === 0 ? (
              <span style={{ color: theme.textMuted }}>—</span>
            ) : (
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  color: theme.text,
                  fontFamily: theme.fontMono,
                  fontSize: 11,
                }}
              >
                {result.parentChain.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
              </ol>
            )}
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                color: theme.textMuted,
                marginBottom: 4,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Файл
            </div>
            {result.source?.fileName ? (
              <code
                style={{
                  display: "block",
                  wordBreak: "break-all",
                  fontFamily: theme.fontMono,
                  fontSize: 10,
                  color: theme.accent,
                }}
              >
                {result.source.fileName}
                {result.source.lineNumber != null
                  ? `:${result.source.lineNumber}`
                  : ""}
                {result.source.columnNumber != null
                  ? `:${result.source.columnNumber}`
                  : ""}
              </code>
            ) : (
              <span style={{ color: theme.textMuted }}>
                Нет (нет отладочных данных React для этого узла)
              </span>
            )}
          </div>
          <div>
            <div
              style={{
                color: theme.textMuted,
                marginBottom: 4,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Props (превью)
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${theme.border}`,
                background: theme.bg,
                color: theme.value,
                fontFamily: theme.fontMono,
                fontSize: 10,
                lineHeight: 1.45,
                overflow: "auto",
                maxHeight: 280,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {result.propsPreview
                ? JSON.stringify(result.propsPreview, replacerSafe, 2)
                : "—"}
            </pre>
          </div>
          {fiberDebug ? (
            <details style={{ marginTop: 12 }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: theme.textMuted,
                  fontSize: 11,
                }}
              >
                Сырой fiber-стек (отладка)
              </summary>
              <pre
                style={{
                  margin: "8px 0 0",
                  fontSize: 9,
                  color: theme.textMuted,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: theme.fontMono,
                }}
              >
                {fiberDebug}
              </pre>
            </details>
          ) : null}
        </div>
      ) : !noFiberOnLastPick ? (
        <p style={{ marginTop: 14, fontSize: 11, color: theme.textMuted }}>
          Нажми «Выбрать элемент на странице», затем кликни по нужному узлу в приложении.
        </p>
      ) : null}
    </div>
  );
}

function OverviewPane({
  eventCount,
  maxEvents,
}: {
  eventCount: number;
  maxEvents: number;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        overflow: "auto",
      }}
    >
      <h2
        style={{
          margin: "0 0 12px",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Обзор
      </h2>
      <p style={{ margin: "0 0 8px", color: theme.textMuted, fontSize: 12 }}>
        <strong>Сторы</strong> — реестр observable из spy, правка полей; режим{" "}
        <strong>«Карта связей»</strong> — граф сторов (@xyflow/react + dagre).
        Таймлайн: <code style={{ fontFamily: theme.fontMono }}>spy</code>, фильтры,{" "}
        <strong>Explain</strong>, JSON. «Граф» — деревья по{" "}
        <code style={{ fontFamily: theme.fontMono }}>object</code>.{" "}
        <strong>UI</strong> — выбор элемента на странице, props и цепочка React-компонентов.{" "}
        <strong>Зомби</strong> — поиск observable/computed без наблюдателей по реестру сторов.{" "}
        <strong>Структура</strong> — размер сторов, вложенность, ширина объектов и циклы в графе зависимостей MobX.
      </p>
      <div
        style={{
          fontFamily: theme.fontMono,
          fontSize: 11,
          padding: "10px 12px",
          borderRadius: 6,
          border: `1px solid ${theme.border}`,
          background: theme.bgRaised,
        }}
      >
        <div>
          <span style={{ color: theme.textMuted }}>events : </span>
          <span style={{ color: theme.value }}>{eventCount}</span>
          <span style={{ color: theme.typeLabel }}> / {maxEvents}</span>
        </div>
      </div>
    </div>
  );
}

type GraphSubTab = "deps" | "observers";

function InspectPane({
  selected,
  setTab,
}: {
  selected: DevtoolsEvent | null;
  setTab: (t: TabId) => void;
}) {
  const [sub, setSub] = useState<GraphSubTab>("deps");
  const subject = selected ? getSubjectFromSpyEvent(selected.raw) : null;
  const explained = useMemo(
    () => (subject != null ? explainSubject(subject) : null),
    [subject],
  );

  if (!selected) {
    return (
      <div style={{ flex: 1, padding: 16, color: theme.textMuted }}>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: theme.text }}>
          Нет выбранного события
        </p>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55 }}>
          Откройте вкладку «Таймлайн», выберите строку с{" "}
          <code style={{ fontFamily: theme.fontMono, color: theme.accent }}>
            object
          </code>{" "}
          (например <strong>action</strong>), затем вернитесь сюда или нажмите
          «Граф» в панели деталей.
        </p>
        <button
          type="button"
          onClick={() => setTab("timeline")}
          style={{
            marginTop: 14,
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${theme.accent}`,
            background: theme.accentMuted,
            color: theme.accent,
            cursor: "pointer",
            fontFamily: theme.fontSans,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          К таймлайну
        </button>
      </div>
    );
  }

  if (subject == null) {
    return (
      <div style={{ flex: 1, padding: 16, color: theme.textMuted }}>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: theme.text }}>
          У события нет <code style={{ fontFamily: theme.fontMono }}>object</code>
        </p>
        <p style={{ margin: 0, fontSize: 12 }}>
          Тип «{selected.type}» не несёт observable для деревьев. Выберите
          другое событие (часто подходят действия над store).
        </p>
        <button
          type="button"
          onClick={() => setTab("timeline")}
          style={{
            marginTop: 14,
            padding: "8px 14px",
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: theme.bgRaised,
            color: theme.text,
            cursor: "pointer",
            fontFamily: theme.fontSans,
            fontSize: 12,
          }}
        >
          Таймлайн
        </button>
      </div>
    );
  }

  if (!explained) {
    return (
      <div style={{ flex: 1, padding: 16, color: theme.textMuted }}>
        <p style={{ margin: 0, fontSize: 12 }}>
          Не удалось построить деревья для этого объекта (MobX отклонил запрос).
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${theme.borderSubtle}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: theme.fontMono,
            fontSize: 11,
            color: theme.textMuted,
            marginRight: 4,
          }}
        >
          субъект
        </span>
        <span style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.value }}>
          {selected.name != null ? String(selected.name) : "(без имени)"}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {(
            [
              ["deps", "Зависимости"],
              ["observers", "Наблюдатели"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSub(id)}
              style={{
                padding: "5px 10px",
                borderRadius: 4,
                border: `1px solid ${sub === id ? theme.accent : theme.border}`,
                background: sub === id ? theme.accentMuted : "transparent",
                color: sub === id ? theme.accent : theme.textMuted,
                cursor: "pointer",
                fontFamily: theme.fontSans,
                fontSize: 11,
                fontWeight: sub === id ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px 12px",
          fontFamily: theme.fontMono,
          fontSize: 11,
        }}
      >
        {sub === "deps" ? (
          <DepTree node={explained.dependency} />
        ) : (
          <ObsTree node={explained.observers} />
        )}
      </div>
    </div>
  );
}

function DepTree({ node, depth = 0 }: { node: IDependencyTree; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const kids = node.dependencies;
  const hasKids = kids != null && kids.length > 0;
  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <button
        type="button"
        onClick={() => hasKids && setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          color: theme.text,
          cursor: hasKids ? "pointer" : "default",
          fontFamily: theme.fontMono,
          fontSize: 11,
          padding: "2px 0",
        }}
      >
        <span style={{ color: theme.textMuted, width: 14, flexShrink: 0 }}>
          {hasKids ? (expanded ? "▼" : "▶") : "·"}
        </span>
        <span style={{ color: theme.accent }}>{node.name}</span>
      </button>
      {expanded &&
        kids?.map((ch, i) => (
          <DepTree key={`${depth}-${i}-${ch.name}`} node={ch} depth={depth + 1} />
        ))}
    </div>
  );
}

function ObsTree({ node, depth = 0 }: { node: IObserverTree; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const kids = node.observers;
  const hasKids = kids != null && kids.length > 0;
  return (
    <div style={{ marginLeft: depth > 0 ? 14 : 0 }}>
      <button
        type="button"
        onClick={() => hasKids && setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "transparent",
          color: theme.text,
          cursor: hasKids ? "pointer" : "default",
          fontFamily: theme.fontMono,
          fontSize: 11,
          padding: "2px 0",
        }}
      >
        <span style={{ color: theme.textMuted, width: 14, flexShrink: 0 }}>
          {hasKids ? (expanded ? "▼" : "▶") : "·"}
        </span>
        <span style={{ color: theme.typeLabel }}>{node.name}</span>
      </button>
      {expanded &&
        kids?.map((ch, i) => (
          <ObsTree key={`${depth}-${i}-${ch.name}`} node={ch} depth={depth + 1} />
        ))}
    </div>
  );
}

function SettingsPane({
  eventCount,
  registeredStoreCount,
  bufferLimit,
  onLimitChange,
  onClear,
  onClearStoreRegistry,
}: {
  eventCount: number;
  registeredStoreCount: number;
  bufferLimit: number;
  onLimitChange: (n: number) => void;
  onClear: () => void;
  onClearStoreRegistry: () => void;
}) {
  return (
    <div style={{ flex: 1, padding: 16, color: theme.textMuted }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 14, color: theme.text }}>
        Настройки
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 360,
        }}
      >
        <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <span>Размер кольцевого буфера событий</span>
          <select
            value={bufferLimit}
            onChange={(e) => {
              const n = Number(e.target.value);
              onLimitChange(n);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.bgRaised,
              color: theme.text,
              fontFamily: theme.fontSans,
              fontSize: 12,
            }}
          >
            {[200, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n} событий
              </option>
            ))}
          </select>
        </label>
        <div>
          <button
            type="button"
            onClick={onClear}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.bgRaised,
              color: theme.text,
              cursor: "pointer",
              fontFamily: theme.fontSans,
              fontSize: 12,
            }}
          >
            Очистить таймлайн
          </button>
          <span style={{ marginLeft: 10, fontSize: 11 }}>
            сейчас в буфере: {eventCount}
          </span>
        </div>
        <div>
          <button
            type="button"
            onClick={onClearStoreRegistry}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.bgRaised,
              color: theme.text,
              cursor: "pointer",
              fontFamily: theme.fontSans,
              fontSize: 12,
            }}
          >
            Очистить реестр сторов
          </button>
          <span style={{ marginLeft: 10, fontSize: 11 }}>
            зарегистрировано: {registeredStoreCount}
          </span>
        </div>
      </div>
    </div>
  );
}
