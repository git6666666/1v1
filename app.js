// Performance Arena (Static) - Strong Search + Performance Score + Radar Chart + Column Module
const $ = (sel) => document.querySelector(sel);

const state = {
  products: [],
  byId: new Map(),
  category: "all",
  pickA: null,
  pickB: null,
  stats: {},        // stats[category][metricKey] = {min,max}
  fuseAll: null,    // Fuse index (all)
  fuseByCat: new Map(),
  radar: null,

  // Column posts
  posts: [],
  postById: new Map(),
  currentPost: null
};

// ✅ 性能党：品类性能档案（核心指标 & 权重）
const CATEGORY_PROFILES = {
  pc_part: {
    label: "电脑配件",
    coreMetrics: [
      { key: "3dmark_ts", label: "3DMark Time Spy", weight: 0.35 },
      { key: "fp32_tflops", label: "FP32 算力", weight: 0.25 },
      { key: "mem_bw", label: "显存带宽", weight: 0.15 },
      { key: "vram", label: "显存容量", weight: 0.10 },
      { key: "tbp", label: "功耗(TBP)", weight: 0.15 }
    ]
  },
  cpu: {
    label: "CPU",
    coreMetrics: [
      { key: "page_loads", label: "网页打开数", weight: 0.7 },
      { key: "year", label: "年份", weight: 0.3 }
    ]
  },
  phone: {
    label: "手机",
    coreMetrics: [
      { key: "geek6_sc", label: "Geekbench 6 单核", weight: 0.30 },
      { key: "geek6_mc", label: "Geekbench 6 多核", weight: 0.30 },
      { key: "gpu_score", label: "GPU 跑分", weight: 0.20 },
      { key: "battery", label: "电池容量", weight: 0.10 },
      { key: "weight", label: "重量", weight: 0.10 }
    ]
  },
  car: {
    label: "汽车",
    coreMetrics: [
      { key: "sales", label: "销量", weight: 0.60 },
      { key: "price", label: "价格", weight: 0.40 }
      
    ]
  }
  
};

const categoryName = (c) => ({
  pc_part: "电脑配件",
  cpu: "CPU",
  phone: "手机",
  car: "汽车",
  electronics: "电子产品",
  all: "全部"
}[c] || c);

function setStatus(text, ok=false){
  $("#statusText").textContent = text;
  $(".dot").style.background = ok ? "var(--green)" : "var(--yellow)";
  $(".dot").style.boxShadow = ok
    ? "0 0 14px rgba(61,220,151,.55)"
    : "0 0 14px rgba(255,209,102,.55)";
}

