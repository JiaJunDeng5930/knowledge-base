import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Node 中只替换 Cloudflare 环境绑定，执行的仍是实际生产 Worker。
registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env = {};', shortCircuit: true};
  return nextResolve(specifier, context);
}});
const {default: worker} = await import('../dist/server/index.js');
const bindings = {ASSETS: {fetch: async () => new Response('Not found',{status:404})}};
const context = {waitUntil() {}, passThroughOnException() {}};

test('生产入口渲染中文阅读界面和站点元数据', async () => {
  for (const path of ['/', '/root', '/bullet/2', '/fsrs/1']) {
    const response = await worker.fetch(new Request('https://reader.example'+path,{headers:{accept:'text/html'}}),bindings,context);
    assert.equal(response.status,200,path);
    const html=await response.text();
    assert.match(html,/知识库/);
    assert.match(html,/阅读设置/);
    assert.match(html,/正在打开知识库/);
    assert.match(html,/<html[^>]*lang="zh-CN"/);
    assert.doesNotMatch(html,/Starter Project|codex-preview|Ship something real/);
  }
});

test('生产 API 拒绝写入，并对未配置连接返回可重试错误', async () => {
  const get = await worker.fetch(new Request('https://reader.example/api/snapshot'),bindings,context);
  assert.equal(get.status,503);
  assert.equal(get.headers.get('cache-control'),'no-store');
  assert.deepEqual(await get.json(),{error:'尚未连接知识库。'});
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) {
    const response = await worker.fetch(new Request('https://reader.example/api/snapshot',{method}),bindings,context);
    assert.equal(response.status,405,method);
    assert.equal(response.headers.get('allow'),'GET');
  }
});
