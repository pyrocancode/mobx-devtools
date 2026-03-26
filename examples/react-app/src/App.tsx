import { MobxDevtools } from "@mobx-devtools/ui";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, type CSSProperties } from "react";
import { createDemoStores } from "./demoStores";

const card: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
  background: "#fff",
};

const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  marginTop: 10,
};

const btn: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  cursor: "pointer",
  fontSize: 13,
};

const btnPrimary: CSSProperties = {
  ...btn,
  background: "#0f172a",
  color: "#fff",
  borderColor: "#0f172a",
};

export const App = observer(function App() {
  const demo = useMemo(() => createDemoStores(), []);

  useEffect(() => () => demo.dispose(), [demo]);

  const products = [...demo.catalog.products.entries()];

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>MobX DevTools — демо-сценарии</h1>
      <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.5 }}>
        Открой панель DevTools: таймлайн покажет{" "}
        <strong>actions</strong>, <strong>reactions</strong>, изменения{" "}
        <strong>observable</strong> и <strong>flow</strong> (в т.ч. сетевой{" "}
        <code>fetch</code>). <strong>Computed</strong> пересчитываются при
        загрузке данных с API. На вкладке «Граф» выбери событие с{" "}
        <code>object</code> (часто <strong>action</strong> /{" "}
        <strong>fetchPosts</strong>) — увидишь деревья MobX.
      </p>

      <section style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Метрики</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Простые инкременты и пачка через <code>runInAction</code>.
        </p>
        <div style={row}>
          <span>
            Клики: <strong>{demo.metrics.clicks}</strong>
          </span>
          <span style={{ color: "#94a3b8" }}>|</span>
          <span>
            burst-счётчик: <strong>{demo.metrics.expensiveRuns}</strong>
          </span>
          <span style={{ color: "#94a3b8" }}>|</span>
          <span title="observable.box">
            heat: <strong>{demo.metrics.heat.get()}</strong>
          </span>
          <button type="button" style={btn} onClick={() => demo.metrics.incClicks()}>
            +1 клик
          </button>
          <button type="button" style={btn} onClick={() => demo.metrics.bumpHeat()}>
            box +1
          </button>
          <button type="button" style={btnPrimary} onClick={() => demo.metrics.burst()}>
            runInAction +3
          </button>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Каталог (Map) → Корзина (array)</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Добавление строк, смена количества, computed <code>totalPrice</code>{" "}
          тянет зависимости из <code>catalog.products</code>.
        </p>
        <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13 }}>
          {products.map(([id, p]) => (
            <li key={id} style={{ marginBottom: 6 }}>
              <strong>{p.name}</strong> — {p.price} ₽, остаток {p.stock}
              <button
                type="button"
                style={{ ...btn, marginLeft: 8, padding: "4px 8px", fontSize: 12 }}
                onClick={() => demo.cart.addLine(id)}
              >
                В корзину
              </button>
            </li>
          ))}
        </ul>
        <div style={{ ...row, marginTop: 14 }}>
          <span>
            Позиций: <strong>{demo.cart.lineCount}</strong>
          </span>
          <span>
            Штук: <strong>{demo.cart.itemCount}</strong>
          </span>
          <span>
            Сумма: <strong>{demo.cart.totalPrice} ₽</strong>
          </span>
          <button type="button" style={btn} onClick={() => demo.cart.clear()}>
            Очистить корзину
          </button>
        </div>
        {demo.cart.lines.length > 0 ? (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {demo.cart.lines.map((line) => {
              const p = demo.catalog.products.get(line.productId);
              return (
                <li key={line.productId}>
                  {p?.name ?? line.productId} × {line.qty}
                  <button
                    type="button"
                    style={{ ...btn, marginLeft: 8, padding: "2px 8px", fontSize: 12 }}
                    onClick={() => demo.cart.bumpQty(line.productId, -1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    style={{ ...btn, marginLeft: 4, padding: "2px 8px", fontSize: 12 }}
                    onClick={() => demo.cart.bumpQty(line.productId, 1)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    style={{ ...btn, marginLeft: 4, padding: "2px 8px", fontSize: 12 }}
                    onClick={() => demo.cart.removeLine(line.productId)}
                  >
                    Убрать
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Пользователь (flow + Map prefs)</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Асинхронный <code>login</code> / <code>loadPrefs</code> — в таймлайне
          появятся фазы flow; реакции на корзину тоже живут в фоне.
        </p>
        <div style={row}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            Имя:
            <input
              value={demo.user.name}
              onChange={(e) => demo.user.setName(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
          </label>
          <button
            type="button"
            style={demo.user.loading ? { ...btn, opacity: 0.6 } : btnPrimary}
            disabled={demo.user.loading}
            onClick={() => demo.user.toggleLogin()}
          >
            {demo.user.isLoggedIn ? "Выйти" : demo.user.loading ? "…" : "Войти (flow)"}
          </button>
          <button
            type="button"
            style={btn}
            disabled={demo.user.loading}
            onClick={() => void demo.user.loadPrefs()}
          >
            Синхронизировать prefs (flow)
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
          Статус:{" "}
          {demo.user.isLoggedIn ? (
            <>
              в сети, token <code>{demo.user.token}</code>
            </>
          ) : (
            "не авторизован"
          )}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>
          Probe <code>sync-ui-hint</code>:{" "}
          <strong>{demo.user.uiSyncProbe || "—"}</strong>
        </p>
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <strong>prefs (Map):</strong>{" "}
          {[...demo.user.prefs.entries()]
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}
        </div>
        <div style={row}>
          <button
            type="button"
            style={btn}
            onClick={() =>
              demo.user.setPref(
                "theme",
                demo.user.prefs.get("theme") === "dark" ? "light" : "dark",
              )
            }
          >
            Переключить theme в Map
          </button>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>
          Открытое API → observable → агрегация
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          <a
            href="https://jsonplaceholder.typicode.com/"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#0f172a" }}
          >
            JSONPlaceholder
          </a>{" "}
          (<code>/posts</code>): <code>flow fetchPosts</code> кладёт ответ в{" "}
          <code>observable.array</code>; ниже — чистые{" "}
          <strong>computed</strong> (без ручной денормализации в state).
        </p>
        <div style={row}>
          <button
            type="button"
            style={btnPrimary}
            disabled={demo.openApi.status === "loading"}
            onClick={() => void demo.openApi.fetchPosts(50)}
          >
            {demo.openApi.status === "loading" ? "Загрузка…" : "Загрузить 50 постов"}
          </button>
          <button
            type="button"
            style={btn}
            disabled={demo.openApi.status === "loading"}
            onClick={() => void demo.openApi.fetchPosts(15)}
          >
            15 постов
          </button>
          <button type="button" style={btn} onClick={() => demo.openApi.clearPosts()}>
            Сбросить
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
          Статус: <strong>{demo.openApi.status}</strong>
          {demo.openApi.error ? (
            <>
              {" "}
              — <span style={{ color: "#b91c1c" }}>{demo.openApi.error}</span>
            </>
          ) : null}
          {demo.openApi.fetchedAt ? (
            <>
              {" "}
              · загружено <code>{demo.openApi.fetchedAt}</code>
            </>
          ) : null}
        </p>
        {demo.openApi.postCount > 0 ? (
          <>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div style={{ color: "#64748b" }}>Постов</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {demo.openApi.postCount}
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div style={{ color: "#64748b" }}>Ср. длина title</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {demo.openApi.avgTitleLength}
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div style={{ color: "#64748b" }}>Ср. длина body</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {demo.openApi.avgBodyLength}
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                }}
              >
                <div style={{ color: "#64748b" }}>Топ userId по числу постов</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {demo.openApi.topUserByVolume
                    ? `#${demo.openApi.topUserByVolume.userId} (${demo.openApi.topUserByVolume.count})`
                    : "—"}
                </div>
              </div>
            </div>
            <h3 style={{ margin: "14px 0 6px", fontSize: 13 }}>Распределение по userId</h3>
            <div
              style={{
                maxHeight: 160,
                overflow: "auto",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 8,
              }}
            >
              {[...demo.openApi.postsPerUser.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([uid, n]) => (
                  <div key={uid}>
                    userId {uid}: <strong>{n}</strong> постов
                  </div>
                ))}
            </div>
            <h3 style={{ margin: "14px 0 6px", fontSize: 13 }}>Первые заголовки</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {demo.openApi.posts.slice(0, 6).map((p) => (
                <li key={p.id} style={{ marginBottom: 4 }}>
                  <span style={{ color: "#94a3b8" }}>#{p.id}</span> {p.title}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section style={{ ...card, marginBottom: 0 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Реакции между сторами</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
          Если сумма корзины &gt; 15&nbsp;000 ₽, срабатывает именованная{" "}
          <code>reaction</code> <strong>warn-expensive-cart</strong> и увеличивает
          счётчик в <code>MetricsStore</code> — ищи это в таймлайне.
        </p>
      </section>

      <MobxDevtools initialIsOpen standaloneDevtoolsHref="/devtools.html" />
    </main>
  );
});