function escapeHtml(str){
  return (str || "").toString().replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function normalizeText(s){
  return (s || "").toString().trim().toLowerCase();
}

function getSearchPool(){
  if (state.category === "all") return state.products;
  return state.products.filter(p => p.category === state.category);
}

function computeStats(products){
  const stats = {};
  const groups = new Map();
  products.forEach(p => {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  });

  for (const [cat, list] of groups.entries()){
    stats[cat] = {};
    list.forEach(p => {
      (p.metrics || []).forEach(m => {
        const v = Number(m.value);
        if (!Number.isFinite(v)) return;
        if (!stats[cat][m.key]) stats[cat][m.key] = {min:v, max:v};
        stats[cat][m.key].min = Math.min(stats[cat][m.key].min, v);
        stats[cat][m.key].max = Math.max(stats[cat][m.key].max, v);
      });
    });
  }
  return stats;
}

function getMetric(product, key){
  return (product.metrics || []).find(m => m.key === key) || null;
}

function normalizeMetric(cat, metric){
  const st = state.stats?.[cat]?.[metric.key];
  if (!st) return null;

  const v = Number(metric.value);
  if (!Number.isFinite(v)) return null;

  const min = st.min, max = st.max;
  if (max === min) return 100;

  let t = (v - min) / (max - min);
  if (metric.higherBetter === false) t = 1 - t;
  return Math.round(t * 100);
}

// 综合性能分（同品类）
function computePerfScore(product){
  const cat = product.category;
  const profile = CATEGORY_PROFILES[cat];
  if (!profile) return null;

  const items = profile.coreMetrics
    .map(def => {
      const m = getMetric(product, def.key);
      if (!m) return null;
      const n = normalizeMetric(cat, m);
      if (n === null) return null;
      return { w: def.weight, n };
    })
    .filter(Boolean);

  if (items.length === 0) return null;

  const wsum = items.reduce((a,b) => a + b.w, 0);
  const score = items.reduce((a,b) => a + (b.n * b.w), 0) / (wsum || 1);
  return Math.round(score);
}

function buildCard(product){
  const kvRows = [];
  kvRows.push({ k: "品类", v: categoryName(product.category) });
  if (product.brand) kvRows.push({ k: "品牌", v: product.brand });
  if (product.year) kvRows.push({ k: "年份", v: String(product.year) });

  const profile = CATEGORY_PROFILES[product.category];
  const showKeys = profile ? profile.coreMetrics.map(x => x.key) : [];

  const addMetricRow = (m) => {
    const valueText = `${m.value}${m.unit ? " " + m.unit : ""}`;
    kvRows.push({ k: m.label, v: valueText });
  };

  if (profile){
    showKeys.forEach(k => {
      const m = getMetric(product, k);
      if (m) addMetricRow(m);
    });
  } else {
    (product.metrics || []).slice(0, 6).forEach(addMetricRow);
  }

  const rowsHtml = kvRows.map(r => `
    <div class="row">
      <div class="k">${escapeHtml(r.k)}</div>
      <div class="v">${escapeHtml(r.v)}</div>
    </div>
  `).join("");

  return `
    <h3>${escapeHtml(product.name)}</h3>
    <div class="small">${escapeHtml(product.desc || "")}</div>
    <div class="kv">${rowsHtml}</div>
  `;
}

/** ----------------- 强搜索（Fuse.js） ----------------- **/
function buildFuseIndex(products){
  const options = {
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "name", weight: 0.45 },
      { name: "brand", weight: 0.15 },
      { name: "aliases", weight: 0.25 },
      { name: "keywords", weight: 0.10 },
      { name: "year", weight: 0.05 }
    ]
  };
  return new Fuse(products, options);
}

function getFuse(){
  if (state.category === "all") return state.fuseAll;
  return state.fuseByCat.get(state.category);
}

