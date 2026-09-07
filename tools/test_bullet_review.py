"""生成在独立 schema 中验证草稿 SQL 的事务，交给已授权 SQL 接口执行。"""
from pathlib import Path
import json
import re
import hashlib

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "skills/knowledge-base/bullet-review"
SCHEMA = "bullet_review_integration_test"
DRAFT_ID = "00000000-0000-4000-8000-000000000111"


def sql(path):
    text = path.read_text().replace("public.", SCHEMA + ".")
    text = text.replace("__BULLET_DRAFT_KEY_SHA256__", hashlib.sha256(b"bullet-review-test-key").hexdigest())
    return re.sub(r"^\s*(?:begin|commit);\s*$", "", text, flags=re.M | re.I)


def save(changes, processed=()):
    text = sql(REVIEW / "queries/save-draft.sql")
    text = text.replace("00000000-0000-4000-8000-000000000000", DRAFT_ID)
    text = text.replace("$changes${}$changes$", "$changes$" + json.dumps(changes, ensure_ascii=False) + "$changes$")
    return text.replace("array[]::text[]", "array[" + ",".join("'" + item + "'" for item in processed) + "]::text[]")


commit = sql(REVIEW / "queries/commit-draft.sql").replace("00000000-0000-4000-8000-000000000000", DRAFT_ID)
commit_block = re.search(r"do \$review\$\s*(.*?)\s*\$review\$;", commit, flags=re.S).group(1)


def expect_commit_failure(prefix):
    return f"""
do $verify$
declare failed boolean := false;
begin
    begin
        {commit_block}
    exception when raise_exception then
        if sqlerrm like '{prefix}%' then failed := true; else raise; end if;
    end;
    if not failed then raise exception 'Expected commit to be rejected'; end if;
end;
$verify$;
"""


parts = ["begin;", f"create schema {SCHEMA};", sql(ROOT / "skills/knowledge-base/schema.sql"), sql(REVIEW / "schema.sql"), f"""
insert into {SCHEMA}.bullet (body,parent_id,depth,sibling_order) values
('根',null,0,1),('a 原文',1,1,1),('移动目标',1,1,2),('待删除',1,1,3),('另一根',null,0,2);
insert into {SCHEMA}.bullet_reference values (2,3);
insert into {SCHEMA}.bullet_tag values (2,'旧标签');
""", sql(REVIEW / "queries/start-draft.sql"), f"update {SCHEMA}.bullet_draft set id = '{DRAFT_ID}';", f"""
grant usage on schema {SCHEMA} to anon;
set local role anon;
do $verify$
declare rejected boolean := false;
begin
    perform set_config('request.headers','{{}}',true);
    begin
        perform count(*) from {SCHEMA}.bullet_draft;
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'Anonymous draft read accepted without credential'; end if;
    rejected := false;
    perform set_config('request.headers','{{"x-bullet-draft-key":"wrong-key"}}',true);
    begin
        perform count(*) from {SCHEMA}.bullet_draft;
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'Incorrect draft credential accepted'; end if;
    perform set_config('request.headers','{{"x-bullet-draft-key":"bullet-review-test-key"}}',true);
    if (select count(*) from {SCHEMA}.bullet_draft) <> 1 then raise exception 'Website credential cannot read draft'; end if;
    if has_table_privilege('anon','{SCHEMA}.bullet_draft','UPDATE') then raise exception 'Website can modify draft'; end if;
end;
$verify$;
reset role;
""",
save({"2": {"body": "c 中间版本"}}),
save({"2": {"body": "b 最新草稿", "tags": ["新标签"]}, "3": {"parent_id": "5"}, "4": None,
      "-1": {"body": "[新增链接](/bullet/-1) [含标题](/bullet/-1 \"标题\")", "parent_id": "1", "depth": 1, "sibling_order": "4", "tags": [], "references": ["3"]}}, ["comment-one"]),
f"""
do $verify$
declare failed boolean := false;
begin
    if (select base->'2'->>'body' <> 'a 原文' or proposed->'2'->>'body' <> 'b 最新草稿'
        or processed_comment_ids <> array['comment-one'] from {SCHEMA}.bullet_draft)
    then raise exception 'Draft revision lost its baseline or receipt'; end if;
    if (select body <> 'a 原文' from {SCHEMA}.bullet where id=2)
    then raise exception 'Saving draft changed knowledge'; end if;
    begin
        update {SCHEMA}.bullet_draft set proposed=jsonb_set(proposed,array['1','parent_id'],'"1"');
    exception when check_violation then failed := true;
    end;
    if not failed then raise exception 'Invalid forest accepted'; end if;
    if has_table_privilege('anon','{SCHEMA}.bullet_draft','INSERT')
        or not has_table_privilege('anon','{SCHEMA}.bullet_draft','SELECT')
    then raise exception 'Website draft permissions incorrect'; end if;
end;
$verify$;
update {SCHEMA}.bullet set body='外部变更' where id=2;
""", expect_commit_failure("Bullet draft base changed;"), f"""
update {SCHEMA}.bullet set body='a 原文' where id=2;
insert into {SCHEMA}.scheduler_config (scheduler) values (jsonb_build_object(
'parameters',to_jsonb(array_fill(1.0,array[21])),'desired_retention',0.9,
'learning_steps','[]'::jsonb,'relearning_steps','[]'::jsonb,'maximum_interval',36500,'enable_fuzzing',true));
insert into {SCHEMA}.fsrs (cue,scheduler_config_id) values ('记忆关联保持独立',1);
insert into {SCHEMA}.fsrs_bullet values (1,4);
""", expect_commit_failure("Bullet draft deletion blocked by an FSRS association"), f"delete from {SCHEMA}.fsrs_bullet where bullet_id=4;", commit,
f"""
set constraints all immediate;
do $verify$
begin
    if (select count(*) from {SCHEMA}.bullet_draft) <> 0 then raise exception 'Submitted draft remains'; end if;
    if (select body from {SCHEMA}.bullet where id=2) <> 'b 最新草稿' then raise exception 'Wrong body committed'; end if;
    if (select parent_id from {SCHEMA}.bullet where id=3) <> 5 then raise exception 'Move lost'; end if;
    if exists (select from {SCHEMA}.bullet where id=4) then raise exception 'Deletion lost'; end if;
    if (select body from {SCHEMA}.bullet where id=6) <> '[新增链接](/bullet/6) [含标题](/bullet/6 "标题")' then raise exception 'Temporary ID link not remapped'; end if;
    if not exists (select from {SCHEMA}.bullet_reference where source_bullet_id=6 and target_bullet_id=3) then raise exception 'New reference lost'; end if;
    if not exists (select from {SCHEMA}.bullet_tag where bullet_id=2 and tag='新标签') then raise exception 'Tags lost'; end if;
    if (select cue from {SCHEMA}.fsrs where id=1) <> '记忆关联保持独立' then raise exception 'FSRS changed'; end if;
end;
$verify$;
select 'passed' as bullet_review_database_checks;
rollback;
"""]

if __name__ == "__main__":
    print("\n".join(parts))
