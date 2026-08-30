/** 纯视图模型辅助函数；PostgreSQL bigint 在此保持为字符串。 */

export function compareBigintStrings(left, right) {
  const a = String(left);
  const b = String(right);
  const aNegative = a.startsWith("-");
  const bNegative = b.startsWith("-");
  if (aNegative !== bNegative) return aNegative ? -1 : 1;

  const aDigits = (aNegative ? a.slice(1) : a).replace(/^0+(?=\d)/, "");
  const bDigits = (bNegative ? b.slice(1) : b).replace(/^0+(?=\d)/, "");
  let result = 0;
  if (aDigits.length !== bDigits.length) {
    result = aDigits.length < bDigits.length ? -1 : 1;
  } else if (aDigits !== bDigits) {
    result = aDigits < bDigits ? -1 : 1;
  }
  return aNegative ? -result : result;
}

function compareBullets(left, right) {
  return (
    compareBigintStrings(left.sibling_order, right.sibling_order) ||
    compareBigintStrings(left.id, right.id)
  );
}

function pushMapArray(map, key, value) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

export function summarize(body, maxLength = 72) {
  const compact = String(body).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function buildKnowledgeModel(snapshot) {
  const bullets = snapshot.bullets.map((bullet) => ({ ...bullet }));
  const bulletsById = new Map(bullets.map((bullet) => [bullet.id, bullet]));
  const childrenByParent = new Map();
  for (const bullet of bullets) {
    pushMapArray(childrenByParent, bullet.parent_id, bullet);
  }
  for (const children of childrenByParent.values()) children.sort(compareBullets);

  const outgoingById = new Map();
  const incomingById = new Map();
  for (const reference of snapshot.references) {
    pushMapArray(outgoingById, reference.source_bullet_id, reference.target_bullet_id);
    pushMapArray(incomingById, reference.target_bullet_id, reference.source_bullet_id);
  }
  for (const references of outgoingById.values()) {
    references.sort(compareBigintStrings);
  }
  for (const references of incomingById.values()) {
    references.sort(compareBigintStrings);
  }

  const tagsById = new Map();
  for (const tag of snapshot.effective_tags) pushMapArray(tagsById, tag.bullet_id, tag.tag);
  for (const tags of tagsById.values()) tags.sort((left, right) => left.localeCompare(right));

  const schedulerConfigsById = new Map(
    snapshot.scheduler_configs.map((item) => [item.id, { ...item }]),
  );
  const fsrsById = new Map(snapshot.fsrs.map((item) => [item.id, { ...item }]));
  const bulletsByFsrs = new Map();
  const fsrsByBullet = new Map();
  for (const relation of snapshot.fsrs_bullet) {
    pushMapArray(bulletsByFsrs, relation.fsrs_id, relation.bullet_id);
    pushMapArray(fsrsByBullet, relation.bullet_id, relation.fsrs_id);
  }
  for (const ids of bulletsByFsrs.values()) ids.sort(compareBigintStrings);
  for (const ids of fsrsByBullet.values()) ids.sort(compareBigintStrings);

  const reviewsByFsrs = new Map();
  for (const review of snapshot.fsrs_review) {
    pushMapArray(reviewsByFsrs, review.fsrs_id, { ...review });
  }
  for (const reviews of reviewsByFsrs.values()) {
    reviews.sort((left, right) => (
      String(left.review_datetime).localeCompare(String(right.review_datetime)) ||
      compareBigintStrings(left.id, right.id)
    ));
  }

  function getChildren(parentId) {
    return childrenByParent.get(parentId) || [];
  }

  function getPath(bulletId) {
    const path = [{ id: null, label: "root" }];
    const lineage = [];
    const seen = new Set();
    let currentId = bulletId;
    while (currentId !== null && !seen.has(currentId)) {
      seen.add(currentId);
      const bullet = bulletsById.get(currentId);
      if (!bullet) break;
      lineage.push({ id: bullet.id, label: summarize(bullet.body) });
      currentId = bullet.parent_id;
    }
    path.push(...lineage.reverse());
    return path;
  }

  function search(query) {
    const needle = String(query).toLowerCase();
    if (!needle) return [];
    return bullets.filter((bullet) => bullet.body.toLowerCase().includes(needle));
  }

  return {
    bullets,
    bulletsById,
    childrenByParent,
    rootBullets: getChildren(null),
    outgoingById,
    incomingById,
    tagsById,
    schedulerConfigsById,
    fsrsById,
    bulletsByFsrs,
    fsrsByBullet,
    reviewsByFsrs,
    getChildren,
    getPath,
    search,
  };
}
