begin;


-- ============================================================
-- 1. 知识记录
--
-- 知识模型由若干知识记录组成。
-- 每条记录保存一份完整连续文本，并占据有序森林中的一个位置。
--
-- 知识记录只是文本的存储和组织单位。
-- 数据库不把它解释成命题、语义单元、引用单位或 FSRS 单位。
--
-- 历史版本、diff、批注和原始交互记录不属于当前知识模型，
-- 因此不进入这张表。
-- ============================================================

create table public.knowledge_record (
    -- 稳定身份用于父子关系、记录级引用、标签和 FSRS 关联。
    id bigint generated always as identity primary key,

    -- 一条记录中的全部当前文本。
    -- 数据库不继续把正文拆成段落节点或语义节点。
    body text not null,

    -- 当前记录在森林中的直接父节点。
    -- NULL 表示根节点。
    --
    -- 这个字段只保存已经确定的结构关系。
    -- 数据库不规定父子关系在语义上属于解释、例子、抽象或其他关系。
    parent_id bigint,

    -- depth 不属于知识内容。
    --
    -- 它只用于让普通表约束直接保证 parent_id 形成无环森林，
    -- 从而不依赖写入前递归检查或 trigger。
    depth integer not null
        constraint knowledge_record_depth_nonnegative
        check (depth >= 0),

    -- 子节点通过这个生成值引用 depth 恰好小 1 的父节点。
    -- 应用只写 depth，不单独维护 parent_depth。
    parent_depth integer
        generated always as (depth - 1) stored,

    -- 同一父节点的孩子具有确定的线性顺序。
    -- 数值只承担排序作用，不要求连续。
    sibling_order bigint not null,

    -- 根节点的 depth 为 0。
    -- 非根节点的 depth 大于 0。
    constraint knowledge_record_root_shape
        check (
            (parent_id is null and depth = 0)
            or
            (parent_id is not null and depth > 0)
        ),

    -- PostgreSQL 的复合外键要求目标列组具有唯一约束。
    -- id 本身仍然是记录的实际身份。
    constraint knowledge_record_id_depth_key
        unique (id, depth),

    -- 如果 P 是 N 的父节点，则 P.depth = N.depth - 1。
    --
    -- 沿 parent_id 向上移动时，depth 必须持续下降，
    -- 最终到达 depth = 0 的根节点，因此环无法满足这个约束。
    constraint knowledge_record_parent_fk
        foreign key (parent_id, parent_depth)
        references public.knowledge_record (id, depth)
        deferrable initially deferred,

    -- 同一父节点下不能出现两个相同的 sibling_order。
    --
    -- NULLS NOT DISTINCT 使 parent_id 为 NULL 的全部根节点
    -- 也构成一个有序集合。
    constraint knowledge_record_sibling_order_key
        unique nulls not distinct (parent_id, sibling_order)
        deferrable initially deferred
);


-- ============================================================
-- 2. 知识记录之间的引用
--
-- 引用只连接整条知识记录。
-- 它用于让 LLM 从当前记录拉起其他相关记录并继续探索。
--
-- 引用不保存正文中的精确位置，也不保存关系类型。
-- 具体相关性继续由知识文本表达并由 LLM 解释。
-- ============================================================

create table public.knowledge_reference (
    -- 发出引用的知识记录。
    source_record_id bigint not null
        references public.knowledge_record (id),

    -- 被引用的知识记录。
    target_record_id bigint not null
        references public.knowledge_record (id),

    -- 同一来源和目标之间只保存一条记录级引用。
    primary key (source_record_id, target_record_id)
);


-- 主键索引已经适合从 source_record_id 查询它引用的全部记录。
--
-- 这个反向索引适合从 target_record_id 查询全部反向链接。
create index knowledge_reference_target_idx
    on public.knowledge_reference (
        target_record_id,
        source_record_id
    );


-- ============================================================
-- 3. 标签
--
-- 标签直接附着在知识记录上。
-- 一个节点拥有的标签同时对它的全部后代生效。
--
-- working text 不再是独立实体。
-- 给某个节点添加 working 标签后，该节点的整棵子树都可以作为
-- working 内容查询。
-- ============================================================

