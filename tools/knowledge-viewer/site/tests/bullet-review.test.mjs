import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=buildSync({stdin:{contents:`
export * from './lib/bullet-review';
export * from './lib/bullet-review-store';
export * from './lib/supabase-draft';
export * from './components/reader-presentation/bullet-review';
export * from './components/reader-presentation/page-content/model';
export * from './components/reader-presentation/page-content/block-list';
export * from './components/bullet-review-context';
export * from './components/reading-view';
export {buildKnowledgeModel} from './lib/knowledge-model';
`,resolveDir:root,loader:'tsx'},absWorkingDir:root,bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',write:false}).outputFiles[0].text;
const directory=mkdtempSync(root+'node_modules/.bullet-review-test-');
let code;
try {writeFileSync(directory+'/bundle.mjs',bundle);code=await import(pathToFileURL(directory+'/bundle.mjs').href);} finally {rmSync(directory,{recursive:true,force:true});}
const {bulletChanges,previewSnapshot,parseBulletDraft,readBulletReview,saveReviewComment,parseCommentInput,fetchSupabaseDraft,buildKnowledgeModel,buildPageBlocks,ReviewBulletContent,PageBulletList,BulletReviewContext,ReadingViewProvider}=code;
const row=(body,parent_id=null,depth=0,sibling_order='1')=>({body,parent_id,depth,sibling_order,tags:[],references:[]});
const empty={bullets:[],references:[],effective_tags:[],fsrs:[],fsrs_bullet:[],fsrs_review:[],scheduler_configs:[],fetched_at:'2026-09-07T00:00:00Z'};
const draft=(base,proposed=structuredClone(base))=>({id:'00000000-0000-4000-8000-000000000111',base,proposed,processed_comment_ids:[],updated_at:'2026-09-07T00:00:00Z'});
function sqliteD1() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(root+'drizzle/0000_bullet_review_comment.sql','utf8'));
  const prepare=(sql,values=[])=>({bind:(...args)=>prepare(sql,args),all:async()=>({results:sqlite.prepare(sql).all(...values)}),first:async()=>sqlite.prepare(sql).get(...values)||null,run:async()=>sqlite.prepare(sql).run(...values)});
  return {prepare,batch:async statements=>{sqlite.exec('BEGIN');try {const results=await Promise.all(statements.map(statement=>statement.run()));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close:()=>sqlite.close()};
}

test('草稿反复修改始终比较最初的 a 与最新 b；撤销修改后不留下 diff',()=>{
  const value=draft({'1':row('a')});
  value.proposed['1'].body='c';
  assert.equal(bulletChanges(value).get('1').after.body,'c');
  value.proposed['1'].body='b';
  const change=bulletChanges(value).get('1');
  assert.equal(change.before.body,'a');assert.equal(change.after.body,'b');
  value.proposed['1'].body='a';assert.equal(bulletChanges(value).size,0);
});

test('预览保留删除位置，并同时显示移动前后位置和完整下级',()=>{
  const value=draft({'1':row('父一'),'2':row('移动内容','1',1),'3':row('完整后代','2',2),'4':row('删除内容','1',1,'2'),'5':row('父二',null,0,'2')});
  value.proposed['2'].parent_id='5';delete value.proposed['4'];
  const model=buildKnowledgeModel(previewSnapshot(empty,value));
  const old=buildPageBlocks(model,'1',value),next=buildPageBlocks(model,'5',value);
  assert.equal(old.find(block=>block.id==='2').reviewSide,'before');
  assert.equal(old.find(block=>block.id==='2').children[0].content,'');
  assert.equal(old.find(block=>block.id==='2').children[0].heading,'完整后代');
  assert.ok(old.find(block=>block.id==='4'));
  assert.ok(next.find(block=>block.id==='2' && !block.reviewSide));
  assert.equal(bulletChanges(value).get('4').kind,'deleted');
});

test('引用和直接标签按集合比较，bigint 与 FSRS 数据保持完整',()=>{
  const id='9223372036854775807';const value=draft({'1':row('根'),[id]:row('原文','1',1,'9007199254740993')});
  value.proposed['1'].tags=['working'];value.proposed[id].references=['1'];value.proposed['-1']=row('新增','1',1,'9007199254740994');
  const snapshot={...empty,fsrs:[{id:'80',cue:'保持不变'}]};
  const preview=previewSnapshot(snapshot,value);
  assert.equal(preview.fsrs,snapshot.fsrs);assert.ok(preview.bullets.some(item=>item.id===id));
  assert.ok(preview.effective_tags.some(item=>item.bullet_id==='-1' && item.tag==='working'));
  assert.equal(bulletChanges(value).get(id).referencesChanged,true);
  assert.equal(bulletChanges(value).get('-1').kind,'added');
  assert.throws(()=>parseBulletDraft({...value,proposed:{'1':row('循环','1',1)}}),/invalid/);
  assert.throws(()=>parseBulletDraft({...value,proposed:{'1':{...row('损坏'),sibling_order:9007199254740993}}}),/invalid/);
});

test('真实组件渲染原文和最新草稿、多选入口及原位置，保留 Markdown',()=>{
  const value=draft({'1':row('父'),'2':row('a 原文','1',1)});value.proposed['2'].body='b **最新草稿**';
  const context={review:{draft:value,comments:[]},changes:bulletChanges(value),selected:['1','2'],setSelected(){},setCommentsOpen(){}};
  const model=buildKnowledgeModel(previewSnapshot(empty,value));
  const html=renderToStaticMarkup(React.createElement(BulletReviewContext.Provider,{value:context},React.createElement(ReadingViewProvider,{viewKey:'test',cache:new Map()},React.createElement(PageBulletList,{parentId:'1',model,from:0,navigate(){}}))));
  assert.match(html,/a 原文/);assert.match(html,/b <strong>最新草稿<\/strong>/);assert.doesNotMatch(html,/c 中间版本/);
  assert.match(html,/type="checkbox"[^>]*checked/);assert.match(html,/删除的原文/);assert.match(html,/拟提交内容/);
  const unchanged=renderToStaticMarkup(React.createElement(ReviewBulletContent,{id:'2',from:0,navigate(){}},'原阅读内容'));
  assert.equal(unchanged,'原阅读内容');
});

test('真实 D1 SQL 保存跨 bullet 批注；重复发送幂等，处理后只删除指定批注',async()=>{
  const db=sqliteD1();
  try {
    const value=draft({'1':row('a'),'2':row('b',null,0,'2')});
    const first=parseCommentInput({id:'00000000-0000-4000-8000-000000000001',draft_id:value.id,bullet_ids:['1','2'],body:'请一起重写。'},value);
    const second={...first,id:'00000000-0000-4000-8000-000000000002',body:'尚未处理。'};
    await saveReviewComment(db,first);await saveReviewComment(db,first);await saveReviewComment(db,second);
    assert.equal((await readBulletReview(db,value)).comments.length,2);
    await assert.rejects(saveReviewComment(db,{...first,body:'另一个请求'}),/内容已发生变化/);
    value.processed_comment_ids=[first.id];value.proposed['1'].body='修订';
    const result=await readBulletReview(db,value);
    assert.deepEqual(result.comments.map(comment=>comment.id),[second.id]);
    assert.deepEqual(result.comments[0].bullet_ids,['1','2']);
    assert.equal(await db.prepare('SELECT id FROM bullet_review_comment WHERE id = ?').bind(first.id).first(),null);
    await readBulletReview(db,null);assert.equal((await db.prepare('SELECT * FROM bullet_review_comment').all()).results.length,0);
  } finally {db.close();}
});

test('批注拒绝过期草稿和无效定位；草稿读取全程只使用 Supabase GET',async()=>{
  const value=draft({'1':row('a')});
  const input={id:'00000000-0000-4000-8000-000000000001',draft_id:value.id,bullet_ids:['1'],body:'意见'};
  assert.throws(()=>parseCommentInput(input,null),error=>error.status===409);
  assert.throws(()=>parseCommentInput({...input,bullet_ids:['99']},value),error=>error.status===400);
  assert.throws(()=>parseCommentInput({...input,body:'  '},value),error=>error.status===400);
  const calls=[];
  const found=await fetchSupabaseDraft('https://database.example','sb_publishable_test','draft-test-key',async(url,options)=>{calls.push({url,options});return Response.json([value]);});
  assert.deepEqual(found,value);assert.equal(calls[0].url.pathname,'/rest/v1/bullet_draft');
  assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.headers['x-bullet-draft-key'],'draft-test-key');
  await assert.rejects(fetchSupabaseDraft('https://database.example','sb_publishable_test',''),/configuration unavailable/);
  await assert.rejects(fetchSupabaseDraft('https://database.example','sb_publishable_test','draft-test-key',async()=>new Response('private details',{status:403})),/upstream unavailable/);
});
