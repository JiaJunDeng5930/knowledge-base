import assert from "node:assert/strict";
import { buildKnowledgeModel, compareBigintStrings } from "./public/model.js";

assert.equal(compareBigintStrings("9007199254740993", "2"), 1);
assert.equal(compareBigintStrings("-2", "-10"), 1);
assert.equal(compareBigintStrings("-2", "0"), -1);

const snapshot = {
  records: [
    { id: "9007199254740993", body: "child two", parent_id: "1", depth: 1, sibling_order: "20" },
    { id: "1", body: "root", parent_id: null, depth: 0, sibling_order: "0" },
    { id: "2", body: "child one", parent_id: "1", depth: 1, sibling_order: "2" },
    { id: "3", body: "other root", parent_id: null, depth: 0, sibling_order: "-1" },
  ],
  references: [
    { source_record_id: "1", target_record_id: "2" },
    { source_record_id: "9007199254740993", target_record_id: "1" },
  ],
  effective_tags: [{ record_id: "2", tag: "working" }],
  fsrs: [{ id: "10", stability_days: 4.5, difficulty: 6, last_review_at: "2026-08-01T00:00:00Z", due_at: "2026-08-05T00:00:00Z" }],
  fsrs_knowledge: [{ fsrs_id: "10", record_id: "2" }],
};

const model = buildKnowledgeModel(snapshot);
assert.equal(model.recordsById.get("9007199254740993").id, "9007199254740993");
assert.deepEqual(model.rootRecords.map((record) => record.id), ["3", "1"]);
assert.deepEqual(model.getChildren("1").map((record) => record.id), ["2", "9007199254740993"]);
assert.deepEqual(model.getPath("9007199254740993").map((part) => part.id), [null, "1", "9007199254740993"]);
assert.deepEqual(model.search("CHILD").map((record) => record.id), ["9007199254740993", "2"]);
assert.deepEqual(model.outgoingById.get("1"), ["2"]);
assert.deepEqual(model.incomingById.get("1"), ["9007199254740993"]);
assert.deepEqual(model.tagsById.get("2"), ["working"]);
assert.deepEqual(model.recordsByFsrs.get("10"), ["2"]);

console.log("model tests passed");
