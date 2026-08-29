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

function compareRecords(left, right) {
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
  const records = snapshot.records.map((record) => ({ ...record }));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const childrenByParent = new Map();
  for (const record of records) {
    pushMapArray(childrenByParent, record.parent_id, record);
  }
  for (const children of childrenByParent.values()) children.sort(compareRecords);

  const outgoingById = new Map();
  const incomingById = new Map();
  for (const reference of snapshot.references) {
    pushMapArray(outgoingById, reference.source_record_id, reference.target_record_id);
    pushMapArray(incomingById, reference.target_record_id, reference.source_record_id);
  }
  for (const references of outgoingById.values()) {
    references.sort(compareBigintStrings);
  }
  for (const references of incomingById.values()) {
    references.sort(compareBigintStrings);
  }

  const tagsById = new Map();
  for (const tag of snapshot.effective_tags) pushMapArray(tagsById, tag.record_id, tag.tag);
  for (const tags of tagsById.values()) tags.sort((left, right) => left.localeCompare(right));

  const fsrsById = new Map(snapshot.fsrs.map((item) => [item.id, { ...item }]));
  const recordsByFsrs = new Map();
  const fsrsByRecord = new Map();
  for (const relation of snapshot.fsrs_knowledge) {
    pushMapArray(recordsByFsrs, relation.fsrs_id, relation.record_id);
    pushMapArray(fsrsByRecord, relation.record_id, relation.fsrs_id);
  }
  for (const ids of recordsByFsrs.values()) ids.sort(compareBigintStrings);
  for (const ids of fsrsByRecord.values()) ids.sort(compareBigintStrings);

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

  function getPath(recordId) {
    const path = [{ id: null, label: "root" }];
    const lineage = [];
    const seen = new Set();
    let currentId = recordId;
    while (currentId !== null && !seen.has(currentId)) {
      seen.add(currentId);
      const record = recordsById.get(currentId);
      if (!record) break;
      lineage.push({ id: record.id, label: summarize(record.body) });
      currentId = record.parent_id;
    }
    path.push(...lineage.reverse());
    return path;
  }

  function search(query) {
    const needle = String(query).toLowerCase();
    if (!needle) return [];
    return records.filter((record) => record.body.toLowerCase().includes(needle));
  }

  return {
    records,
    recordsById,
    childrenByParent,
    rootRecords: getChildren(null),
    outgoingById,
    incomingById,
    tagsById,
    fsrsById,
    recordsByFsrs,
    fsrsByRecord,
    reviewsByFsrs,
    getChildren,
    getPath,
    search,
  };
}
