// 偏航 Worker 本地冒烟测试（node test.js）
// 读取 backend/.env 中的密钥注入 env，直接调用 Worker handler 验证真实大模型调用。
import worker from './index.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', 'backend', '.env');
const envText = readFileSync(envFile, 'utf-8');
const get = (k) => {
  const m = envText.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
};

const env = {
  LLM_API_KEY: get('LLM_API_KEY'),
  LLM_MODEL: get('LLM_MODEL') || 'deepseek-v4-flash',
  LLM_BASE_URL: get('LLM_BASE_URL')
};

async function post(path, payload) {
  const req = new Request('http://local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

async function main() {
  console.log('=== GET / ===');
  const root = await worker.fetch(new Request('http://local/'), env);
  console.log(root.status, JSON.stringify(await root.json()));

  console.log('=== POST /api/parse_pref ===');
  console.log(JSON.stringify(await post('/api/parse_pref', { user_text: '想去小众安静的地方，悠闲地逛', minutes: 60 })));

  console.log('=== POST /api/get_reason ===');
  console.log(JSON.stringify(await post('/api/get_reason', {
    pois: [{ name: '中山公园', type: '公园' }, { name: '老洋房咖啡', type: '咖啡店' }],
    weather: '晴 25°C', minutes: 60
  })));

  console.log('=== POST /api/get_intro ===');
  console.log(JSON.stringify(await post('/api/get_intro', { name: '武康大楼', type: '景点' })));

  console.log('=== CORS 预检 ===');
  const pre = await worker.fetch(new Request('http://local/api/parse_pref', { method: 'OPTIONS' }), env);
  console.log(pre.status, pre.headers.get('Access-Control-Allow-Origin'));
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
