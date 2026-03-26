/**
 * Чтение внутреннего дерева React через ключи на DOM-узлах (__reactFiber$…).
 * Dev: React 18 кладёт координаты в fiber._debugSource; в React 19 client их убрали —
 * вместо этого на fiber есть _debugStack (Error), стек парсится как у formatOwnerStack в react-dom.
 */

/** Теги из react-reconciler (стабильные в React 18/19). */
const HostComponent = 5;
const HostText = 6;
const FunctionComponent = 0;
const ClassComponent = 1;
const IndeterminateComponent = 2;
const ForwardRef = 11;
const MemoComponent = 14;
const SimpleMemoComponent = 15;

export type ReactDomInspectSource = {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
};

export type ReactDomInspectResult = {
  /** HTML-тег кликнутого узла */
  hostTag: string;
  /** Имя компонента, чьи props относятся к выбранному узлу */
  componentName: string;
  /** memoizedProps выбранного компонента (вложенные React-элементы усечены) */
  propsPreview: Record<string, unknown> | null;
  /** Цепочка композитных компонентов от ближайшего родителя к корню */
  parentChain: string[];
  /** Место в исходниках, если React его положил */
  source: ReactDomInspectSource | null;
};

type Fiber = {
  tag: number;
  type: unknown;
  return: Fiber | null;
  memoizedProps: unknown;
  stateNode: unknown;
  /** React ≤18 */
  _debugSource?: ReactDomInspectSource;
  /** React 19+ dev: Error со стеком jsxDEV (react-stack-top-frame) */
  _debugStack?: Error | null;
};

function isCompositeFiber(f: Fiber): boolean {
  const t = f.tag;
  return (
    t === FunctionComponent ||
    t === ClassComponent ||
    t === IndeterminateComponent ||
    t === ForwardRef ||
    t === MemoComponent ||
    t === SimpleMemoComponent
  );
}

function getFiberKey(node: Element): string | undefined {
  return Object.keys(node).find(
    (k) =>
      k.startsWith("__reactFiber$") ||
      k.startsWith("__reactInternalInstance$"),
  );
}

export function hasReactFiberOnNode(node: Element | null): boolean {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  return getFiberKey(node) !== undefined;
}

function getFiber(node: Element): Fiber | null {
  const k = getFiberKey(node);
  if (!k) return null;
  return (node as unknown as Record<string, Fiber>)[k] ?? null;
}

function getTypeName(type: unknown): string {
  if (type == null) return "null";
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || "Anonymous";
  }
  if (typeof type === "object") {
    const t = type as { displayName?: string; render?: unknown };
    if (typeof t.render === "function") {
      const r = t.render as { displayName?: string; name?: string };
      return t.displayName || r.displayName || r.name || "ForwardRef";
    }
    return t.displayName || "Unknown";
  }
  return String(type);
}

function getFiberLabel(f: Fiber): string {
  return `${getTypeName(f.type)} (#${f.tag})`;
}

function sanitizePropsForPreview(props: unknown): Record<string, unknown> | null {
  if (props == null || typeof props !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props as Record<string, unknown>)) {
    if (key === "children") {
      if (val == null) out[key] = val;
      else if (Array.isArray(val)) {
        out[key] = `[children ×${val.length}]`;
      } else if (
        typeof val === "object" &&
        val !== null &&
        "$$typeof" in (val as object)
      ) {
        out[key] = "[React child]";
      } else {
        out[key] = val;
      }
      continue;
    }
    if (typeof val === "function") {
      out[key] = `[Function ${(val as Function).name || "anonymous"}]`;
      continue;
    }
    if (val != null && typeof val === "object" && "$$typeof" in (val as object)) {
      const el = val as { type?: unknown };
      out[key] = `[ReactElement ${getTypeName(el.type)}]`;
      continue;
    }
    try {
      JSON.stringify(val);
      out[key] = val as unknown;
    } catch {
      out[key] = `[${Object.prototype.toString.call(val)}]`;
    }
  }
  return out;
}

function isInternalStackPath(fileName: string): boolean {
  const s = fileName.toLowerCase();
  return (
    s.includes("node_modules") ||
    s.includes("react-dom") ||
    s.includes("react/jsx") ||
    s.includes("react-jsx") ||
    s.includes("react.development") ||
    s.includes("react-jsx-dev-runtime") ||
    s.includes("chrome-extension://") ||
    s.includes("webpack-internal")
  );
}

/**
 * Та же нормализация стека, что в react-dom formatOwnerStack (без форматирования в строку для UI).
 */
function sliceReactDebugStackString(stack: string): string {
  if (stack.startsWith("Error: react-stack-top-frame\n")) {
    stack = stack.slice(29);
  }
  const firstNl = stack.indexOf("\n");
  if (firstNl !== -1) stack = stack.slice(firstNl + 1);
  const bottom = stack.indexOf("react_stack_bottom_frame");
  if (bottom !== -1) {
    const cut = stack.lastIndexOf("\n", bottom);
    if (cut !== -1) stack = stack.slice(0, cut);
  }
  return stack;
}

