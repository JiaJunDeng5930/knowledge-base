import assert from "node:assert/strict";
import { buildKnowledgeModel, compareBigintStrings } from "./public/model.js";

assert.equal(compareBigintStrings("9007199254740993", "2"), 1);
assert.equal(compareBigintStrings("-2", "-10"), 1);
assert.equal(compareBigintStrings("-2", "0"), -1);

const snapshot = {
  bullets: [
    { id: "9007199254740993", body: "child two", parent_id: "1", depth: 1, sibling_order: "20" },
    { id: "1", body: "root", parent_id: null, depth: 0, sibling_order: "0" },
    { id: "2", body: "child one", parent_id: "1", depth: 1, sibling_order: "2" },
    { id: "3", body: "other root", parent_id: null, depth: 0, sibling_order: "-1" },
  ],
  references: [
    { source_bullet_id: "1", target_bullet_id: "2" },
    { source_bullet_id: "9007199254740993", target_bullet_id: "1" },
  ],
  effective_tags: [{ bullet_id: "2", tag: "working" }],
  scheduler_configs: [{ id: "5", scheduler: { desired_retention: 0.9 } }],
  fsrs: [{
    id: "10",
    scheduler_config_id: "5",
    state: 2,
    step: null,
    stability_days: 4.5,
    difficulty: 6,
    last_review_at: "2026-08-01T00:00:00Z",
    due_at: "2026-08-05T00:00:00Z",
  }],
  fsrs_bullet: [{ fsrs_id: "10", bullet_id: "2" }],
  fsrs_review: [
    { id: "11", fsrs_id: "10", rating: 3, review_datetime: "2026-08-02T00:00:00Z", review_duration: "1500" },
    { id: "10", fsrs_id: "10", rating: 2, review_datetime: "2026-08-02T00:00:00Z", review_duration: null },
    { id: "9007199254740994", fsrs_id: "10", rating: 4, review_datetime: "2026-08-01T00:00:00Z", review_duration: "900" },
  ],
};

const model = buildKnowledgeModel(snapshot);
assert.equal(model.bulletsById.get("9007199254740993").id, "9007199254740993");
assert.deepEqual(model.rootBullets.map((bullet) => bullet.id), ["3", "1"]);
assert.deepEqual(model.getChildren("1").map((bullet) => bullet.id), ["2", "9007199254740993"]);
assert.deepEqual(model.getPath("9007199254740993").map((part) => part.id), [null, "1", "9007199254740993"]);
assert.deepEqual(model.search("CHILD").map((bullet) => bullet.id), ["9007199254740993", "2"]);
assert.deepEqual(model.outgoingById.get("1"), ["2"]);
assert.deepEqual(model.incomingById.get("1"), ["9007199254740993"]);
assert.deepEqual(model.tagsById.get("2"), ["working"]);
assert.equal(model.schedulerConfigsById.get("5").scheduler.desired_retention, 0.9);
assert.deepEqual(model.bulletsByFsrs.get("10"), ["2"]);
assert.deepEqual(
  model.reviewsByFsrs.get("10").map((review) => review.id),
  ["9007199254740994", "10", "11"],
);
assert.equal(model.reviewsByFsrs.get("10")[1].review_duration, null);

console.log("model tests passed");
