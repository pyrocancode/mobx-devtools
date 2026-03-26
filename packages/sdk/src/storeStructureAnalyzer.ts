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

type DepTree = ReturnType<typeof getDependencyTree>;
import type { RegisteredStore } from "./storeRegistry";

export type StructureSeverity = "info" | "warn";

export type StructureIssueKind =
  | "store_too_large"
  | "too_many_top_level_fields"
  | "deep_observable_nesting"
  | "wide_object"
  | "dependency_cycle"
  | "dependency_graph_truncated";

export type StructureIssue = {
  kind: StructureIssueKind;
  severity: StructureSeverity;
  title: string;
  detail: string;
  storeId?: string;
  storeDebugName?: string;
  path?: string;
};

export type StoreStructureSummary = {
  storeId: string;
  storeDebugName: string;
  topLevelReactive: number;
  totalReactiveFields: number;
  maxObservableObjectDepth: number;
  maxReactiveKeysOnOneObject: number;
};

export type StoreStructureAnalyzerOptions = {
  /** Порог числа реактивных полей (observable + computed) на верхнем уровне стора */
  maxTopLevelReactive?: number;
  /** Порог суммарного числа реактивных полей по дереву одного стора */
  maxTotalReactivePerStore?: number;
  /** Максимально допустимая глубина цепочки вложенных observable-объектов (0 = только корень) */
  maxObservableObjectDepth?: number;
  /** Если у одного observable-объекта столько реактивных полей — предупреждение */
  maxReactiveKeysPerObject?: number;
  /** Ограничение обхода (вложенность) */
  maxWalkDepth?: number;
  /** Лимит рёбер графа зависимостей (защита от подвисаний) */
  maxDependencyEdges?: number;
  /** Сколько различных циклов максимум вернуть */
  maxCycles?: number;
};

export type StoreStructureReport = {
  issues: StructureIssue[];
  summaries: StoreStructureSummary[];
  skippedRemoteStores: number;
  dependencyNodeCount: number;
  dependencyEdgeCount: number;
  truncatedDependencies: boolean;
};

function propKeyString(key: PropertyKey): string {
  return typeof key === "symbol" ? String(key) : String(key);
}

/** Прямые рёбра: от атома поля к каждому прямому наблюдаемому узлу (как в MobX observing_). */
function addDirectDependencyEdges(
  tree: DepTree,
  adj: Map<string, Set<string>>,
  counter: { n: number },
  maxEdges: number,
): void {
  const from = tree.name;
  if (!adj.has(from)) adj.set(from, new Set());
  for (const dep of tree.dependencies ?? []) {
    if (counter.n >= maxEdges) return;
    adj.get(from)!.add(dep.name);
    counter.n++;
    if (!adj.has(dep.name)) adj.set(dep.name, new Set());
  }
}

function allGraphNodes(adj: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const [u, vs] of adj) {
    out.add(u);
    for (const v of vs) out.add(v);
  }
  return out;
}

function findDependencyCycles(
  adj: Map<string, Set<string>>,
  maxCycles: number,
): string[][] {
  const cycles: string[][] = [];
  const seenCycle = new Set<string>();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function cycleKey(c: string[]): string {
    if (c.length === 0) return "";
    const m = c.reduce((a, b) => (a < b ? a : b));
    const i = c.indexOf(m);
    const rot = [...c.slice(i), ...c.slice(0, i)];
    return rot.join(" → ");
  }

  function dfs(u: string): void {
    if (cycles.length >= maxCycles) return;
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v) ?? WHITE;
      if (cv === GRAY) {
        const i = stack.indexOf(v);
        if (i !== -1) {
          const cyc = [...stack.slice(i), v];
          const k = cycleKey(cyc);
          if (!seenCycle.has(k)) {
            seenCycle.add(k);
            cycles.push(cyc);
          }
        }
      } else if (cv === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  }

  const nodes = allGraphNodes(adj);
  for (const n of nodes) {
    if ((color.get(n) ?? WHITE) === WHITE) dfs(n);
    if (cycles.length >= maxCycles) break;
  }
  return cycles;
}

type MetricsAcc = {
  topLevelReactive: number;
  totalReactiveFields: number;
  maxObservableObjectDepth: number;
  maxReactiveKeysOnOneObject: number;
};

