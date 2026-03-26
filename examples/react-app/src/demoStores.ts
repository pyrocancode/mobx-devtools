import {
  flow,
  makeAutoObservable,
  observable,
  reaction,
  runInAction,
} from "mobx";

/** Каталог: observable.map + сиды */
export class CatalogStore {
  products = observable.map<
    string,
    { name: string; price: number; stock: number }
  >();

  constructor() {
    makeAutoObservable(this);
  }

  seed() {
    runInAction(() => {
      this.products.set(
        "p1",
        observable({ name: "Клавиатура", price: 4500, stock: 12 }),
      );
      this.products.set("p2", observable({ name: "Мышь", price: 1200, stock: 40 }));
      this.products.set(
        "p3",
        observable({ name: "Монитор", price: 18900, stock: 5 }),
      );
      this.products.set("p4", observable({ name: "Коврик", price: 350, stock: 100 }));
    });
  }

  restock(id: string, n: number) {
    const p = this.products.get(id);
    if (p) p.stock += n;
  }
}

/** Корзина: observable.array, computed, действия с разными объектами */
export class CartStore {
  lines = observable.array<{ productId: string; qty: number }>([]);

  constructor(
    private catalog: CatalogStore,
  ) {
    makeAutoObservable(this);
  }

  get lineCount() {
    return this.lines.length;
  }

  get itemCount() {
    return this.lines.reduce((s, l) => s + l.qty, 0);
  }

  get totalPrice() {
    let sum = 0;
    for (const line of this.lines) {
      const p = this.catalog.products.get(line.productId);
      if (p) sum += p.price * line.qty;
    }
    return sum;
  }

  get isEmpty() {
    return this.lines.length === 0;
  }

  addLine(productId: string) {
    const p = this.catalog.products.get(productId);
    if (!p || p.stock <= 0) return;
    const existing = this.lines.find((l) => l.productId === productId);
    if (existing) {
      existing.qty += 1;
    } else {
      this.lines.push({ productId, qty: 1 });
    }
    p.stock -= 1;
  }

  removeLine(productId: string) {
    const idx = this.lines.findIndex((l) => l.productId === productId);
    if (idx === -1) return;
    const [line] = this.lines.splice(idx, 1);
    const p = this.catalog.products.get(line.productId);
    if (p) p.stock += line.qty;
  }

  bumpQty(productId: string, delta: number) {
    const line = this.lines.find((l) => l.productId === productId);
    const p = this.catalog.products.get(productId);
    if (!line || !p) return;
    const next = line.qty + delta;
    if (next <= 0) {
      this.removeLine(productId);
      return;
    }
    const diff = delta;
    if (diff > 0 && p.stock < diff) return;
    line.qty = next;
    p.stock -= diff;
  }

  clear() {
    for (const line of [...this.lines]) {
      this.removeLine(line.productId);
    }
  }
}

/** Пользователь: flow, map настроек, «логин» */
export class UserStore {
  name = "Гость";
  isLoggedIn = false;
  token: string | null = null;
  loading = false;
  prefs = observable.map<string, string>();
  /** Обновляется именованной reaction — удобно искать в таймлайне */
  uiSyncProbe = "";

  constructor() {
    makeAutoObservable(this, { login: flow, loadPrefs: flow });
    this.prefs.set("theme", "dark");
    this.prefs.set("locale", "ru-RU");
  }

  setName(next: string) {
    this.name = next;
  }

  setPref(key: string, value: string) {
    this.prefs.set(key, value);
  }

  toggleLogin() {
    if (this.isLoggedIn) {
      this.isLoggedIn = false;
      this.token = null;
    } else {
      void this.login();
    }
  }

