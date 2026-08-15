import {
  buildKnowledgeModel,
  summarize,
} from "/model.js";

const mainPanel = document.querySelector("#main-panel");
const contextPanel = document.querySelector("#context-panel");
const searchInput = document.querySelector("#search-input");
const searchResults = document.querySelector("#search-results");

const initialMainRoute = parseRoute(window.location.pathname);
const state = {
  model: null,
  mainRoute: initialMainRoute,
  rightRoute: null,
  expanded: {
    main: expandedForRoute(initialMainRoute),
    right: new Set(),
  },
  openRelations: new Set(),
  error: null,
};

function element(tag, className, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function parseRoute(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/root") return { kind: "root" };
  const record = path.match(/^\/record\/(-?[0-9]+)$/);
  if (record) return { kind: "record", id: record[1] };
  const fsrs = path.match(/^\/fsrs\/(-?[0-9]+)$/);
  if (fsrs) return { kind: "fsrs", id: fsrs[1] };
  return { kind: "unknown" };
}

function routePath(route) {
  if (route.kind === "root") return "/root";
  if (route.kind === "record") return `/record/${encodeURIComponent(route.id)}`;
  if (route.kind === "fsrs") return `/fsrs/${encodeURIComponent(route.id)}`;
  return "/root";
}

function panelState(panelName) {
  return panelName === "main" ? state.expanded.main : state.expanded.right;
}

function expandedForRoute(route) {
  return new Set(route.kind === "fsrs" ? [`fsrs:${route.id}`] : []);
}

function openRoute(route, panelName = "main", replace = false) {
  if (route.kind === "unknown") return;
  if (panelName === "main") {
    state.mainRoute = route;
    state.expanded.main = expandedForRoute(route);
    state.openRelations = new Set();
    if (replace) window.history.replaceState({}, "", routePath(route));
    else window.history.pushState({}, "", routePath(route));
  } else {
    state.rightRoute = route;
    state.expanded.right = expandedForRoute(route);
  }
  render();
}

function closeRight() {
  state.rightRoute = null;
  state.expanded.right = new Set();
  render();
}

function appendBreadcrumb(container, route, panelName) {
  if (route.kind === "fsrs") {
    container.append(element("span", "breadcrumb-label", "fsrs"));
    container.append(element("span", "breadcrumb-separator", "/"));
    container.append(element("span", "breadcrumb-label", route.id));
    return;
  }
  const trail = route.kind === "record" && state.model
    ? state.model.getPath(route.id)
    : [{ id: null, label: "root" }];
  trail.forEach((part, index) => {
    if (index > 0) container.append(element("span", "breadcrumb-separator", "/"));
    const link = element("button", "breadcrumb-link", part.label);
    link.type = "button";
    if (part.id === null) {
      link.addEventListener("click", () => openRoute({ kind: "root" }, panelName));
    } else {
      link.addEventListener("click", () => openRoute({ kind: "record", id: part.id }, panelName));
    }
    container.append(link);
  });
}

function renderPanelHeader(panelName, route) {
  const header = element("header", "panel-header");
  const top = element("div", "panel-header-top");
  const breadcrumb = element("nav", "breadcrumbs");
  breadcrumb.setAttribute("aria-label", "当前位置");
  appendBreadcrumb(breadcrumb, route, panelName);
  top.append(breadcrumb);
  if (panelName === "right") {
    const close = element("button", "icon-button", "×");
    close.type = "button";
    close.title = "关闭右栏";
    close.setAttribute("aria-label", "关闭右栏");
    close.addEventListener("click", closeRight);
    top.append(close);
  }
  header.append(top);

  const title = element("h1", "panel-title");
  if (route.kind === "root") title.textContent = "知识库根目录";
  else if (route.kind === "record") {
    const record = state.model.recordsById.get(route.id);
    title.textContent = record ? record.body : `记录 ${route.id}`;
  } else if (route.kind === "fsrs") title.textContent = `FSRS ${route.id}`;
  else title.textContent = "未知路径";
  header.append(title);

  const hint = element("p", "panel-hint");
  if (route.kind === "root") hint.textContent = "有序森林的根节点";
  else if (route.kind === "record") hint.textContent = "记录正文保持原样显示；点击正文可 zoom。";
  else if (route.kind === "fsrs") hint.textContent = "只读调度状态与关联知识记录";
  header.append(hint);
  return header;
}

function renderMetaPopover(item, record) {
  const popover = element("div", "record-popover");
  const details = [
    ["id", record.id],
    ["parent_id", record.parent_id === null ? "null" : record.parent_id],
    ["depth", String(record.depth)],
    ["sibling_order", record.sibling_order],
    ["子节点", String(state.model.getChildren(record.id).length)],
    ["父链", state.model.getPath(record.id).map((part) => part.label).join(" / ")],
  ];
  for (const [name, value] of details) {
    const line = element("div", "meta-line");
    line.append(element("span", "meta-key", name));
    line.append(element("span", "meta-value", value));
    popover.append(line);
  }
  item.append(popover);
}

function recordLink(record, panelName, className = "preview-link", label = summarize(record.body)) {
  const link = element("button", className, label);
  link.type = "button";
  link.dataset.recordId = record.id;
  link.addEventListener("click", (event) => {
    if (event.shiftKey) openRoute({ kind: "record", id: record.id }, "right");
    else openRoute({ kind: "record", id: record.id }, panelName);
  });
  return link;
}

function relationKey(panelName, recordId, kind) {
  return `${panelName}:${recordId}:${kind}`;
}

function renderRelated(item, record, panelName, kind, ids) {
  if (!ids.length) return;
  const key = relationKey(panelName, record.id, kind);
  if (!state.openRelations.has(key)) return;
  const section = element("section", "related-preview");
  section.append(element("h4", "related-title", kind === "outgoing" ? "直接引用" : "反向链接"));
  const list = element("div", "preview-list");
  for (const id of ids) {
    const target = state.model.recordsById.get(id);
    if (!target) continue;
    const card = element("div", "preview-card");
    card.append(recordLink(target, panelName));
    card.append(element("span", "preview-id", `#${target.id}`));
    list.append(card);
  }
  if (list.childElementCount) section.append(list);
  item.append(section);
}

function renderRecordNode(parent, record, panelName) {
  const item = element("article", "record-item");
  item.dataset.recordId = record.id;
  const children = state.model.getChildren(record.id);
  const expanded = panelState(panelName).has(record.id);
  const row = element("div", "record-row");

  const caret = element("button", children.length ? "caret" : "bullet", children.length ? (expanded ? "⌄" : "›") : "•");
  caret.type = "button";
  caret.setAttribute("aria-label", children.length ? (expanded ? "折叠子节点" : "展开子节点") : "无子节点");
  caret.setAttribute("aria-expanded", children.length ? String(expanded) : "false");
  caret.disabled = !children.length;
  if (children.length) {
    caret.addEventListener("click", () => {
      const expandedSet = panelState(panelName);
      if (expandedSet.has(record.id)) expandedSet.delete(record.id);
      else expandedSet.add(record.id);
      render();
    });
  }
  const marker = element("span", "record-marker");
  marker.append(caret);
  renderMetaPopover(marker, record);
  row.append(marker);

  const body = recordLink(record, panelName, "record-body", record.body);
  body.title = "点击 zoom；Shift-click 在右栏打开";
  row.append(body);

  const tags = state.model.tagsById.get(record.id) || [];
  if (tags.length) {
    const tagList = element("span", "tag-list");
    for (const tag of tags) tagList.append(element("span", "tag", tag));
    row.append(tagList);
  }

  const counts = element("div", "record-counts");
  const outgoing = state.model.outgoingById.get(record.id) || [];
  const incoming = state.model.incomingById.get(record.id) || [];
  for (const [kind, ids, label] of [["outgoing", outgoing, "引用"], ["incoming", incoming, "反向链接"]]) {
    if (!ids.length) continue;
    const button = element("button", "count-button", `${label} ${ids.length}`);
    button.type = "button";
    button.title = "展开直接记录预览";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = relationKey(panelName, record.id, kind);
      if (state.openRelations.has(key)) state.openRelations.delete(key);
      else state.openRelations.add(key);
      render();
    });
    counts.append(button);
  }
  row.append(counts);
  item.append(row);
  if (expanded) {
    const list = element("div", "record-children");
    for (const child of children) renderRecordNode(list, child, panelName);
    item.append(list);
  }
  renderRelated(item, record, panelName, "outgoing", outgoing);
  renderRelated(item, record, panelName, "incoming", incoming);
  parent.append(item);
}

