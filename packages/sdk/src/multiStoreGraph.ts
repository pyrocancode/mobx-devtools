import {
  getDependencyTree,
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
} from "mobx";
import type { RegisteredStore } from "./storeRegistry";

export type MultiStoreGraphNode = {
  id: string;
  label: string;
};

export type MultiStoreGraphEdge = {
  source: string;
  target: string;
  /** Поля стора-source, в чьём дереве зависимостей встретился target */
  viaFields: string[];
};

export type MultiStoreGraphOptions = {
  maxWalkDepth?: number;
  /** Лимит имён атомов на одно поле (защита от гигантских деревьев) */
  maxNamesPerField?: number;
};

export type MultiStoreGraphResult = {
  nodes: MultiStoreGraphNode[];
  edges: MultiStoreGraphEdge[];
  /** Не удалось разобрать часть полей */
  truncated: boolean;
};

function propKeyString(key: PropertyKey): string {
  return typeof key === "symbol" ? String(key) : String(key);
}

type DepTree = ReturnType<typeof getDependencyTree>;

function collectDepNames(
  tree: DepTree,
  out: Set<string>,
  budget: { n: number },
  maxNames: number,
): void {
  if (budget.n >= maxNames) return;
  out.add(tree.name);
  budget.n++;
  for (const d of tree.dependencies ?? []) {
    collectDepNames(d, out, budget, maxNames);
  }
}

function otherStoreMentioned(
  names: Set<string>,
  candidate: RegisteredStore,
): boolean {
  if (!candidate.debugName) return false;
  for (const n of names) {
    if (n.includes(candidate.debugName)) return true;
  }
  return false;
}

function walkAndCollectEdges(
  node: unknown,
  segments: string[],
  observableObjectDepth: number,
  maxWalkDepth: number,
  fromStore: RegisteredStore,
  allStores: readonly RegisteredStore[],
  edgeMap: Map<string, MultiStoreGraphEdge>,
  maxNamesPerField: number,
  truncated: { v: boolean },
): void {
  if (observableObjectDepth > maxWalkDepth) return;
  if (node == null || typeof node !== "object") return;

  if (
    isBoxedObservable(node) ||
    isObservableArray(node) ||
    isObservableMap(node) ||
    isObservableSet(node)
  ) {
    return;
  }
  if (!isObservableObject(node)) return;

  let keyList: PropertyKey[];
  try {
    keyList = [...keys(node)];
  } catch {
    truncated.v = true;
    return;
  }
  if (keyList.length > 256) {
    keyList = keyList.slice(0, 256);
    truncated.v = true;
  }

  for (const key of keyList) {
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
      truncated.v = true;
    }
    try {
      obsProp = isObservableProp(node, key);
    } catch {
      truncated.v = true;
    }

    const fieldPath = [...segments, pk].join(".");

    if (isComp || obsProp) {
      try {
        const depTree = getDependencyTree(node, pk);
        const names = new Set<string>();
        const budget = { n: 0 };
        collectDepNames(depTree, names, budget, maxNamesPerField);
        if (budget.n >= maxNamesPerField) truncated.v = true;

        for (const toStore of allStores) {
          if (toStore.id === fromStore.id) continue;
          if (toStore.isRemoteSnapshot) continue;
          if (!otherStoreMentioned(names, toStore)) {
            continue;
          }
          const ek = `${fromStore.id}→${toStore.id}`;
          const existing = edgeMap.get(ek);
          if (existing) {
            if (
              existing.viaFields.length < 12 &&
              !existing.viaFields.includes(fieldPath)
            ) {
              existing.viaFields.push(fieldPath);
            }
          } else {
            edgeMap.set(ek, {
              source: fromStore.id,
              target: toStore.id,
              viaFields: [fieldPath],
            });
          }
        }
      } catch {
        truncated.v = true;
      }
    }

    const nextSeg = [...segments, pk];

    if (!obsProp && !isComp) {
      if (
        isObservableObject(val) ||
        isObservableArray(val) ||
        isObservableMap(val) ||
        isObservableSet(val) ||
        isBoxedObservable(val)
      ) {
        walkAndCollectEdges(
          val,
          nextSeg,
          isObservableObject(val) ? observableObjectDepth + 1 : observableObjectDepth,
          maxWalkDepth,
          fromStore,
          allStores,
          edgeMap,
          maxNamesPerField,
          truncated,
        );
      }
      continue;
    }

    if (isObservableObject(val)) {
      walkAndCollectEdges(
        val,
        nextSeg,
        observableObjectDepth + 1,
        maxWalkDepth,
        fromStore,
        allStores,
        edgeMap,
        maxNamesPerField,
        truncated,
      );
      continue;
    }
    if (
      isObservableArray(val) ||
      isObservableMap(val) ||
      isObservableSet(val) ||
      isBoxedObservable(val)
    ) {
      walkAndCollectEdges(
        val,
        nextSeg,
        observableObjectDepth,
        maxWalkDepth,
        fromStore,
        allStores,
        edgeMap,
        maxNamesPerField,
        truncated,
      );
    }
  }
}

/**
 * Узлы — все сторы из реестра; рёбра A → B, если в дереве зависимостей какого-либо
 * поля стора A встречается имя атома, содержащее `debugName` стора B (эвристика MobX).
 */
export function buildMultiStoreLinkGraph(
  stores: readonly RegisteredStore[],
  options?: MultiStoreGraphOptions,
): MultiStoreGraphResult {
  const maxWalkDepth = Math.max(
    1,
    Math.min(24, Math.floor(options?.maxWalkDepth ?? 14)),
  );
  const maxNamesPerField = Math.max(
    50,
    Math.min(20_000, Math.floor(options?.maxNamesPerField ?? 4000)),
  );

  const nodes: MultiStoreGraphNode[] = stores.map((s) => ({
    id: s.id,
    label: s.debugName,
  }));

  const edgeMap = new Map<string, MultiStoreGraphEdge>();
  const truncated = { v: false };

  const embedded = stores.filter((s) => !s.isRemoteSnapshot);

  for (const from of embedded) {
    if (!isObservableObject(from.target)) continue;
    walkAndCollectEdges(
      from.target,
      [],
      0,
      maxWalkDepth,
      from,
      embedded,
      edgeMap,
      maxNamesPerField,
      truncated,
    );
  }

  return {
    nodes,
    edges: [...edgeMap.values()],
    truncated: truncated.v,
  };
}
