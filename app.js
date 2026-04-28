const STORAGE_KEYS = {
  localItems: "paste-pocket.local-items.v1",
  meta: "paste-pocket.meta.v1",
  vault: "paste-pocket.vault.v1",
};

const state = {
  seedItems: [],
  localItems: [],
  vaultItems: [],
  metadata: {},
  filters: {
    query: "",
    scope: "all",
    type: "all",
    category: "all",
    favoritesOnly: false,
  },
  selectedId: null,
  vaultUnlocked: false,
  vaultReady: false,
  vaultKey: null,
  editingId: null,
};

const els = {
  searchInput: document.querySelector("#search-input"),
  scopeFilter: document.querySelector("#scope-filter"),
  typeFilter: document.querySelector("#type-filter"),
  categoryFilter: document.querySelector("#category-filter"),
  favoritesOnly: document.querySelector("#favorites-only"),
  itemList: document.querySelector("#item-list"),
  itemCount: document.querySelector("#item-count"),
  detailEmpty: document.querySelector("#detail-empty"),
  detailView: document.querySelector("#detail-view"),
  detailTemplate: document.querySelector("#detail-template"),
  addItemButton: document.querySelector("#add-item-button"),
  itemDialog: document.querySelector("#item-dialog"),
  itemForm: document.querySelector("#item-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogCloseButton: document.querySelector("#dialog-close-button"),
  entryStorage: document.querySelector("#entry-storage"),
  entryType: document.querySelector("#entry-type"),
  entryTitle: document.querySelector("#entry-title"),
  entryCategory: document.querySelector("#entry-category"),
  entryTags: document.querySelector("#entry-tags"),
  entryLink: document.querySelector("#entry-link"),
  entryContent: document.querySelector("#entry-content"),
  entryShell: document.querySelector("#entry-shell"),
  entryUsername: document.querySelector("#entry-username"),
  entryPassword: document.querySelector("#entry-password"),
  entrySecret: document.querySelector("#entry-secret"),
  entryNotes: document.querySelector("#entry-notes"),
  vaultStatus: document.querySelector("#vault-status"),
  vaultPassword: document.querySelector("#vault-password"),
  vaultCreateButton: document.querySelector("#vault-create-button"),
  vaultUnlockButton: document.querySelector("#vault-unlock-button"),
  vaultLockButton: document.querySelector("#vault-lock-button"),
  vaultExportButton: document.querySelector("#vault-export-button"),
  vaultImportInput: document.querySelector("#vault-import-input"),
  statusToast: document.querySelector("#status-toast"),
};

initialize().catch((error) => {
  console.error(error);
  window.alert("初始化失败，请查看控制台错误信息。");
});

async function initialize() {
  await loadSeedItems();
  state.localItems = readJson(STORAGE_KEYS.localItems, []);
  state.metadata = readJson(STORAGE_KEYS.meta, {});
  state.vaultReady = Boolean(localStorage.getItem(STORAGE_KEYS.vault));
  updateVaultStatus();
  bindEvents();
  refreshCategoryFilter();
  render();
}

async function loadSeedItems() {
  const response = await fetch("./data/library.json");
  state.seedItems = await response.json();
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    render();
  });

  els.scopeFilter.addEventListener("change", (event) => {
    state.filters.scope = event.target.value;
    refreshCategoryFilter();
    render();
  });

  els.typeFilter.addEventListener("change", (event) => {
    state.filters.type = event.target.value;
    refreshCategoryFilter();
    render();
  });

  els.categoryFilter.addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    render();
  });

  els.favoritesOnly.addEventListener("change", (event) => {
    state.filters.favoritesOnly = event.target.checked;
    render();
  });

  els.addItemButton.addEventListener("click", () => openDialogForCreate());
  els.dialogCloseButton.addEventListener("click", () => els.itemDialog.close());
  els.entryType.addEventListener("change", syncFormVisibility);
  els.entryStorage.addEventListener("change", syncFormVisibility);
  els.itemForm.addEventListener("submit", handleFormSubmit);

  els.vaultCreateButton.addEventListener("click", createVault);
  els.vaultUnlockButton.addEventListener("click", unlockVault);
  els.vaultLockButton.addEventListener("click", lockVault);
  els.vaultExportButton.addEventListener("click", exportVault);
  els.vaultImportInput.addEventListener("change", importVault);
}