create table public.record_tag (
    -- 被直接打标签的记录。
    record_id bigint not null
        references public.knowledge_record (id),

    -- 标签本身只需要一个名称。
    -- 当前模型没有要求标签拥有其他独立属性。
    tag text not null,

    -- 同一记录不能重复拥有同一个直接标签。
    primary key (record_id, tag)
);


-- 主键索引适合查询一条记录直接拥有的标签。
--
-- 这个索引适合从标签查询直接被标记的记录，
-- 也是查询某个标签整片子树的入口。
create index record_tag_tag_idx
    on public.record_tag (
        tag,
        record_id
    );


-- 这里只持久化直接标签。
-- 有效标签通过森林结构实时得到，不给每个后代复制一份标签。
create view public.effective_record_tag as
with recursive inherited_tag (record_id, tag) as (
    -- 直接标签首先对记录自身生效。
    select
        record_id,
        tag
    from public.record_tag

    union

    -- 一条有效标签继续传递给当前记录的直接孩子，
    -- 递归后自然覆盖全部子孙节点。
    select
        child.id,
        inherited_tag.tag
    from inherited_tag
    join public.knowledge_record as child
      on child.parent_id = inherited_tag.record_id
)
select
    record_id,
    tag
from inherited_tag;


-- ============================================================
-- 4. FSRS-6 对象
--
-- 一条 fsrs 记录表示一个独立的间隔重复调度对象。
-- 它保存自己的 FSRS-6 当前状态。
--
-- FSRS 对象的粒度与知识记录的存储粒度相互独立。
-- 它需要哪些知识内容，由后面的 fsrs_knowledge 关系表达。
--
-- 当前 schema 只保存当前状态。
-- 历次复习及旧状态属于历史记录，不放在这里。
-- ============================================================

create table public.fsrs (
    id bigint generated always as identity primary key,

    -- FSRS-6 的 Stability。
    -- 单位为天，表示记忆稳定性。
    stability_days double precision not null
        constraint fsrs_stability_valid
        check (
            stability_days > 0
            and stability_days < 'Infinity'::double precision
        ),

    -- FSRS-6 的 Difficulty。
    difficulty double precision not null
        constraint fsrs_difficulty_valid
        check (difficulty between 1.0 and 10.0),

    -- 当前 Stability 和 Difficulty 所对应的最后一次复习时间。
    last_review_at timestamptz not null
        constraint fsrs_last_review_finite
        check (isfinite(last_review_at)),

    -- 当前调度产生的下一次复习时间。
    -- 保存这个结果可以直接查询已经到期的 FSRS 对象。
    due_at timestamptz not null
        constraint fsrs_due_valid
        check (
            isfinite(due_at)
            and due_at >= last_review_at
        )
);


create index fsrs_due_idx
    on public.fsrs (due_at);


-- ============================================================
-- 5. FSRS 对象与知识记录的关联
--
-- 一个 FSRS 对象关联一条或多条知识记录。
-- 同一条知识记录也可以同时关联多个 FSRS 对象。
--
-- FSRS 当前状态只保存在 public.fsrs 中。
-- 这张表只回答某个 FSRS 在复习时需要取用哪些知识记录。
-- ============================================================

create table public.fsrs_knowledge (
    fsrs_id bigint not null
        references public.fsrs (id),

    record_id bigint not null
        references public.knowledge_record (id),

    -- 同一 FSRS 与同一知识记录之间只保存一次关联。
    primary key (fsrs_id, record_id)
);


-- 主键 (fsrs_id, record_id) 已经适合从一个 FSRS
-- 查询它关联的全部知识记录。
--
-- 这个反向索引适合从一条知识记录查询关联它的全部 FSRS。
create index fsrs_knowledge_record_idx
    on public.fsrs_knowledge (
        record_id,
        fsrs_id
    );


-- 已经确定的模型要求每个 FSRS 至少关联一条知识记录。
--
-- 普通 CHECK 和外键不能从 public.fsrs 的一行反向约束
-- public.fsrs_knowledge 中必须存在子行。
-- 为避免引入没有语义依据的“主要知识记录”字段或 trigger，
-- 创建 FSRS 时需要在同一事务中同时写入至少一条关联。


commit;
