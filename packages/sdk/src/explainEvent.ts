import { getDebugName, isObservableObject, spy } from "mobx";

type SpyEv = Parameters<Parameters<typeof spy>[0]>[0];

/** Совместимо с DevtoolsEvent из основного модуля. */
export type ExplainInputEvent = {
  id: string;
  type: string;
  timestamp: number;
  name?: string;
  raw: SpyEv;
};

export type ExplainLine = { label: string; text: string };

export type EventExplain = {
  title: string;
  lines: ExplainLine[];
};

function safeDebugName(thing: unknown): string | undefined {
  if (thing == null || typeof thing !== "object") return undefined;
  try {
    return getDebugName(thing);
  } catch {
    return undefined;
  }
}

function previewValue(v: unknown, max = 80): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string")
    return v.length > max ? `${v.slice(0, max)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function findLastActionBefore(
  chronological: readonly ExplainInputEvent[],
  beforeId: string,
): ExplainInputEvent | null {
  const idx = chronological.findIndex((e) => e.id === beforeId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    if (chronological[i].raw.type === "action") return chronological[i];
  }
  return null;
}

function findLastReactionBefore(
  chronological: readonly ExplainInputEvent[],
  beforeId: string,
): ExplainInputEvent | null {
  const idx = chronological.findIndex((e) => e.id === beforeId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const t = chronological[i].raw.type;
    if (t === "reaction" || t === "scheduled-reaction")
      return chronological[i];
  }
  return null;
}

function linesForRaw(raw: SpyEv): ExplainLine[] {
  const out: ExplainLine[] = [];

  if (raw.type === "action") {
    out.push({
      label: "Событие",
      text: `action «${raw.name}»`,
    });
    const host = safeDebugName(raw.object);
    if (host) out.push({ label: "Объект (store / host)", text: host });
    if (raw.arguments?.length) {
      out.push({
        label: "Аргументы",
        text: raw.arguments.map((a) => previewValue(a, 120)).join(", "),
      });
    }
    return out;
  }

  if (raw.type === "scheduled-reaction" || raw.type === "reaction") {
    out.push({
      label: "Событие",
      text: `${raw.type} «${raw.name}»`,
    });
    return out;
  }

  if (raw.type === "error") {
    out.push({ label: "Ошибка", text: raw.message });
    if (raw.error) out.push({ label: "Код / деталь", text: String(raw.error) });
    return out;
  }

  if (raw.type === "report-end" && raw.spyReportEnd) {
    out.push({ label: "Фаза", text: "конец отчёта spy (report-end)" });
    if (raw.time != null)
      out.push({
        label: "Длительность (ms)",
        text: String(raw.time),
      });
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "object") {
    out.push({
      label: "Объект",
      text: raw.debugObjectName,
    });
    out.push({
      label: "Поле",
      text: String(raw.name),
    });
    out.push({ label: "Изменение", text: raw.type });
    if (raw.type === "update" || raw.type === "add") {
      out.push({
        label: "Новое значение",
        text: previewValue(raw.newValue, 200),
      });
    }
    if (raw.type === "update" || raw.type === "remove") {
      out.push({
        label: "Старое значение",
        text: previewValue(raw.oldValue, 200),
      });
    }
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "array") {
    out.push({ label: "Массив", text: raw.debugObjectName });
    out.push({ label: "Индекс", text: String(raw.index) });
    if (raw.type === "update") {
      out.push({
        label: "Ячейка",
        text: `${previewValue(raw.oldValue)} → ${previewValue(raw.newValue)}`,
      });
    } else if (raw.type === "splice") {
      out.push({
        label: "splice",
        text: `−${raw.removedCount} +${raw.addedCount}`,
      });
    }
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "map") {
    out.push({ label: "Map", text: raw.debugObjectName });
    out.push({ label: "Ключ", text: previewValue(raw.name, 40) });
    out.push({ label: "Операция", text: raw.type });
    if (raw.type === "add" || raw.type === "update") {
      out.push({ label: "Значение", text: previewValue(raw.newValue, 120) });
    }
    if (raw.type === "update" || raw.type === "delete") {
      out.push({ label: "Было", text: previewValue(raw.oldValue, 120) });
    }
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "set") {
    out.push({ label: "Set", text: raw.debugObjectName });
    out.push({ label: "Операция", text: raw.type });
    if (raw.type === "add")
      out.push({ label: "Элемент", text: previewValue(raw.newValue, 120) });
    if (raw.type === "delete")
      out.push({ label: "Удалён", text: previewValue(raw.oldValue, 120) });
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "computed") {
    out.push({
      label: "Computed",
      text: raw.debugObjectName,
    });
    out.push({
      label: "Значение",
      text: `${previewValue(raw.oldValue)} → ${previewValue(raw.newValue)}`,
    });
    return out;
  }

  if ("observableKind" in raw && raw.observableKind === "value") {
    out.push({
      label: raw.type === "create" ? "Box (create)" : "Box / value",
      text: raw.debugObjectName,
    });
    if (raw.type === "update") {
      out.push({
        label: "Значение",
        text: `${previewValue(raw.oldValue)} → ${previewValue(raw.newValue)}`,
      });
    } else {
      out.push({
        label: "Начальное",
        text: previewValue(raw.newValue, 120),
      });
    }
    return out;
  }

  out.push({ label: "Тип", text: raw.type });
  return out;
}

/**
 * Человекочитаемое объяснение spy-события и ближайший контекст из истории.
 *
 * @param chronological — как `getRecentEvents()` (старые → новые).
 */
export function explainMobxEvent(
  evt: ExplainInputEvent,
  chronological: readonly ExplainInputEvent[],
): EventExplain {
  const raw = evt.raw;
  const lines = linesForRaw(raw);

  const lastAction = findLastActionBefore(chronological, evt.id);
  if (lastAction && lastAction.id !== evt.id) {
    const an = lastAction.name ?? lastAction.raw.type;
    lines.push({
      label: "Контекст",
      text: `последний action до этого: «${an}» @ t≈${lastAction.timestamp.toFixed(1)}ms`,
    });
  }

  if (
    raw.type !== "action" &&
    raw.type !== "reaction" &&
    raw.type !== "scheduled-reaction"
  ) {
    const lastRx = findLastReactionBefore(chronological, evt.id);
    if (lastRx) {
      lines.push({
        label: "Реакция ранее",
        text: `«${lastRx.name ?? lastRx.raw.type}» (возможная связь в цепочке обновлений)`,
      });
    }
  }

  if ("object" in raw && raw.object != null && isObservableObject(raw.object)) {
    lines.push({
      label: "Подсказка",
      text: "Вкладка «Граф» — деревья зависимостей / наблюдателей по этому объекту.",
    });
  }

  let title = `${raw.type}`;
  if ("name" in raw && raw.name != null) title += ` · ${String(raw.name)}`;

  return { title, lines };
}