function render() {
  refreshCategoryFilter();
  const items = getFilteredItems();
  renderItemList(items);
  renderDetail(items);
}

function getAllItems() {
  const seed = state.seedItems.map((item) => ({ ...item, storage: "seed" }));
  const local = state.localItems.map((item) => ({ ...item, storage: "local" }));
  const vault = state.vaultItems.map((item) => ({ ...item, storage: "vault" }));
  return [...seed, ...local, ...vault];
}

function getFilteredItems() {
  return getAllItems()
    .filter(matchesFilters)
    .sort(sortItems);
}

function matchesFilters(item) {
  if (state.filters.scope !== "all" && item.storage !== state.filters.scope) {
    return false;
  }

  if (state.filters.type !== "all" && item.type !== state.filters.type) {
    return false;
  }

  if (state.filters.category !== "all" && item.category !== state.filters.category) {
    return false;
  }

  if (state.filters.favoritesOnly && !getMeta(item.id).favorite) {
    return false;
  }

  if (!state.filters.query) {
    return true;
  }

  const haystack = [
    item.title,
    item.category,
    item.tags?.join(" "),
    item.content,
    item.notes,
    item.username,
    item.shell,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(state.filters.query);
}

function sortItems(left, right) {
  const leftMeta = getMeta(left.id);
  const rightMeta = getMeta(right.id);

  if (leftMeta.favorite !== rightMeta.favorite) {
    return leftMeta.favorite ? -1 : 1;
  }

  const leftRecent = leftMeta.lastUsedAt ?? "";
  const rightRecent = rightMeta.lastUsedAt ?? "";

  if (leftRecent !== rightRecent) {
    return rightRecent.localeCompare(leftRecent);
  }

  return left.title.localeCompare(right.title, "zh-CN");
}

function renderItemList(items) {
  els.itemCount.textContent = `${items.length} 条`;
  els.itemList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "item-card";
    empty.innerHTML = "<h3>没有匹配结果</h3><p>换个关键词，或者新增一条更适合你的模板。</p>";
    els.itemList.append(empty);
    return;
  }

  if (!state.selectedId || !items.some((item) => item.id === state.selectedId)) {
    state.selectedId = items[0].id;
  }

  items.forEach((item) => {
    const meta = getMeta(item.id);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `item-card ${item.id === state.selectedId ? "active" : ""}`;
    card.innerHTML = `
      <div class="item-card-head">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <div class="badge-row">
            ${buildBadgeHtml(item.typeLabel ?? typeLabel(item.type))}
            ${buildBadgeHtml(item.category || "未分类")}
            ${buildBadgeHtml(storageLabel(item.storage), item.storage === "vault" ? "secret" : "")}
            ${meta.favorite ? buildBadgeHtml("已收藏") : ""}
          </div>
        </div>
      </div>
      <p>${escapeHtml(buildPreview(item))}</p>
    `;
    card.addEventListener("click", () => {
      state.selectedId = item.id;
      render();
    });
    els.itemList.append(card);
  });
}

