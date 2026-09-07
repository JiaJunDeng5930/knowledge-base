import assert from 'node:assert/strict';
import test from 'node:test';
import { readPanels, readingUrl, followPanel, bulletTitle, searchBullets, splitBulletContent, resultExcerpt } from '../lib/reading-path.ts';
import { highlightMarkdownText } from '../lib/reading-highlight.ts';
import { fetchSupabaseSnapshot, SNAPSHOT_QUERIES } from '../lib/supabase-snapshot.ts';
import { buildKnowledgeModel, compareBigintStrings } from '../lib/knowledge-model.js';

const empty = {bullets:[],references:[],effective_tags:[],scheduler_configs:[],fsrs:[],fsrs_bullet:[],fsrs_review:[]};
const bullet = (id, body, parent_id = null, sibling_order = id) => ({id, body, parent_id, depth: parent_id ? 1 : 0, sibling_order});

test('阅读路径可以还原 bigint、中文标签和旧地址', () => {
  const path = [{kind:'index'},{kind:'bullet',id:'9223372036854775807'},{kind:'fsrs',id:'-9'},{kind:'tag',tag:'中文 / working & ?'}];
  assert.deepEqual(readPanels(new URL(readingUrl(path),'https://example.test')), path);
  assert.deepEqual(readPanels(new URL('https://example.test/bullet/-9007199254740993')), [{kind:'bullet',id:'-9007199254740993'}]);
  assert.deepEqual(readPanels(new URL('https://example.test/?p=b:invalid')), [{kind:'index'}]);
});

test('沿关联打开新分支，并保留先前面板；循环引用只定位已有笔记', () => {
  const a = {kind:'bullet',id:'1'}, b = {kind:'bullet',id:'2'}, c = {kind:'bullet',id:'3'};
  const original = [{kind:'index'},a,b];
  assert.deepEqual(followPanel(original,1,c), {panels:[{kind:'index'},a,c],active:2});
  const repeated = followPanel(original,2,a);
  assert.equal(repeated.panels,original);
  assert.equal(repeated.active,1);
  assert.deepEqual(followPanel(original,-1,c),{panels:[c],active:0});
});

test('上下文定位与中文搜索可复制还原，已有父级定位保留阅读分支', () => {
  const path = [{kind:'index'}, {kind:'bullet',id:'9007199254740993',focus:'-9223372036854775808',highlight:'foo_bar *const T / 中文 ? @ &'}];
  assert.deepEqual(readPanels(new URL(readingUrl(path),'https://example.test')),path);
  const previous = [{kind:'bullet',id:'1'}, {kind:'bullet',id:'2'}, {kind:'bullet',id:'3'}];
  const located = followPanel(previous,2,{kind:'bullet',id:'1',focus:'2'});
  assert.equal(located.active,0);
  assert.deepEqual(located.panels,[{kind:'bullet',id:'1',focus:'2'}, previous[1],previous[2]]);
});

test('自然语言正文不截断、不伪造标题，短结果不重复摘要', () => {
  const prose='编译器通过调用位置和使用上下文来约束类型，而不是执行程序。';
  assert.deepEqual(splitBulletContent(prose),{heading:null,content:prose});
  assert.equal(resultExcerpt('类型推断','类型'),'');
  const long='长段落。'.repeat(100);
  assert.deepEqual(splitBulletContent(long),{heading:null,content:long});
  assert.deepEqual(splitBulletContent('# 一个明确标题\n\n完整正文。'),{heading:'一个明确标题',content:'完整正文。'});
  const code='```rust\nlet foo_bar: *const T;\n```';
  assert.deepEqual(splitBulletContent(code),{heading:null,content:code});
  assert.deepEqual(splitBulletContent('- 第一条\n- 第二条'),{heading:null,content:'- 第一条\n- 第二条'});
});

test('搜索高亮保留原文与代码空白，正确处理正则符号和重复关键词', () => {
  const original='  let foo_bar: *const T;\n  foo_bar + [T]';
  const tree={type:'root',children:[{type:'element',tagName:'code',children:[{type:'text',value:original}]}]};
  highlightMarkdownText(tree,'foo_bar *const [T] foo_bar');
  const flatten=node=>node.value ?? (node.children||[]).map(flatten).join('');
  assert.equal(flatten(tree),original);
  const marks=tree.children[0].children.filter(node=>node.tagName==='mark');
  assert.equal(marks.length,4);
  assert.ok(marks.every(node=>node.properties['data-knowledge-match']==='true'));
});