function renderSuggest(target, inputEl, suggestEl){
  const q = inputEl.value.trim();
  suggestEl.innerHTML = "";
  if (!q || q.length < 2) return;

  const fuse = getFuse();
  if (!fuse) return;

  const res = fuse.search(q).slice(0, 10).map(x => x.item);
  if (res.length === 0) return;

  const wrap = document.createElement("div");
  wrap.className = "list";
  res.forEach(p => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div><strong>${escapeHtml(p.name)}</strong></div>
      <div class="meta">
        <span class="badge">${escapeHtml(categoryName(p.category))}</span>
        <span>${escapeHtml(p.brand || "—")}</span>
        <span>${escapeHtml(p.year ? String(p.year) : "")}</span>
        ${p.aliases?.length ? `<span class="badge">别名：${escapeHtml(p.aliases.slice(0,2).join(" / "))}</span>` : ""}
      </div>
    `;
    div.addEventListener("click", () => {
      inputEl.value = p.name;
      inputEl.dataset.prepickId = p.id;
      suggestEl.innerHTML = "";
      flashPickedHint(target, p, true);
    });
    wrap.appendChild(div);
  });
  suggestEl.appendChild(wrap);
}

function flashPickedHint(target, product, isPrepick=false){
  const el = target === "A" ? $("#pickedA") : $("#pickedB");
  el.textContent = (isPrepick ? "已预选：" : "已选择：") + `${product.name}（${categoryName(product.category)}）`;
  el.classList.remove("dim");
}

function setPicked(target, product){
  if (target === "A") state.pickA = product;
  else state.pickB = product;

  flashPickedHint(target, product, false);
  tryRenderCompare();
}

function clearPicked(target){
  const el = target === "A" ? $("#pickedA") : $("#pickedB");
  el.textContent = "未选择";
  el.classList.add("dim");
  if (target === "A") state.pickA = null;
  else state.pickB = null;
}

function pickByInput(target){
  const inputEl = target === "A" ? $("#inputA") : $("#inputB");
  const preId = inputEl.dataset.prepickId;

  let product = null;
  if (preId && state.byId.has(preId)) {
    product = state.byId.get(preId);
  } else {
    const q = inputEl.value.trim();
    const fuse = getFuse();
    product = fuse?.search(q)?.[0]?.item || null;
  }

  if (!product){
    alert("未找到该产品：请使用下拉建议选择，或输入更短关键词（如型号/数字）。");
    return;
  }
  inputEl.dataset.prepickId = "";
  setPicked(target, product);
}

function bindSuggest(target){
  const inputEl = target === "A" ? $("#inputA") : $("#inputB");
  const suggestEl = target === "A" ? $("#suggestA") : $("#suggestB");

  inputEl.addEventListener("input", () => {
    inputEl.dataset.prepickId = "";
    renderSuggest(target, inputEl, suggestEl);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      pickByInput(target);
      suggestEl.innerHTML = "";
    } else if (e.key === "Escape"){
      suggestEl.innerHTML = "";
    }
  });

  document.addEventListener("click", (e) => {
    if (!suggestEl.contains(e.target) && e.target !== inputEl){
      suggestEl.innerHTML = "";
    }
  });
}


/** ----------------- 图表：雷达图（Chart.js） ----------------- **/
/*
function buildRadar(labels, aData, bData){
  const ctx = $("#radarChart").getContext("2d");
  if (state.radar){
    state.radar.destroy();
    state.radar = null;
  }

  state.radar = new Chart(ctx, {
    type: "radar",
    data: {
      labels,
      datasets: [
        {
          label: "A",
          data: aData,
          borderColor: "rgba(78,231,255,.9)",
          backgroundColor: "rgba(78,231,255,.12)",
          pointBackgroundColor: "rgba(78,231,255,.9)",
          pointRadius: 2
        },
        {
          label: "B",
          data: bData,
          borderColor: "rgba(167,139,250,.9)",
          backgroundColor: "rgba(167,139,250,.12)",
          pointBackgroundColor: "rgba(167,139,250,.9)",
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: "rgba(234,240,255,.85)" } },
        tooltip: { enabled: true }
      },
      scales: {
        r: {
          min: 0, max: 100,
          grid: { color: "rgba(255,255,255,.08)" },
          angleLines: { color: "rgba(255,255,255,.08)" },
          pointLabels: { color: "rgba(234,240,255,.8)", font: { size: 12 } },
          ticks: { display: false }
        }
      }
    }
  });
}
*/

/** ----------------- 指标列表：条形对比 ----------------- **/
/*
function unionMetrics(A, B, onlyProfile){
  const sameCat = A.category === B.category;

  if (onlyProfile && sameCat && CATEGORY_PROFILES[A.category]){
    const keys = CATEGORY_PROFILES[A.category].coreMetrics.map(x => x.key);
    return keys.map(k => (getMetric(A,k) || getMetric(B,k) || { key:k, label:k, unit:"" }));
  }

  const map = new Map();
  (A.metrics || []).forEach(m => map.set(m.key, m));
  (B.metrics || []).forEach(m => { if(!map.has(m.key)) map.set(m.key, m); });
  return [...map.values()].sort((x,y) => (x.label || "").localeCompare(y.label || "", "zh"));
}
*/

/** ----------------- 主渲染逻辑 ----------------- **/

function tryRenderCompare(){
  const A = state.pickA, B = state.pickB;
  if (!A || !B) {
    $("#compareSection").classList.add("hidden");
    return;
  }
  $("#compareSection").classList.remove("hidden");

  const sameCat = A.category === B.category;
  const onlyProfile = $("#toggleOnlyProfile").checked;
  const showRaw = $("#toggleRaw").checked;

  $("#compareSubtitle").textContent = sameCat
    ? `品类：${categoryName(A.category)} · 性能分与归一化有效`
    : `跨品类对比：${categoryName(A.category)} vs ${categoryName(B.category)}（综合分/归一化不可比，建议同品类）`;

  $("#cardA").innerHTML = buildCard(A);
  $("#cardB").innerHTML = buildCard(B);

  if (sameCat){
    const sA = computePerfScore(A);
    const sB = computePerfScore(B);
    $("#scoreA").textContent = sA ?? "—";
    $("#scoreB").textContent = sB ?? "—";

    if (sA !== null && sB !== null){
      const delta = sA - sB;
      if (Math.abs(delta) <= 2) $("#winnerText").textContent = "势均力敌（差距≤2）";
      else if (delta > 0) $("#winnerText").textContent = `A 领先 +${delta}`;
      else $("#winnerText").textContent = `B 领先 +${Math.abs(delta)}`;
    } else {
      $("#winnerText").textContent = "核心指标不足，无法计算综合分";
    }
  } else {
    $("#scoreA").textContent = "—";
    $("#scoreB").textContent = "—";
    $("#winnerText").textContent = "跨品类仅供参考";
  }

  const models = unionMetrics(A, B, onlyProfile);
  const list = $("#metricList");
  list.innerHTML = "";

  // 雷达图
  /*
  if (sameCat && CATEGORY_PROFILES[A.category]){
    const core = CATEGORY_PROFILES[A.category].coreMetrics;
    const labels = core.map(x => x.label);
    const aData = core.map(def => {
      const m = getMetric(A, def.key);
      return m ? (normalizeMetric(A.category, m) ?? 0) : 0;
    });
    const bData = core.map(def => {
      const m = getMetric(B, def.key);
      return m ? (normalizeMetric(B.category, m) ?? 0) : 0;
    });

    $("#radarBadge").textContent = `${categoryName(A.category)} · ${core.length} 项`;
    buildRadar(labels, aData, bData);
  } else {
    $("#radarBadge").textContent = "同品类才可用";
    if (state.radar){
      state.radar.destroy();
      state.radar = null;
    }
    const ctx = $("#radarChart").getContext("2d");
    ctx.clearRect(0,0, ctx.canvas.width, ctx.canvas.height);
  }

  // 条形图列表
  models.forEach(model => {
    const mA = getMetric(A, model.key);
    const mB = getMetric(B, model.key);
    if (!mA && !mB) return;

    const label = model.label || model.key;
    const unit = model.unit || mA?.unit || mB?.unit || "";

    const aValText = mA ? `${mA.value}${unit ? " " + unit : ""}` : "—";
    const bValText = mB ? `${mB.value}${unit ? " " + unit : ""}` : "—";

    let aNorm = null, bNorm = null;
    if (sameCat){
      if (mA) aNorm = normalizeMetric(A.category, mA);
      if (mB) bNorm = normalizeMetric(B.category, mB);
    }

    const metricEl = document.createElement("div");
    metricEl.className = "metric";

    metricEl.innerHTML = `
      <div class="metricTop">
        <div class="metricName">${escapeHtml(label)}</div>
        <div class="metricUnit">${escapeHtml(unit)}</div>
      </div>
      <div class="bars">
        <div class="bar">
          <div class="barLabel">
            <span>A：${escapeHtml(A.name)}</span>
            <span>${escapeHtml(showRaw ? aValText : (sameCat && aNorm!==null ? (aNorm+"") : aValText))}</span>
          </div>
          <div class="track"><div class="fill" style="width:${sameCat && aNorm!==null ? aNorm : 0}%"></div></div>
          <div class="hint">${escapeHtml(sameCat && aNorm!==null ? `归一化：${aNorm}` : "—")}</div>
        </div>
        <div class="bar">
          <div class="barLabel">
            <span>B：${escapeHtml(B.name)}</span>
            <span>${escapeHtml(showRaw ? bValText : (sameCat && bNorm!==null ? (bNorm+"") : bValText))}</span>
          </div>
          <div class="track"><div class="fill" style="width:${sameCat && bNorm!==null ? bNorm : 0}%"></div></div>
          <div class="hint">${escapeHtml(sameCat && bNorm!==null ? `归一化：${bNorm}` : "—")}</div>
        </div>
      </div>
    `;
    list.appendChild(metricEl);
  });
  */
}


/** ----------------- Column Module（专栏） ----------------- **/
function parseISODate(d){
  // 允许 YYYY-MM-DD
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

function clamp200(text){
  const s = (text || "").toString().trim();
  if (s.length <= 200) return s;
  return s.slice(0, 200) + "…";
}

function collectTags(posts){
  const set = new Set();
  posts.forEach(p => (p.tags || []).forEach(t => set.add(t)));
  return [...set].sort((a,b)=>a.localeCompare(b,"zh"));
}

function renderTagFilter(){
  const sel = $("#tagFilter");
  if (!sel) return;

  const tags = collectTags(state.posts);
  const current = sel.value || "all";

  sel.innerHTML = `<option value="all">全部标签</option>` +
    tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  sel.value = tags.includes(current) ? current : "all";
}

function renderColumns(){
  const list = $("#columnList");
  if (!list) return;

  const filter = $("#tagFilter")?.value || "all";

  const posts = [...state.posts]
    .map(p => ({...p, content: clamp200(p.content)}))
    .filter(p => filter === "all" ? true : (p.tags || []).includes(filter))
    .sort((a,b) => {
      // pinned desc first
      const pa = a.pinned ? 1 : 0;
      const pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return parseISODate(b.date) - parseISODate(a.date);
    })
    .slice(0, 6);

  if (posts.length === 0){
    list.innerHTML = `<div class="badge">暂无专栏内容（请检查 data/columns.json）</div>`;
    return;
  }

  list.innerHTML = posts.map(p => `
    <div class="postCard" data-post-id="${escapeHtml(p.id)}">
      <div class="postGlow"></div>
      ${p.pinned ? `<div class="pin">置顶</div>` : ``}
      <div class="postHead">
        <div class="postTitle">${escapeHtml(p.title)}</div>
        <div class="postMeta">${escapeHtml(p.date || "")}</div>
      </div>
      <div class="postContent">${escapeHtml(p.content || "")}</div>
      <div class="postTags">
        ${(p.tags || []).slice(0, 4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
      </div>
    </div>
  `).join("");

  // bind click
  list.querySelectorAll(".postCard").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-post-id");
      openPost(id);
    });
  });
}

function openPost(id){
  const post = state.postById.get(id);
  if (!post) return;

  state.currentPost = post;
  const modal = $("#postModal");
  $("#modalMeta").textContent = `${post.date || ""} · ${(post.tags || []).join(" / ")}`;
  $("#modalTitle").textContent = post.title || "";
  $("#modalBody").textContent = clamp200(post.content || "");

  modal.classList.remove("hidden");
  // 设置 hash，方便分享直达
  const url = new URL(location.href);
  url.hash = `post=${encodeURIComponent(id)}`;
  history.replaceState(null, "", url.toString());
}

function closePost(){
  const modal = $("#postModal");
  modal.classList.add("hidden");
  state.currentPost = null;

  // 关闭后清理 hash
  const url = new URL(location.href);
  if (url.hash.startsWith("#post=")) {
    url.hash = "";
    history.replaceState(null, "", url.toString());
  }
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    alert("已复制到剪贴板");
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("已复制到剪贴板");
  }
}

function bindColumnUI(){
  $("#tagFilter")?.addEventListener("change", renderColumns);

  $("#copyColumnLink")?.addEventListener("click", () => {
    copyText(location.origin + location.pathname + "#column");
  });

  $("#closeModal")?.addEventListener("click", closePost);
  $("#closeModal2")?.addEventListener("click", closePost);
  $("#modalBackdrop")?.addEventListener("click", closePost);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#postModal").classList.contains("hidden")){
      closePost();
    }
  });

  $("#copyPostLink")?.addEventListener("click", () => {
    if (!state.currentPost) return;
    const url = location.origin + location.pathname + `#post=${encodeURIComponent(state.currentPost.id)}`;
    copyText(url);
  });

  // 入口：如果 hash 是 post=xxx，自动打开
  if (location.hash && location.hash.startsWith("#post=")){
    const id = decodeURIComponent(location.hash.replace("#post=", ""));
    // 数据加载后再打开（init 里会再次调用）
    state._pendingPostId = id;
  }
}

/** ----------------- 其他交互 ----------------- **/
function clearAll(){
  state.pickA = null;
  state.pickB = null;
  $("#inputA").value = "";
  $("#inputB").value = "";
  $("#inputA").dataset.prepickId = "";
  $("#inputB").dataset.prepickId = "";
  clearPicked("A");
  clearPicked("B");
  $("#compareSection").classList.add("hidden");
}

function randomPickFromPool(){
  const pool = getSearchPool();
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function init(){
  $("#year").textContent = String(new Date().getFullYear());
  setStatus("正在加载数据…");

  bindColumnUI();

  try{
    // 1) products
    const resp = await fetch("./data/products.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    state.products = data;
    state.byId = new Map(data.map(p => [p.id, p]));
    state.stats = computeStats(data);

    state.fuseAll = buildFuseIndex(state.products);
    ["pc_part","phone","car","electronics"].forEach(cat => {
      const list = state.products.filter(p => p.category === cat);
      state.fuseByCat.set(cat, buildFuseIndex(list));
    });

    // 2) columns
    try{
      const r2 = await fetch("./data/columns.json", { cache: "no-store" });
      if (r2.ok){
        const posts = await r2.json();
        state.posts = Array.isArray(posts) ? posts : [];
        state.postById = new Map(state.posts.map(p => [p.id, p]));
        renderTagFilter();
        renderColumns();
      }
    }catch(e){
      console.warn("columns.json load failed", e);
    }

    setStatus(`数据已加载：${data.length} 条（对比+专栏就绪）`, true);

    // bind category
    $("#categorySelect").addEventListener("change", () => {
      state.category = $("#categorySelect").value;
      clearAll();
    });

    // bind suggest
    bindSuggest("A");
    bindSuggest("B");

    // bind confirm
    $("#confirmA").addEventListener("click", () => pickByInput("A"));
    $("#confirmB").addEventListener("click", () => pickByInput("B"));

    // random
    $("#randomA").addEventListener("click", () => {
      const p = randomPickFromPool();
      if (!p) return;
      $("#inputA").value = p.name;
      setPicked("A", p);
    });
    $("#randomB").addEventListener("click", () => {
      const p = randomPickFromPool();
      if (!p) return;
      $("#inputB").value = p.name;
      setPicked("B", p);
    });

    // swap
    $("#swapBtn").addEventListener("click", () => {
      const tmp = state.pickA;
      state.pickA = state.pickB;
      state.pickB = tmp;

      const tmpText = $("#inputA").value;
      $("#inputA").value = $("#inputB").value;
      $("#inputB").value = tmpText;

      if (state.pickA) flashPickedHint("A", state.pickA, false); else clearPicked("A");
      if (state.pickB) flashPickedHint("B", state.pickB, false); else clearPicked("B");

      tryRenderCompare();
    });

    // clear
    $("#clearBtn").addEventListener("click", clearAll);

    // toggles
    $("#toggleRaw").addEventListener("change", tryRenderCompare);
    $("#toggleOnlyProfile").addEventListener("change", tryRenderCompare);

    // 如果 hash 带 post=xxx，加载后自动打开
    if (state._pendingPostId && state.postById.has(state._pendingPostId)){
      openPost(state._pendingPostId);
      state._pendingPostId = null;
    }

  }catch(err){
    console.error(err);
    setStatus("数据加载失败：请检查 data/products.json / data/columns.json 路径与 JSON 格式", false);
  }
}

init();