function renderDetail(items) {
  const item = items.find((entry) => entry.id === state.selectedId);

  if (!item) {
    els.detailEmpty.classList.remove("hidden");
    els.detailView.classList.add("hidden");
    els.detailView.innerHTML = "";
    return;
  }

  els.detailEmpty.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  els.detailView.innerHTML = "";

  const fragment = els.detailTemplate.content.cloneNode(true);
  fragment.querySelector(".detail-kicker").textContent = storageLabel(item.storage);
  fragment.querySelector(".detail-title").textContent = item.title;
  fragment.querySelector(".detail-meta").innerHTML = [
    buildBadgeHtml(typeLabel(item.type)),
    buildBadgeHtml(item.category || "未分类"),
    ...(item.tags ?? []).map((tag) => buildBadgeHtml(tag)),
  ].join("");

  const actions = fragment.querySelector(".detail-actions");
  actions.append(
    buildActionButton(getMeta(item.id).favorite ? "取消收藏" : "收藏", () => toggleFavorite(item.id)),
    buildActionButton("复制主要内容", () => copyPrimaryContent(item)),
  );

  if (item.storage !== "seed") {
    actions.append(buildActionButton("编辑", () => openDialogForEdit(item)));
    actions.append(buildActionButton("删除", () => deleteItem(item)));
  }

  const body = fragment.querySelector(".detail-body");
  body.append(renderPrimaryBlock(item));

  if (item.type === "credential") {
    body.append(renderCredentialBlock(item));
  }

  const notes = fragment.querySelector(".detail-notes");
  if (item.notes) {
    notes.classList.remove("hidden");
    notes.innerHTML = `<h3>备注</h3><p>${escapeHtml(item.notes)}</p>`;
  }

  const linkBlock = fragment.querySelector(".detail-link");
  if (item.link) {
    linkBlock.classList.remove("hidden");
    linkBlock.innerHTML = `<h3>相关链接</h3><a href="${escapeAttribute(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.link)}</a>`;
  }

  els.detailView.append(fragment);
}

function renderPrimaryBlock(item) {
  const block = document.createElement("section");
  block.className = "content-block";
  const title = item.type === "command" ? "命令内容" : item.type === "credential" ? "附加说明" : "正文";
  const shellLine = item.type === "command" && item.shell ? `<p class="eyebrow">环境：${escapeHtml(item.shell)}</p>` : "";
  block.innerHTML = `
    <h3>${title}</h3>
    ${shellLine}
    <pre>${escapeHtml(item.content || "暂无内容")}</pre>
  `;
  return block;
}

function renderCredentialBlock(item) {
  const wrapper = document.createElement("section");
  wrapper.className = "credential-grid";

  wrapper.append(
    buildSecretArticle("账号", item.username || "未填写", false, item.username),
    buildSecretArticle("密码", item.password || "未填写", true, item.password),
    buildSecretArticle("密钥 / Token", item.secret || "未填写", true, item.secret),
  );
  return wrapper;
}

function buildSecretArticle(label, rawValue, isSensitive, copyValue) {
  const article = document.createElement("article");
  const displayValue = isSensitive ? maskSecret(rawValue) : rawValue;
  article.innerHTML = `
    <h3>${escapeHtml(label)}</h3>
    <p class="secret-value">${escapeHtml(displayValue)}</p>
  `;

  const row = document.createElement("div");
  row.className = "detail-actions";

  if (isSensitive && copyValue) {
    row.append(buildActionButton("显示", () => {
      const paragraph = article.querySelector(".secret-value");
      paragraph.textContent = paragraph.textContent.includes("•") ? rawValue : maskSecret(rawValue);
    }));
  }

  if (copyValue) {
    row.append(buildActionButton("复制", async () => {
      await copyText(copyValue);
      toast("已复制到剪切板");
    }));
  }

  article.append(row);
  return article;
}

function buildActionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function buildPreview(item) {
  if (item.type === "credential") {
    return item.username ? `账号：${item.username}` : "包含账号、密码或密钥";
  }
  return (item.content || "").replace(/\s+/g, " ").slice(0, 84) || "暂无内容";
}

function typeLabel(type) {
  return {
    text: "话术",
    command: "命令",
    credential: "凭据",
  }[type] ?? type;
}

function storageLabel(storage) {
  return {
    seed: "公开示例",
    local: "本地模板",
    vault: "加密保险箱",
  }[storage] ?? storage;
}

function buildBadgeHtml(label, extraClass = "") {
  if (!label) {
    return "";
  }
  return `<span class="badge ${extraClass}">${escapeHtml(label)}</span>`;
}

function copyPrimaryContent(item) {
  const content = item.type === "credential"
    ? [item.username, item.password, item.secret, item.content].filter(Boolean).join("\n")
    : item.content || "";

  copyText(content).then(() => {
    markUsed(item.id);
    toast("已复制到剪切板");
    render();
  });
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
}

function toggleFavorite(id) {
  const meta = getMeta(id);
  meta.favorite = !meta.favorite;
  saveMeta();
  render();
}