function walkReactiveMetrics(
  node: unknown,
  segments: string[],
  observableObjectDepth: number,
  maxWalkDepth: number,
  acc: MetricsAcc,
  perObjectWidths: { path: string; width: number }[],
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

  acc.maxObservableObjectDepth = Math.max(
    acc.maxObservableObjectDepth,
    observableObjectDepth,
  );

  let keyList: PropertyKey[];
  try {
    keyList = [...keys(node)];
  } catch {
    return;
  }
  const cap = 256;
  if (keyList.length > cap) keyList = keyList.slice(0, cap);

  let reactiveHere = 0;
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
      /* */
    }
    try {
      obsProp = isObservableProp(node, key);
    } catch {
      /* */
    }

    if (isComp || obsProp) {
      reactiveHere++;
      acc.totalReactiveFields++;
      if (segments.length === 0) acc.topLevelReactive++;
    }

    const nextSeg = [...segments, pk];

    const recurseNested = (
      child: unknown,
      childObsDepth: number,
    ): void => {
      walkReactiveMetrics(
        child,
        nextSeg,
        childObsDepth,
        maxWalkDepth,
        acc,
        perObjectWidths,
      );
    };

    if (!obsProp && !isComp) {
      if (
        isObservableObject(val) ||
        isObservableArray(val) ||
        isObservableMap(val) ||
        isObservableSet(val) ||
        isBoxedObservable(val)
      ) {
        recurseNested(
          val,
          isObservableObject(val) ? observableObjectDepth + 1 : observableObjectDepth,
        );
      }
      continue;
    }

    if (isObservableObject(val)) {
      recurseNested(val, observableObjectDepth + 1);
      continue;
    }
    if (
      isObservableArray(val) ||
      isObservableMap(val) ||
      isObservableSet(val) ||
      isBoxedObservable(val)
    ) {
      recurseNested(val, observableObjectDepth);
    }
  }

  acc.maxReactiveKeysOnOneObject = Math.max(
    acc.maxReactiveKeysOnOneObject,
    reactiveHere,
  );
  if (reactiveHere > 0) {
    perObjectWidths.push({
      path: segments.length === 0 ? "(корень)" : segments.join("."),
      width: reactiveHere,
    });
  }
}

function walkDependencyEdges(
  node: unknown,
  segments: string[],
  observableObjectDepth: number,
  maxWalkDepth: number,
  adj: Map<string, Set<string>>,
  counter: { n: number },
  maxEdges: number,
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
    return;
  }
  if (keyList.length > 256) keyList = keyList.slice(0, 256);

  for (const key of keyList) {
    if (counter.n >= maxEdges) return;
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

    if (isComp || obsProp) {
      try {
        const depTree = getDependencyTree(node, pk);
        addDirectDependencyEdges(depTree, adj, counter, maxEdges);
      } catch {
        /* */
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
        walkDependencyEdges(
          val,
          nextSeg,
          isObservableObject(val) ? observableObjectDepth + 1 : observableObjectDepth,
          maxWalkDepth,
          adj,
          counter,
          maxEdges,
        );
      }
      continue;
    }

    if (isObservableObject(val)) {
      walkDependencyEdges(
        val,
        nextSeg,
        observableObjectDepth + 1,
        maxWalkDepth,
        adj,
        counter,
        maxEdges,
      );
      continue;
    }
    if (
      isObservableArray(val) ||
      isObservableMap(val) ||
      isObservableSet(val) ||
      isBoxedObservable(val)
    ) {
      walkDependencyEdges(
        val,
        nextSeg,
        observableObjectDepth,
        maxWalkDepth,
        adj,
        counter,
        maxEdges,
      );
    }
  }
}

const defaults = {
  maxTopLevelReactive: 18,
  maxTotalReactivePerStore: 55,
  maxObservableObjectDepth: 4,
  maxReactiveKeysPerObject: 22,
  maxWalkDepth: 14,
  maxDependencyEdges: 8000,
  maxCycles: 12,
} as const;

/**
 * Эвристический разбор зарегистрированных сторов: размер, ширина, глубина вложенности
 * observable-объектов, циклы в графе прямых зависимостей MobX (`getDependencyTree`).
 */