function renderRecordReferences(container, record, panelName) {
  const section = element("section", "references-section");
  section.append(element("h2", "section-title", "当前记录的直接关系"));
  const outgoing = state.model.outgoingById.get(record.id) || [];
  const incoming = state.model.incomingById.get(record.id) || [];
  for (const [kind, ids, title] of [["outgoing", outgoing, "直接引用"], ["incoming", incoming, "反向链接"]]) {
    const group = element("div", "reference-group");
    group.append(element("h3", "reference-title", `${title}（${ids.length}）`));
    if (!ids.length) {
      group.append(element("p", "empty-copy", "没有直接记录关系。"));
      section.append(group);
      continue;
    }
    const list = element("div", "preview-list");
    for (const id of ids) {
      const target = state.model.recordsById.get(id);
      if (!target) continue;
      const card = element("div", "preview-card");
      card.append(recordLink(target, panelName));
      card.append(element("span", "preview-id", `#${target.id}`));
      list.append(card);
    }
    group.append(list);
    section.append(group);
  }
  container.append(section);
}

function renderTreePanel(container, route, panelName) {
  const list = element("div", "outline");
  const focusedRecord = route.kind === "record" ? state.model.recordsById.get(route.id) : null;
  const roots = route.kind === "record"
    ? (focusedRecord ? state.model.getChildren(focusedRecord.id) : [])
    : state.model.rootRecords;
  if (!roots.length) {
    const empty = element("div", "empty-state");
    const missingRecord = route.kind === "record" && !focusedRecord;
    empty.append(element("span", "empty-mark", missingRecord ? "?" : "∅"));
    empty.append(element("h2", "empty-title", missingRecord ? "记录不存在" : route.kind === "record" ? "没有子节点" : "根目录为空"));
    empty.append(element("p", "empty-copy", missingRecord ? "该记录不在当前知识库快照中。" : route.kind === "record" ? "当前记录没有直接子节点。" : "当前快照没有知识记录。"));
    list.append(empty);
  } else {
    for (const record of roots) renderRecordNode(list, record, panelName);
  }
  container.append(list);
  if (route.kind === "record" && state.model.recordsById.has(route.id)) {
    renderRecordReferences(container, state.model.recordsById.get(route.id), panelName);
  }
}