function markUsed(id) {
  const meta = getMeta(id);
  meta.lastUsedAt = new Date().toISOString();
  saveMeta();
}

function getMeta(id) {
  if (!state.metadata[id]) {
    state.metadata[id] = { favorite: false, lastUsedAt: null };
  }
  return state.metadata[id];
}

function saveMeta() {
  localStorage.setItem(STORAGE_KEYS.meta, JSON.stringify(state.metadata));
}

function openDialogForCreate() {
  state.editingId = null;
  els.dialogTitle.textContent = "新增条目";
  els.itemForm.reset();
  els.entryStorage.value = "local";
  els.entryType.value = "text";
  syncFormVisibility();
  els.itemDialog.showModal();
}

function openDialogForEdit(item) {
  state.editingId = item.id;
  els.dialogTitle.textContent = "编辑条目";
  els.entryStorage.value = item.storage;
  els.entryType.value = item.type;
  els.entryTitle.value = item.title ?? "";
  els.entryCategory.value = item.category ?? "";
  els.entryTags.value = (item.tags ?? []).join(", ");
  els.entryLink.value = item.link ?? "";
  els.entryContent.value = item.content ?? "";
  els.entryShell.value = item.shell ?? "";
  els.entryUsername.value = item.username ?? "";
  els.entryPassword.value = item.password ?? "";
  els.entrySecret.value = item.secret ?? "";
  els.entryNotes.value = item.notes ?? "";
  syncFormVisibility();
  els.itemDialog.showModal();
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const storage = els.entryStorage.value;
  const type = els.entryType.value;

  if (storage === "vault" && !state.vaultUnlocked) {
    window.alert("请先解锁或创建加密保险箱，再保存敏感条目。");
    return;
  }

  if (type === "credential" && storage !== "vault") {
    window.alert("凭据类型只能保存在加密保险箱里。");
    return;
  }

  const item = {
    id: state.editingId ?? crypto.randomUUID(),
    type,
    title: els.entryTitle.value.trim(),
    category: els.entryCategory.value.trim(),
    tags: splitTags(els.entryTags.value),
    link: els.entryLink.value.trim(),
    content: els.entryContent.value.trim(),
    shell: els.entryShell.value.trim(),
    username: els.entryUsername.value.trim(),
    password: els.entryPassword.value.trim(),
    secret: els.entrySecret.value.trim(),
    notes: els.entryNotes.value.trim(),
  };

  if (storage === "local") {
    upsertItem(state.localItems, item);
    localStorage.setItem(STORAGE_KEYS.localItems, JSON.stringify(state.localItems));
  } else {
    upsertItem(state.vaultItems, item);
    await persistVault();
  }

  state.selectedId = item.id;
  els.itemDialog.close();
  render();
}

function upsertItem(items, incoming) {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index === -1) {
    items.push(incoming);
  } else {
    items.splice(index, 1, incoming);
  }
}

async function deleteItem(item) {
  const confirmed = window.confirm(`确认删除“${item.title}”吗？`);
  if (!confirmed) {
    return;
  }

  if (item.storage === "local") {
    state.localItems = state.localItems.filter((entry) => entry.id !== item.id);
    localStorage.setItem(STORAGE_KEYS.localItems, JSON.stringify(state.localItems));
  }

  if (item.storage === "vault") {
    state.vaultItems = state.vaultItems.filter((entry) => entry.id !== item.id);
    await persistVault();
  }

  delete state.metadata[item.id];
  saveMeta();
  render();
}

function syncFormVisibility() {
  const type = els.entryType.value;
  const storage = els.entryStorage.value;
  const commandOnly = document.querySelectorAll(".command-only");
  const credentialOnly = document.querySelectorAll(".credential-only");

  commandOnly.forEach((node) => {
    node.style.display = type === "command" ? "flex" : "none";
  });

  credentialOnly.forEach((node) => {
    node.style.display = type === "credential" ? "flex" : "none";
  });

  if (type === "credential") {
    els.entryStorage.value = "vault";
  }

  if (storage === "vault") {
    els.entryStorage.title = "敏感内容建议保存到加密保险箱";
  } else {
    els.entryStorage.removeAttribute("title");
  }
}