export function analyzeStoreStructure(
  stores: readonly RegisteredStore[],
  options?: StoreStructureAnalyzerOptions,
): StoreStructureReport {
  const opt = {
    maxTopLevelReactive:
      options?.maxTopLevelReactive ?? defaults.maxTopLevelReactive,
    maxTotalReactivePerStore:
      options?.maxTotalReactivePerStore ?? defaults.maxTotalReactivePerStore,
    maxObservableObjectDepth:
      options?.maxObservableObjectDepth ?? defaults.maxObservableObjectDepth,
    maxReactiveKeysPerObject:
      options?.maxReactiveKeysPerObject ?? defaults.maxReactiveKeysPerObject,
    maxWalkDepth: options?.maxWalkDepth ?? defaults.maxWalkDepth,
    maxDependencyEdges:
      options?.maxDependencyEdges ?? defaults.maxDependencyEdges,
    maxCycles: options?.maxCycles ?? defaults.maxCycles,
  };

  const issues: StructureIssue[] = [];
  const summaries: StoreStructureSummary[] = [];
  let skippedRemoteStores = 0;
  const adj = new Map<string, Set<string>>();
  const edgeCounter = { n: 0 };

  for (const store of stores) {
    if (store.isRemoteSnapshot) {
      skippedRemoteStores++;
      continue;
    }
    if (!isObservableObject(store.target)) continue;

    const acc: MetricsAcc = {
      topLevelReactive: 0,
      totalReactiveFields: 0,
      maxObservableObjectDepth: 0,
      maxReactiveKeysOnOneObject: 0,
    };
    const perObjectWidths: { path: string; width: number }[] = [];

    walkReactiveMetrics(
      store.target,
      [],
      0,
      opt.maxWalkDepth,
      acc,
      perObjectWidths,
    );

    summaries.push({
      storeId: store.id,
      storeDebugName: store.debugName,
      topLevelReactive: acc.topLevelReactive,
      totalReactiveFields: acc.totalReactiveFields,
      maxObservableObjectDepth: acc.maxObservableObjectDepth,
      maxReactiveKeysOnOneObject: acc.maxReactiveKeysOnOneObject,
    });

    if (acc.topLevelReactive > opt.maxTopLevelReactive) {
      issues.push({
        kind: "too_many_top_level_fields",
        severity: "warn",
        title: "Много реактивных полей на верхнем уровне",
        detail: `${acc.topLevelReactive} observable/computed у корня (порог ${opt.maxTopLevelReactive}). Рассмотрите разбиение стора.`,
        storeId: store.id,
        storeDebugName: store.debugName,
      });
    }

    if (acc.totalReactiveFields > opt.maxTotalReactivePerStore) {
      issues.push({
        kind: "store_too_large",
        severity: "warn",
        title: "Стор перегружен по числу реактивных полей",
        detail: `Всего ${acc.totalReactiveFields} реактивных полей в дереве (порог ${opt.maxTotalReactivePerStore}).`,
        storeId: store.id,
        storeDebugName: store.debugName,
      });
    }

    if (acc.maxObservableObjectDepth > opt.maxObservableObjectDepth) {
      issues.push({
        kind: "deep_observable_nesting",
        severity: "warn",
        title: "Глубокая вложенность observable-объектов",
        detail: `Глубина цепочки вложенных observable-объектов: ${acc.maxObservableObjectDepth} (порог ${opt.maxObservableObjectDepth}). Упростите модель или вынесите уровни.`,
        storeId: store.id,
        storeDebugName: store.debugName,
      });
    }

    if (acc.maxReactiveKeysOnOneObject > opt.maxReactiveKeysPerObject) {
      const atMax = perObjectWidths.filter(
        (w) => w.width === acc.maxReactiveKeysOnOneObject,
      );
      const worst = atMax.sort((a, b) =>
        a.path.localeCompare(b.path, "ru"),
      )[0] ?? {
        path: "(корень)",
        width: acc.maxReactiveKeysOnOneObject,
      };
      issues.push({
        kind: "wide_object",
        severity: "info",
        title: "Очень широкий observable-объект",
        detail: `До ${acc.maxReactiveKeysOnOneObject} реактивных полей на одном объекте (порог ${opt.maxReactiveKeysPerObject})${worst.path !== "(корень)" ? `, например «${worst.path}»` : ""}.`,
        storeId: store.id,
        storeDebugName: store.debugName,
        path: worst.path === "(корень)" ? undefined : worst.path,
      });
    }

    walkDependencyEdges(
      store.target,
      [],
      0,
      opt.maxWalkDepth,
      adj,
      edgeCounter,
      opt.maxDependencyEdges,
    );
  }

  const truncatedDependencies = edgeCounter.n >= opt.maxDependencyEdges;
  const cycles = findDependencyCycles(adj, opt.maxCycles);
  for (const cyc of cycles) {
    issues.push({
      kind: "dependency_cycle",
      severity: "warn",
      title: "Циклические зависимости (MobX)",
      detail: cyc.join(" → "),
    });
  }

  if (truncatedDependencies) {
    issues.push({
      kind: "dependency_graph_truncated",
      severity: "info",
      title: "Граф зависимостей обрезан",
      detail: `Достигнут лимит рёбер (${opt.maxDependencyEdges}); циклы и метрики могут быть неполными.`,
    });
  }

  issues.sort((a, b) => {
    const o = (s: StructureSeverity) =>
      s === "warn" ? 0 : 1;
    const d = o(a.severity) - o(b.severity);
    if (d !== 0) return d;
    return a.title.localeCompare(b.title, "ru");
  });

  return {
    issues,
    summaries,
    skippedRemoteStores,
    dependencyNodeCount: allGraphNodes(adj).size,
    dependencyEdgeCount: edgeCounter.n,
    truncatedDependencies,
  };
}