  *login() {
    this.loading = true;
    try {
      yield new Promise((r) => setTimeout(r, 450));
      runInAction(() => {
        this.isLoggedIn = true;
        this.token = "jwt-demo-" + Math.random().toString(36).slice(2, 8);
        this.name = this.name === "Гость" ? "Демо-пользователь" : this.name;
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  *loadPrefs() {
    this.loading = true;
    try {
      yield new Promise((r) => setTimeout(r, 300));
      runInAction(() => {
        this.prefs.set("syncedAt", new Date().toISOString());
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }
}

/** Посты с публичного REST API + агрегации в computed */
export type ApiPost = {
  userId: number;
  id: number;
  title: string;
  body: string;
};

const POSTS_API = "https://jsonplaceholder.typicode.com/posts";

export class OpenApiPostsStore {
  posts = observable.array<ApiPost>([]);
  status: "idle" | "loading" | "error" | "ready" = "idle";
  error: string | null = null;
  fetchedAt: string | null = null;
  /** Последний использованный лимит (для UI) */
  lastLimit = 0;

  constructor() {
    makeAutoObservable(this, { fetchPosts: flow });
  }

  get postCount() {
    return this.posts.length;
  }

  /** Распределение: userId → число постов */
  get postsPerUser(): Map<number, number> {
    const m = new Map<number, number>();
    for (const p of this.posts) {
      m.set(p.userId, (m.get(p.userId) ?? 0) + 1);
    }
    return m;
  }

  get avgTitleLength() {
    if (this.posts.length === 0) return 0;
    const sum = this.posts.reduce((s, p) => s + p.title.length, 0);
    return Math.round((sum / this.posts.length) * 10) / 10;
  }

  get avgBodyLength() {
    if (this.posts.length === 0) return 0;
    const sum = this.posts.reduce((s, p) => s + p.body.length, 0);
    return Math.round(sum / this.posts.length);
  }

  /** Автор с максимумом постов в текущей выборке */
  get topUserByVolume(): { userId: number; count: number } | null {
    let best: { userId: number; count: number } | null = null;
    for (const [userId, count] of this.postsPerUser) {
      if (!best || count > best.count) best = { userId, count };
    }
    return best;
  }

  *fetchPosts(limit = 40) {
    const lim = Math.min(100, Math.max(1, Math.floor(limit)));
    this.status = "loading";
    this.error = null;
    this.lastLimit = lim;
    try {
      const res: Response = yield fetch(`${POSTS_API}?_limit=${lim}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiPost[] = yield res.json();
      runInAction(() => {
        this.posts.replace(data);
        this.status = "ready";
        this.fetchedAt = new Date().toISOString();
      });
    } catch (e) {
      runInAction(() => {
        this.status = "error";
        this.error = e instanceof Error ? e.message : String(e);
      });
    }
  }

  clearPosts() {
    this.posts.clear();
    this.status = "idle";
    this.error = null;
    this.fetchedAt = null;
    this.lastLimit = 0;
  }
}

/** Счётчик + runInAction-пачка + observable.box */
export class MetricsStore {
  clicks = 0;
  expensiveRuns = 0;
  /** Отдельный паттерн MobX — в spy видны как value-изменения boxed */
  heat = observable.box(0);

  constructor() {
    makeAutoObservable(this, { heat: false });
  }

  incClicks() {
    this.clicks += 1;
  }

  bumpHeat() {
    this.heat.set(this.heat.get() + 1);
  }

  /** Одно транзакционное обновление — в spy будет сгруппировано */
  burst() {
    runInAction(() => {
      this.clicks += 3;
      this.expensiveRuns += 1;
    });
  }
}

export type DemoStores = {
  catalog: CatalogStore;
  cart: CartStore;
  user: UserStore;
  metrics: MetricsStore;
  openApi: OpenApiPostsStore;
  dispose: () => void;
};

/**
 * Собирает сценарии: несколько observable-объектов, reaction между ними.
 * В DevTools смотри таймлайн (action / reaction / flow) и граф по выбранному событию.
 */
export function createDemoStores(): DemoStores {
  const catalog = new CatalogStore();
  catalog.seed();
  const cart = new CartStore(catalog);
  const user = new UserStore();
  const metrics = new MetricsStore();
  const openApi = new OpenApiPostsStore();

  const disposers: (() => void)[] = [];

  disposers.push(
    reaction(
      () => cart.totalPrice,
      (total) => {
        if (total > 15_000) {
          metrics.incClicks();
        }
      },
      { name: "warn-expensive-cart" },
    ),
  );

  disposers.push(
    reaction(
      () => ({ logged: user.isLoggedIn, lines: cart.lineCount }),
      ({ logged, lines }) => {
        user.uiSyncProbe = `${logged ? "auth" : "anon"}:${lines}lines`;
      },
      { name: "sync-ui-hint" },
    ),
  );

  return {
    catalog,
    cart,
    user,
    metrics,
    openApi,
    dispose: () => disposers.forEach((d) => d()),
  };
}
