// 最小宿主桩：验证 apply() 不炸、工具能注册、systemPrompt 能注入
import { apply } from '../index.js';

const tools = [];
const sections = [];
const contexts = [];
const services = {};

const ctx = {
  tools: { register: (t) => tools.push(t) },
  get: (n) => (n === 'systemPrompt' ? { section: (s) => sections.push(s), context: (c) => contexts.push(c) } : undefined),
  provide: (n, v) => { services[n] = v; },
};

const config = {
  personaText: '测试人设：蓝发鲸尾女仆鱼。',
  workspace: process.cwd(),
  peopleFile: 'kb/认人-群友档案.md',
  emojiDir: 'D:\\综合\\素材\\ai\\表情包\\deepseek鲸鱼娘表情包',
  emojiIndexFile: 'kb/表情包-索引.md',
  emojiChance: 0.5,
  emojiPity: 3,
  autoSpeakChance: 0.2,
  autoSpeakKeywords: ['大肥鱼'],
};

apply(ctx, config);

console.log('tools:', tools.map((t) => t.name).join(', '));
console.log('prompt sections:', sections.map((s) => s.name).join(', '));
console.log('prompt contexts:', contexts.map((c) => c.name).join(', '));

const draw = tools.find((t) => t.name === 'dfy_emoji_draw');
const status = tools.find((t) => t.name === 'dfy_emoji_status');
const persona = tools.find((t) => t.name === 'dfy_persona_show');

const run = async (t, a) => (await t.execute(a ?? {}));

console.log(await run(status));
console.log('--- draw x5 ---');
for (let i = 0; i < 5; i++) console.log(i + 1, await run(draw));
console.log('--- forced ---');
console.log(await run(draw, { force: true }));
console.log('--- persona ---');
console.log((await run(persona)).slice(0, 80));

const svc = services.dfyqq;
console.log('shouldSpeak(@):', svc.shouldSpeak({ text: 'hi', mentioned: true }));
console.log('shouldSpeak(keyword):', svc.shouldSpeak({ text: '大肥鱼在吗', mentioned: false }));
console.log('shouldSpeak(normal):', svc.shouldSpeak({ text: '今天天气不错', mentioned: false }));