function refreshCategoryFilter() {
  const previous = state.filters.category;
  const categories = [...new Set(
    getAllItems()
      .filter((item) => state.filters.scope === "all" || item.storage === state.filters.scope)
      .filter((item) => state.filters.type === "all" || item.type === state.filters.type)
      .map((item) => item.category)
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "zh-CN"));

  els.categoryFilter.innerHTML = `<option value="all">全部</option>${categories
    .map((category) => `<option value="${escapeAttribute(category)}">${escapeHtml(category)}</option>`)
    .join("")}`;

  if (categories.includes(previous)) {
    els.categoryFilter.value = previous;
  } else {
    state.filters.category = "all";
    els.categoryFilter.value = "all";
  }
}

async function createVault() {
  const password = els.vaultPassword.value;
  if (!password) {
    window.alert("请先输入一个主密码。");
    return;
  }

  if (state.vaultReady) {
    const overwrite = window.confirm("已存在保险箱。继续会覆盖现有保险箱，确定吗？");
    if (!overwrite) {
      return;
    }
  }

  state.vaultItems = [];
  state.vaultKey = await deriveKey(password, crypto.getRandomValues(new Uint8Array(16)));
  await persistVault(state.vaultKey.salt);
  state.vaultUnlocked = true;
  state.vaultReady = true;
  updateVaultStatus();
  render();
  toast("保险箱已创建并解锁");
}

async function unlockVault() {
  if (!state.vaultReady) {
    window.alert("还没有保险箱，请先创建。");
    return;
  }

  const password = els.vaultPassword.value;
  if (!password) {
    window.alert("请输入主密码。");
    return;
  }

  try {
    const envelope = readJson(STORAGE_KEYS.vault, null);
    const salt = base64ToBytes(envelope.salt);
    const keyInfo = await deriveKey(password, salt);
    state.vaultItems = await decryptVault(envelope, keyInfo.key);
    state.vaultKey = keyInfo;
    state.vaultUnlocked = true;
    updateVaultStatus();
    render();
    toast("保险箱已解锁");
  } catch (error) {
    console.error(error);
    window.alert("主密码不正确，或保险箱数据已损坏。");
  }
}

function lockVault() {
  state.vaultUnlocked = false;
  state.vaultItems = [];
  state.vaultKey = null;
  updateVaultStatus();
  render();
}

async function exportVault() {
  const raw = localStorage.getItem(STORAGE_KEYS.vault);
  if (!raw) {
    window.alert("当前没有可导出的保险箱。");
    return;
  }

  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `paste-pocket-vault-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importVault(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  JSON.parse(text);
  localStorage.setItem(STORAGE_KEYS.vault, text);
  state.vaultReady = true;
  state.vaultUnlocked = false;
  state.vaultItems = [];
  state.vaultKey = null;
  updateVaultStatus();
  render();
  toast("保险箱备份已导入，请重新输入主密码解锁。");
  event.target.value = "";
}

async function persistVault(forcedSalt) {
  if (!state.vaultKey && !forcedSalt) {
    throw new Error("Vault key missing");
  }

  const salt = forcedSalt ?? state.vaultKey.salt;
  const key = state.vaultKey.key;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state.vaultItems));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const envelope = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  localStorage.setItem(STORAGE_KEYS.vault, JSON.stringify(envelope));
}

async function decryptVault(envelope, key) {
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const buffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text);
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 250000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { key, salt };
}

function updateVaultStatus() {
  if (!state.vaultReady) {
    els.vaultStatus.textContent = "未初始化";
    return;
  }

  els.vaultStatus.textContent = state.vaultUnlocked ? "已解锁，可查看和编辑敏感条目" : "已存在，待解锁";
}

function splitTags(value) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function maskSecret(value) {
  if (!value) {
    return "未填写";
  }
  return "•".repeat(Math.max(8, Math.min(24, value.length)));
}

function toast(message) {
  els.statusToast.textContent = message;
  els.statusToast.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.statusToast.classList.add("hidden");
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
