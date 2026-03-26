import {
  getObserverTree,
  isAction,
  isBoxedObservable,
  isComputedProp,
  isFlow,
  isObservableArray,
  isObservableMap,
  isObservableObject,
  isObservableProp,
  isObservableSet,
  keys,
  type IObserverTree,
} from "mobx";
import type { RegisteredStore } from "./storeRegistry";

export type ZombieKind =
  | "observable"
  | "computed"
  | "boxed"
  | "array"
  | "map"
  | "set";

export type ZombieFinding = {
  kind: ZombieKind;
  /** Путь внутри стора, например `lines` или `prefs.theme` */
  path: string;
  label: string;
  storeId: string;
  storeDebugName: string;
};

export type ZombieScanOptions = {
  /** Максимум записей в отчёте */
  maxFindings?: number;
  /** Глубина вложенных observable-объектов */
  maxDepth?: number;
};

export type ZombieScanResult = {
  findings: ZombieFinding[];
  truncated: boolean;
  /** Сторы без живого target (remote) */
  skippedRemoteStores: number;
};

function propKeyString(key: PropertyKey): string {
  return typeof key === "symbol" ? String(key) : String(key);
}

function observerTreeIsEmpty(tree: IObserverTree): boolean {
  return tree.observers == null || tree.observers.length === 0;
}

function buildLabel(storeDebugName: string, segments: string[]): string {
  if (segments.length === 0) return storeDebugName;
  return `${storeDebugName}.${segments.join(".")}`;
}

function appendFinding(
  out: ZombieFinding[],
  max: number,
  kind: ZombieKind,
  storeId: string,
  storeDebugName: string,
  segments: string[],
): boolean {
  if (out.length >= max) return false;
  out.push({
    kind,
    path: segments.join("."),
    label: buildLabel(storeDebugName, segments),
    storeId,
    storeDebugName,
  });
  return true;
}

function scanNode(
  node: unknown,
  storeId: string,
  storeDebugName: string,
  segments: string[],
  depth: number,
  out: ZombieFinding[],
  maxFindings: number,
  maxDepth: number,
): void {
  if (out.length >= maxFindings || depth > maxDepth) return;
  if (node == null || typeof node !== "object") return;

  if (isBoxedObservable(node)) {
    try {
      const tree = getObserverTree(node);
      if (observerTreeIsEmpty(tree)) {
        appendFinding(
          out,
          maxFindings,
          "boxed",
          storeId,
          storeDebugName,
          segments,
        );
      }
    } catch {
      /* не админится как observable-узел */
    }
    return;
  }

  if (isObservableArray(node)) {
    try {
      const tree = getObserverTree(node);
      if (observerTreeIsEmpty(tree)) {
        appendFinding(
          out,
          maxFindings,
          "array",
          storeId,
          storeDebugName,
          segments,
        );
      }
    } catch {
      /* */
    }
    return;
  }

  if (isObservableMap(node)) {
    try {
      const tree = getObserverTree(node);
      if (observerTreeIsEmpty(tree)) {
        appendFinding(out, maxFindings, "map", storeId, storeDebugName, segments);
      }
    } catch {
      /* */
    }
    return;
  }

  if (isObservableSet(node)) {
    try {
      const tree = getObserverTree(node);
      if (observerTreeIsEmpty(tree)) {
        appendFinding(out, maxFindings, "set", storeId, storeDebugName, segments);
      }
    } catch {
      /* */
    }
    return;
  }

  if (!isObservableObject(node)) return;

  let keyList: PropertyKey[];
  try {
    keyList = [...keys(node)];
  } catch {
    return;
  }
  const cap = 256;
  if (keyList.length > cap) keyList = keyList.slice(0, cap);

  for (const key of keyList) {
    if (out.length >= maxFindings) return;
    const pk = propKeyString(key);
    const val = (node as Record<string, unknown>)[pk];

    if (typeof val === "function" && (isAction(val) || isFlow(val))) {
      continue;
    }

    let isComp = false;
    let obsProp = false;
    try {
      isComp = isComputedProp(node, key);
    } catch {
      /* */
    }
    try {
      obsProp = isObservableProp(node, key);
    } catch {
      /* */
    }

    const nextSeg = [...segments, pk];

    if (isComp) {
      try {
        const tree = getObserverTree(node, pk);
        if (observerTreeIsEmpty(tree)) {
          if (
            !appendFinding(
              out,
              maxFindings,
              "computed",
              storeId,
              storeDebugName,
              nextSeg,
            )
          ) {
            return;
          }
        }
      } catch {
        /* */
      }
      continue;
    }

    if (!obsProp && !isComp) {
      if (
        isObservableObject(val) ||
        isObservableArray(val) ||
        isObservableMap(val) ||
        isObservableSet(val) ||
        isBoxedObservable(val)
      ) {
        scanNode(
          val,
          storeId,
          storeDebugName,
          nextSeg,
          depth + 1,
          out,
          maxFindings,
          maxDepth,
        );
      }
      continue;
    }

    if (isObservableObject(val)) {
      scanNode(
        val,
        storeId,
        storeDebugName,
        nextSeg,
        depth + 1,
        out,
        maxFindings,
        maxDepth,
      );
      continue;
    }
    if (
      isObservableArray(val) ||
      isObservableMap(val) ||
      isObservableSet(val) ||
      isBoxedObservable(val)
    ) {
      scanNode(
        val,
        storeId,
        storeDebugName,
        nextSeg,
        depth + 1,
        out,
        maxFindings,
        maxDepth,
      );
      continue;
    }

    try {
      const tree = getObserverTree(node, pk);
      if (observerTreeIsEmpty(tree)) {
        if (
          !appendFinding(
            out,
            maxFindings,
            "observable",
            storeId,
            storeDebugName,
            nextSeg,
          )
        ) {
          return;
        }
      }
    } catch {
      /* не observable-поле по мнению getAtom */
    }
  }
}

/**
 * Ищет observable/computed/box/array/map/set без наблюдателей (реакций, autorun, observer-компонентов и т.д.)
 * среди зарегистрированных сторов. Эвристика: вложенный observable-объект без прямых наблюдателей
 * на ссылке не помечается — сканируются его поля (меньше ложных срабатываний).
 */
export function scanZombieObservables(
  stores: readonly RegisteredStore[],
  options?: ZombieScanOptions,
): ZombieScanResult {
  const maxFindings = Math.max(
    20,
    Math.min(2000, Math.floor(options?.maxFindings ?? 400)),
  );
  const maxDepth = Math.max(
    1,
    Math.min(32, Math.floor(options?.maxDepth ?? 10)),
  );

  const findings: ZombieFinding[] = [];
  let skippedRemoteStores = 0;

  for (const store of stores) {
    if (store.isRemoteSnapshot) {
      skippedRemoteStores++;
      continue;
    }
    if (!isObservableObject(store.target)) continue;
    scanNode(
      store.target,
      store.id,
      store.debugName,
      [],
      0,
      findings,
      maxFindings,
      maxDepth,
    );
    if (findings.length >= maxFindings) break;
  }

  return {
    findings,
    truncated: findings.length >= maxFindings,
    skippedRemoteStores,
  };
}