function renderFsrsPanel(container, route, panelName) {
  const fsrs = state.model.fsrsById.get(route.id);
  if (!fsrs) {
    const empty = element("div", "empty-state");
    empty.append(element("span", "empty-mark", "?"));
    empty.append(element("h2", "empty-title", "FSRS 对象不存在"));
    empty.append(element("p", "empty-copy", "该 FSRS 对象不在当前知识库快照中。"));
    container.append(empty);
    return;
  }
  const detail = element("section", "fsrs-detail");
  const fields = [
    ["id", fsrs.id],
    ["Stability", `${fsrs.stability_days} 天`],
    ["Difficulty", String(fsrs.difficulty)],
    ["最后复习", fsrs.last_review_at],
    ["下次到期", fsrs.due_at],
  ];
  for (const [name, value] of fields) {
    const field = element("div", "fsrs-field");
    field.append(element("span", "meta-key", name));
    field.append(element("span", "fsrs-value", value));
    detail.append(field);
  }
  container.append(detail);

  const relationIds = state.model.recordsByFsrs.get(fsrs.id) || [];
  const linked = element("section", "fsrs-links");
  const linkedHeader = element("div", "fsrs-links-header");
  const fsrsKey = `fsrs:${fsrs.id}`;
  const expanded = panelState(panelName).has(fsrsKey);
  const caret = element("button", relationIds.length ? "caret" : "bullet", relationIds.length ? (expanded ? "⌄" : "›") : "•");
  caret.type = "button";
  caret.setAttribute("aria-label", relationIds.length ? (expanded ? "折叠关联记录" : "展开关联记录") : "没有关联记录");
  caret.setAttribute("aria-expanded", relationIds.length ? String(expanded) : "false");
  caret.disabled = !relationIds.length;
  if (relationIds.length) {
    caret.addEventListener("click", () => {
      const expandedSet = panelState(panelName);
      if (expandedSet.has(fsrsKey)) expandedSet.delete(fsrsKey);
      else expandedSet.add(fsrsKey);
      render();
    });
  }
  linkedHeader.append(caret);
  linkedHeader.append(element("h2", "section-title", `关联知识记录（${relationIds.length}）`));
  linked.append(linkedHeader);
  if (!relationIds.length) {
    linked.append(element("p", "empty-copy", "该 FSRS 对象没有关联知识记录。"));
  } else if (expanded) {
    const list = element("div", "outline fsrs-records");
    for (const id of relationIds) {
      const record = state.model.recordsById.get(id);
      if (!record) continue;
      renderRecordNode(list, record, panelName);
    }
    linked.append(list);
  }
  container.append(linked);
}

function renderPanel(panelName) {
  const panel = panelName === "main" ? mainPanel : contextPanel;
  const route = panelName === "main" ? state.mainRoute : state.rightRoute;
  panel.replaceChildren();
  if (panelName === "right" && !route) {
    const empty = element("div", "context-empty");
    empty.append(element("span", "context-empty-mark", "↗"));
    empty.append(element("h2", null, "右栏上下文"));
    empty.append(element("p", null, "按住 Shift 点击记录，在这里打开第二个只读上下文。"));
    panel.append(empty);
    return;
  }
  if (!state.model) {
    panel.append(element("div", "panel-loading", "正在读取知识库…"));
    return;
  }
  const frame = element("div", "panel-frame");
  frame.append(renderPanelHeader(panelName, route));
  if (route.kind === "fsrs") renderFsrsPanel(frame, route, panelName);
  else renderTreePanel(frame, route, panelName);
  panel.append(frame);
}