function parseStackLineToSource(line: string): ReactDomInspectSource | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const endRe = /:(\d+):(\d+)(\))?$/;
  const endMatch = trimmed.match(endRe);
  if (!endMatch) return null;
  const lineNumber = Number(endMatch[1]);
  const columnNumber = Number(endMatch[2]);
  const endsWithParen = endMatch[3] === ")";
  let pathPart = trimmed.slice(0, trimmed.length - endMatch[0].length);
  if (endsWithParen) {
    const open = pathPart.lastIndexOf("(");
    if (open !== -1) pathPart = pathPart.slice(open + 1);
  } else {
    const atWord = pathPart.match(/^at\s+(.+)$/);
    if (atWord) pathPart = atWord[1].trim();
  }
  pathPart = pathPart.trim();
  if (
    pathPart.includes("@") &&
    (pathPart.includes("http://") || pathPart.includes("https://"))
  ) {
    pathPart = pathPart.slice(pathPart.lastIndexOf("@") + 1);
  }
  if (!pathPart || isInternalStackPath(pathPart)) return null;
  return { fileName: pathPart, lineNumber, columnNumber };
}

function extractSourceFromReactDebugStack(
  debugStack: unknown,
): ReactDomInspectSource | null {
  if (debugStack == null || typeof debugStack !== "object") return null;
  const err = debugStack as Error;
  const EC = Error as typeof Error & {
    prepareStackTrace?: (err: Error, trace: unknown) => unknown;
  };
  const prev = EC.prepareStackTrace;
  EC.prepareStackTrace = undefined;
  const stackStr = typeof err.stack === "string" ? err.stack : "";
  EC.prepareStackTrace = prev;
  if (!stackStr) return null;
  let stack = sliceReactDebugStackString(stackStr);
  for (const line of stack.split("\n")) {
    const src = parseStackLineToSource(line);
    if (src) return src;
  }
  return null;
}

function resolveInspectSource(
  hostFiber: Fiber,
  propFiber: Fiber | null,
): ReactDomInspectSource | null {
  const order: Fiber[] = [];
  if (hostFiber.tag === HostComponent || hostFiber.tag === HostText) {
    order.push(hostFiber);
  }
  if (propFiber) {
    order.push(propFiber);
    let p: Fiber | null = propFiber.return;
    while (p) {
      order.push(p);
      p = p.return;
    }
  } else {
    let p: Fiber | null = hostFiber.return;
    while (p) {
      order.push(p);
      p = p.return;
    }
  }
  const seen = new Set<Fiber>();
  for (const f of order) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (f._debugSource?.fileName) return f._debugSource;
    const fromStack = extractSourceFromReactDebugStack(f._debugStack);
    if (fromStack) return fromStack;
  }
  return null;
}

/**
 * Собрать информацию о React-компоненте для DOM-элемента.
 */
export function inspectReactDomElement(el: Element): ReactDomInspectResult | null {
  const fiber = getFiber(el);
  if (!fiber) return null;

  const hostTag = el.tagName.toLowerCase();

  let propFiber: Fiber | null = null;
  if (fiber.tag === HostComponent || fiber.tag === HostText) {
    let p: Fiber | null = fiber.return;
    while (p && !isCompositeFiber(p)) p = p.return;
    propFiber = p;
  } else if (isCompositeFiber(fiber)) {
    propFiber = fiber;
  } else {
    let p: Fiber | null = fiber;
    while (p && !isCompositeFiber(p)) p = p.return;
    propFiber = p;
  }

  if (!propFiber) {
    return {
      hostTag,
      componentName: hostTag,
      propsPreview: sanitizePropsForPreview(
        fiber.tag === HostComponent ? fiber.memoizedProps : null,
      ),
      parentChain: [],
      source: resolveInspectSource(fiber, null),
    };
  }

  const componentName = getTypeName(propFiber.type);
  const propsPreview = sanitizePropsForPreview(propFiber.memoizedProps);

  const parentChain: string[] = [];
  let p: Fiber | null = propFiber.return;
  while (p) {
    if (isCompositeFiber(p)) parentChain.push(getTypeName(p.type));
    p = p.return;
  }

  return {
    hostTag,
    componentName,
    propsPreview,
    parentChain,
    source: resolveInspectSource(fiber, propFiber),
  };
}

export function formatFiberChainForDebug(el: Element): string {
  const fiber = getFiber(el);
  if (!fiber) return "";
  const parts: string[] = [];
  let f: Fiber | null = fiber;
  let depth = 0;
  while (f && depth < 40) {
    parts.push(getFiberLabel(f));
    f = f.return;
    depth++;
  }
  return parts.join(" ← ");
}