test('正文与检索保留 Rust 标识符、指针符号及长段落', () => {
  assert.equal(bulletTitle('`foo_bar` 与 `*const T`'),'foo_bar 与 *const T');
  assert.equal(splitBulletContent('标题\n\n原文\n下一行').content,'原文\n下一行');
  const body='内容'.repeat(150);
  assert.equal(splitBulletContent(body).content,body);
  const code='```rust\nlet foo_bar = 1;\n```';
  assert.equal(splitBulletContent(code).content,code);
  assert.equal(bulletTitle(code),'代码片段 · rust');
  const notes=[bullet('1','函数\n类型推断从调用和上下文取得约束'),bullet('2','类型推断'),bullet('9007199254740993','精确编号')];
  assert.deepEqual(searchBullets(notes,'类型 推断').map(b=>b.id),['2','1']);
  assert.deepEqual(searchBullets(notes,'#9007199254740993').map(b=>b.id),['9007199254740993']);
});

test('有序森林、双向引用、有效标签与 FSRS 多对多关系保持独立', () => {
  const model=buildKnowledgeModel({...empty,
    bullets:[bullet('9','父节点'),bullet('9007199254740993','后节点','9','9007199254740993'),bullet('9007199254740992','先节点','9','9007199254740992')],
    references:[{source_bullet_id:'9',target_bullet_id:'9007199254740993'}],
    effective_tags:[{bullet_id:'9',tag:'working'},{bullet_id:'9007199254740993',tag:'working'}],
    scheduler_configs:[{id:'1',scheduler:{}}],
    fsrs:[{id:'1',scheduler_config_id:'1',cue:'场景甲'},{id:'2',scheduler_config_id:'1',cue:'场景乙'}],
    fsrs_bullet:[{fsrs_id:'1',bullet_id:'9'},{fsrs_id:'1',bullet_id:'9007199254740993'},{fsrs_id:'2',bullet_id:'9'}],
    fsrs_review:[{id:'2',fsrs_id:'1',review_datetime:'2026-09-02T12:00:00Z'},{id:'1',fsrs_id:'1',review_datetime:'2026-09-01T12:00:00Z'}]
  });
  assert.equal(compareBigintStrings('9007199254740992','9007199254740993'),-1);
  assert.deepEqual(model.getChildren('9').map(b=>b.id),['9007199254740992','9007199254740993']);
  assert.deepEqual(model.getSubtree(null).map(b=>b.id),['9','9007199254740992','9007199254740993']);
  assert.deepEqual(model.getSubtree('9').map(b=>b.id),['9007199254740992','9007199254740993']);
  assert.deepEqual(model.getPath('9007199254740993').map(b=>b.id),[null,'9','9007199254740993']);
  assert.deepEqual(model.incomingById.get('9007199254740993'),['9']);
  assert.deepEqual(model.tagsById.get('9007199254740993'),['working']);
  assert.deepEqual(model.fsrsByBullet.get('9'),['1','2']);
  assert.deepEqual(model.bulletsByFsrs.get('1'),['9','9007199254740993']);
  assert.equal(model.fsrsById.get('2').cue,'场景乙');
  assert.deepEqual(model.reviewsByFsrs.get('1').map(r=>r.id),['1','2']);
});

test('固定读取七张表，服务端分页直到空页，保留 bigint 与 cue', async () => {
  const calls=[];
  const result=await fetchSupabaseSnapshot('https://example.test','sb_publishable_test',async (url,options) => {
    calls.push({url,options});
    const offset=Number(url.searchParams.get('offset'));
    if(url.pathname.endsWith('/bullet') && offset<2) return Response.json([bullet(String(9007199254740992n+BigInt(offset)),'内容')]);
    if(url.pathname.endsWith('/fsrs') && offset===0) return Response.json([{id:'1',scheduler_config_id:'1',cue:'场景线索'}]);
    return Response.json([]);
  });
  assert.equal(result.bullets.length,2);
  assert.equal(result.bullets[1].id,'9007199254740993');
  assert.equal(result.fsrs[0].cue,'场景线索');
  assert.equal(new Set(calls.map(c=>c.url.pathname)).size,7);
  assert.ok(calls.every(c=>(c.options.method||'GET')==='GET' && c.options.headers.apikey==='sb_publishable_test' && !c.options.headers.Authorization));
  assert.ok(calls.some(c=>c.url.pathname.endsWith('/bullet') && c.url.searchParams.get('offset')==='2'));
  assert.ok(SNAPSHOT_QUERIES.find(q=>q[0]==='fsrs')[2].includes('cue'));
});

test('拒绝部分失败和已经丢失精度的 ID，不把上游细节交给读者', async () => {
  await assert.rejects(fetchSupabaseSnapshot('https://example.test','sb_publishable_test',async url => url.pathname.endsWith('/fsrs') ? new Response('secret upstream body',{status:403}) : Response.json([])), /Knowledge snapshot upstream unavailable/);
  await assert.rejects(fetchSupabaseSnapshot('https://example.test','sb_publishable_test',async () => Response.json([{id:9007199254740992}])), /invalid bigint/);
});