function renderSearch() {
  const query = searchInput.value;
  if (!query || !state.model) {
    searchResults.hidden = true;
    searchResults.replaceChildren();
    return;
  }
  const results = state.model.search(query);
  searchResults.replaceChildren();
  searchResults.hidden = false;
  const header = element("div", "search-results-header");
  header.append(element("strong", null, `${results.length} 条结果`));
  header.append(element("span", "search-help", "Enter 打开第一条；Shift-Enter 在右栏打开"));
  searchResults.append(header);
  if (!results.length) {
    searchResults.append(element("p", "search-empty", "没有匹配的知识记录。"));
    return;
  }
  const list = element("div", "search-result-list");
  for (const record of results) {
    const item = element("article", "search-result");
    const link = recordLink(record, "main", "search-result-body");
    item.append(link);
    const metadata = element("div", "search-result-meta");
    metadata.append(element("span", null, `#${record.id}`));
    metadata.append(element("span", null, state.model.getPath(record.id).map((part) => part.label).join(" / ")));
    metadata.append(element("span", null, `引用 ${ (state.model.outgoingById.get(record.id) || []).length }`));
    item.append(metadata);
    list.append(item);
  }
  searchResults.append(list);
}

function render() {
  document.title = state.mainRoute.kind === "record" && state.model?.recordsById.has(state.mainRoute.id)
    ? state.model.recordsById.get(state.mainRoute.id).body
    : "Knowledge Viewer";
  renderPanel("main");
  renderPanel("right");
  renderSearch();
}

function currentFocusedRecordId() {
  const active = document.activeElement?.closest?.("[data-record-id]");
  return active?.dataset.recordId || null;
}

function zoomIn() {
  if (!state.model) return;
  const id = currentFocusedRecordId();
  if (!id || !state.model.recordsById.has(id)) return;
  openRoute({ kind: "record", id }, "main");
}

function zoomOut() {
  if (!state.model) return;
  if (!currentFocusedRecordId()) return;
  if (state.mainRoute.kind !== "record") return;
  const record = state.model.recordsById.get(state.mainRoute.id);
  if (!record) return;
  openRoute(record.parent_id === null ? { kind: "root" } : { kind: "record", id: record.parent_id }, "main");
}

window.addEventListener("popstate", () => {
  state.mainRoute = parseRoute(window.location.pathname);
  state.expanded.main = expandedForRoute(state.mainRoute);
  state.openRelations = new Set();
  render();
});

document.addEventListener("click", (event) => {
  const routeLink = event.target.closest?.("[data-nav-route]");
  if (!routeLink) return;
  event.preventDefault();
  openRoute({ kind: "root" }, "main");
});

searchInput.addEventListener("input", renderSearch);
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const results = state.model?.search(searchInput.value) || [];
  if (!results.length) return;
  event.preventDefault();
  openRoute({ kind: "record", id: results[0].id }, event.shiftKey ? "right" : "main");
});

window.addEventListener("keydown", (event) => {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  const macZoomIn = isMac && event.metaKey && event.shiftKey && (event.key === "." || event.key === ">");
  const macZoomOut = isMac && event.metaKey && event.shiftKey && (event.key === "," || event.key === "<");
  const otherZoomIn = !isMac && event.altKey && event.key === "ArrowRight";
  const otherZoomOut = !isMac && event.altKey && event.key === "ArrowLeft";
  if (macZoomIn || otherZoomIn) {
    event.preventDefault();
    zoomIn();
  } else if (macZoomOut || otherZoomOut) {
    event.preventDefault();
    zoomOut();
  }
});

async function loadSnapshot() {
  try {
    const response = await fetch("/api/snapshot", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("snapshot unavailable");
    const snapshot = await response.json();
    state.model = buildKnowledgeModel(snapshot);
  } catch (_error) {
    state.error = "知识库快照暂时不可用，请检查本地服务配置。";
  }
  if (state.error) {
    mainPanel.replaceChildren();
    const error = element("div", "empty-state");
    error.append(element("span", "empty-mark", "!"));
    error.append(element("h2", "empty-title", "无法读取知识库"));
    error.append(element("p", "empty-copy", state.error));
    mainPanel.append(error);
    contextPanel.replaceChildren();
    return;
  }
  render();
}

loadSnapshot();
