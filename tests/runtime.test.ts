import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { DailyRuntime } from '../src/services/api-service';
import { DEFAULT_CONFIG, buildConfigSchema } from '../src/config';
import type { NapCatPluginContext, OB11Message, OB11PostSendMsg, ConfigItem } from '../src/napcat';

const date = '2026-10-05';
const raw = { date, cards: [{ tags: 'LC0', imgUrl: 'https://loli.akkariin.moe/i/test.jpg', artistName: '画师' }] };
const event = (group = '123456789', type = 'group') => ({
    post_type: 'message', message_type: type, group_id: group, self_id: '10001', user_id: '20002',
    raw_message: '今日图片', message: [{ type: 'text', data: { text: '今日图片' } }],
}) as OB11Message;

function fixture(t: TestContext) {
    const root = path.resolve('.test-data'); fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const sends: OB11PostSendMsg[] = [];
    let now = new Date('2026-10-04T23:21:00Z');
    const ctx = {
        configPath: path.join(dir, 'config.json'), dataPath: path.join(dir, 'data'),
        adapterName: 'test', pluginManager: { config: {} },
        logger: { info() {}, warn() {}, error() {} },
        actions: { call: async (_action: unknown, params: OB11PostSendMsg) => {
            sends.push(params); return { message_id: 1 };
        } },
    } as unknown as NapCatPluginContext;
    const fetcher = (async () => new Response(JSON.stringify(raw))) as typeof fetch;
    const runtime = new DailyRuntime(ctx, fetcher, () => now);
    runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '123456789,987654321', keywordGroups: '123456789' });
    // 模拟框架加载：注册为当前生效实例
    DailyRuntime.takeOver(runtime);
    const instances = [runtime];
    t.after(async () => {
        for (const instance of instances) await instance.stop();
        // 只删除本测试刚创建、且已核验所属目录/前缀的临时子目录。
        const resolved = path.resolve(dir);
        assert.equal(path.dirname(resolved), root);
        assert.ok(path.basename(resolved).startsWith('case-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return { ctx, runtime, sends, instances, fetcher, get now() { return now; },
        /** 把指定实例注册为当前生效实例（模拟框架加载/重载）。 */
        activate(instance: DailyRuntime) { DailyRuntime.takeOver(instance); return instance; },
        setNow(value: string) { now = new Date(value); }, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}

test('07:21 前不推送，07:21 推送所有白名单群，反复 tick 不重复', async t => {
    const f = fixture(t);
    f.setNow('2026-10-04T23:20:59Z'); await f.runtime.tick(); assert.equal(f.sends.length, 0);
    f.setNow('2026-10-04T23:21:00Z'); await f.runtime.tick();
    assert.deepEqual(f.sends.map(value => value.group_id), ['123456789', '987654321']);
    await f.runtime.tick(); f.advance(60_000); await f.runtime.tick(); assert.equal(f.sends.length, 2);
});

test('定时失败只重试失败的群，不重发已成功群', async t => {
    const f = fixture(t); let fail = true;
    f.ctx.actions.call = async (_action, params) => {
        f.sends.push(params);
        if (params.group_id === '987654321' && fail) throw new Error('muted');
        return { message_id: 1 };
    };
    await f.runtime.tick(); assert.equal(f.sends.length, 2);
    await f.runtime.tick(); assert.equal(f.sends.length, 2);
    fail = false; f.advance(60_000); await f.runtime.tick();
    assert.deepEqual(f.sends.map(value => value.group_id), ['123456789', '987654321', '987654321']);
});

test('连续失败达到上限后停止当天重试并发送提醒', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 3 });
    const runtime = f.activate(new DailyRuntime(f.ctx, (async () => {
        throw new Error('interface down');
    }) as typeof fetch, () => f.now));
    f.instances.push(runtime);
    runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 3 });
    for (let i = 0; i < 3; i++) { await runtime.tick(); f.advance(60_000); }
    // 第 3 次失败后应发出一条提醒，并停止后续重试。
    const alerts = f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒'));
    assert.equal(alerts.length, 1, '达到上限应发送一次提醒');
    assert.deepEqual(alerts.map(value => value.group_id), ['123456789']);
    // 继续推进时间也不再重试，不再重复提醒。
    for (let i = 0; i < 5; i++) { await runtime.tick(); f.advance(60_000); }
    assert.equal(f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒')).length, 1);
});

test('关闭失败提醒后只记录日志，不向群发送', async t => {
    const f = fixture(t);
    const config = { ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 2, failureAlertEnabled: false };
    const runtime = f.activate(new DailyRuntime(f.ctx, (async () => {
        throw new Error('interface down');
    }) as typeof fetch, () => f.now));
    f.instances.push(runtime);
    runtime.state.replaceConfig(config);
    for (let i = 0; i < 2; i++) { await runtime.tick(); f.advance(60_000); }
    assert.equal(f.sends.length, 0, '关闭提醒后不应发送任何消息');
    for (let i = 0; i < 3; i++) { await runtime.tick(); f.advance(60_000); }
    assert.equal(f.sends.length, 0, '停止重试后也不再发送');
});

test('中途成功后连续失败计数归零，不会误触发停止', async t => {
    const f = fixture(t);
    let fail = true;
    f.ctx.actions.call = async (_action, params) => {
        f.sends.push(params);
        if (fail) throw new Error('muted');
        return { message_id: 1 };
    };
    const config = { ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 3 };
    f.runtime.state.replaceConfig(config);
    // 失败两次（未达上限）
    await f.runtime.tick(); f.advance(60_000);
    await f.runtime.tick(); f.advance(60_000);
    // 第三次成功，计数归零
    fail = false;
    await f.runtime.tick();
    assert.equal(f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒')).length, 0);
    // 之后又失败两次也不该停止（计数已重置）
    fail = true;
    const runtime = f.runtime;
    runtime.state.updateConfig({ scheduledGroups: '987654321' });
    await runtime.tick(); f.advance(60_000);
    await runtime.tick(); f.advance(60_000);
    assert.equal(f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒')).length, 0);
});

test('重新保存配置可恢复已被停止的重试', async t => {
    const f = fixture(t);
    let fail = true;
    f.ctx.actions.call = async (_action, params) => {
        f.sends.push(params);
        if (fail) throw new Error('muted');
        return { message_id: 1 };
    };
    const config = { ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 2 };
    f.runtime.state.replaceConfig(config);
    await f.runtime.tick(); f.advance(60_000);
    await f.runtime.tick(); f.advance(60_000);
    assert.equal(f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒')).length, 1);
    // 人工修复后重新保存配置：恢复重试并成功发送。
    fail = false;
    f.runtime.state.updateConfig({ scheduledGroups: '123456789', maxRetryAttempts: 2 });
    f.runtime.configChanged();
    await f.runtime.tick();
    const sent = f.sends.filter(value => (value.message[0].data as { text: string }).text.includes(date));
    assert.ok(sent.length >= 1, '恢复后应重新尝试并发送当日内容');
});

test('最大连续失败次数为 0 时不限制重试，也不发提醒', async t => {
    const f = fixture(t);
    f.ctx.actions.call = async (_action, params) => { f.sends.push(params); throw new Error('muted'); };
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '123456789', maxRetryAttempts: 0 });
    for (let i = 0; i < 15; i++) { await f.runtime.tick(); f.advance(60_000); }
    assert.equal(f.sends.filter(value => (value.message[0].data as { text: string }).text.includes('推送失败提醒')).length, 0);
    assert.ok(f.sends.length >= 15, '不限制时应持续重试');
});

test('读取持久化历史，重启后不重复；新增群补发', async t => {
    const f = fixture(t); await f.runtime.tick(); await f.runtime.stop();
    const next = new DailyRuntime(f.ctx, f.fetcher, () => f.now); f.instances.push(next); f.activate(next);
    await next.tick(); assert.equal(f.sends.length, 2);
    next.state.updateConfig({ scheduledGroups: '123456789,987654321,555555555' });
    await next.tick(); assert.equal(f.sends.length, 3); assert.equal(f.sends[2].group_id, '555555555');
});

test('总开关、定时开关、空群白名单独立阻止推送', async t => {
    const f = fixture(t);
    for (const config of [{ enabled: false }, { scheduledEnabled: false }, { scheduledGroups: '' }]) {
        f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '123456789', ...config });
        await f.runtime.tick();
    }
    assert.equal(f.sends.length, 0);
});

test('关键词开关与定时开关独立，私聊/非白名单/自身消息不响应', async t => {
    const f = fixture(t); f.runtime.state.updateConfig({ scheduledEnabled: false });
    await f.runtime.onMessage(event('123456789', 'private')); await f.runtime.onMessage(event('987654321'));
    await f.runtime.onMessage({ ...event(), user_id: '10001' }); assert.equal(f.sends.length, 0);
    f.runtime.state.updateConfig({ keywordEnabled: false }); await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 0);
    f.runtime.state.updateConfig({ keywordEnabled: true }); await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 1);
    await f.runtime.onMessage(event()); assert.equal(f.sends.length, 1);
    f.advance(60_000); await f.runtime.onMessage(event()); assert.equal(f.sends.length, 2);
    assert.equal(f.runtime.state.wasDelivered(date, '123456789'), false);
});

test('同群并发关键词只发送一次，即使冷却设置为零', async t => {
    const f = fixture(t); f.runtime.state.updateConfig({ cooldownSeconds: 0 });
    await Promise.all([f.runtime.onMessage(event()), f.runtime.onMessage(event()), f.runtime.onMessage(event())]);
    assert.equal(f.sends.length, 1);
    await f.runtime.onMessage(event()); assert.equal(f.sends.length, 2);
});

test('QQ 发送失败且冷却为零时仍有十秒故障冷却', async t => {
    const f = fixture(t); f.runtime.state.updateConfig({ cooldownSeconds: 0 });
    let calls = 0; f.ctx.actions.call = async () => { calls++; throw new Error('send failed'); };
    await f.runtime.onMessage(event()); const initial = calls;
    // 首次尝试会失败一次并补发一条失败提示，因此至少 2 次调用。
    assert.ok(initial >= 1, `首次应尝试发送，实际 ${initial}`);
    await f.runtime.onMessage(event());
    assert.equal(calls, initial, '冷却期内不应再次发送');
    f.advance(10_000); await f.runtime.onMessage(event());
    assert.ok(calls > initial, '十秒后应允许再次尝试');
});

test('获取失败不发送昨日数据；定时每分钟重试最新日期', async t => {
    const f = fixture(t); let updated = false; let calls = 0;
    const runtime = new DailyRuntime(f.ctx, (async () => {
        calls++; return new Response(JSON.stringify({ ...raw, date: updated ? date : '2026-10-04' }));
    }) as typeof fetch, () => f.now); f.instances.push(runtime); f.activate(runtime);
    runtime.state.replaceConfig(f.runtime.state.config);
    await runtime.tick(); assert.equal(f.sends.length, 0); assert.equal(calls, 2);
    updated = true; f.advance(60_000); await runtime.tick(); assert.equal(f.sends.length, 2);
});

test('请求期间关闭开关，完成后也不发送', async t => {
    const f = fixture(t); let resolve!: (value: Response) => void;
    const runtime = new DailyRuntime(f.ctx, (() => new Promise<Response>(done => { resolve = done; })) as typeof fetch, () => f.now);
    f.instances.push(runtime); f.activate(runtime); runtime.state.replaceConfig(f.runtime.state.config);
    const task = runtime.onMessage(event());
    runtime.state.updateConfig({ enabled: false });
    resolve(new Response(JSON.stringify(raw))); await task; assert.equal(f.sends.length, 0);
});

test('卸载取消 HTTP 请求，排空任务且不发送', async t => {
    const f = fixture(t);
    const runtime = new DailyRuntime(f.ctx, ((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    })) as typeof fetch, () => f.now); f.instances.push(runtime); f.activate(runtime); runtime.state.replaceConfig(f.runtime.state.config);
    const task = runtime.tick(); await runtime.stop(); await task;
    await runtime.tick(); await runtime.onMessage(event()); assert.equal(f.sends.length, 0);
});

test('卸载不被挂起的 QQ action 阻塞，不继续向剩余群发送', async t => {
    const f = fixture(t); let started = 0;
    f.ctx.actions.call = () => { started++; return new Promise(() => {}); };
    const task = f.runtime.tick(); await setImmediate(); assert.equal(started, 1);
    await f.runtime.stop(); await task; assert.equal(started, 1);
});

test('关键词请求跨 07:21 时重新获取，只发送新日数据', async t => {
    const f = fixture(t); f.setNow('2026-10-04T23:20:59Z');
    let resolve!: (value: Response) => void; let calls = 0;
    const runtime = new DailyRuntime(f.ctx, (() => {
        if (++calls === 1) return new Promise<Response>(done => { resolve = done; });
        return Promise.resolve(new Response(JSON.stringify(raw)));
    }) as typeof fetch, () => f.now);
    f.instances.push(runtime); f.activate(runtime); runtime.state.replaceConfig(f.runtime.state.config);
    const task = runtime.onMessage(event());
    f.setNow('2026-10-04T23:21:00Z');
    resolve(new Response(JSON.stringify({ ...raw, date: '2026-10-04' })));
    await task; assert.equal(calls, 2); assert.equal(f.sends.length, 1);
    const segment = f.sends[0].message[0].data as { text: string };
    assert.ok(segment.text.includes(date)); assert.ok(!segment.text.includes('2026-10-04'));
});

test('定时请求期间移除目标群，不向移除的群发送', async t => {
    const f = fixture(t); let resolve!: (value: Response) => void;
    const runtime = new DailyRuntime(f.ctx, (() => new Promise<Response>(done => { resolve = done; })) as typeof fetch, () => f.now);
    f.instances.push(runtime); f.activate(runtime); runtime.state.replaceConfig(f.runtime.state.config);
    const task = runtime.tick();
    runtime.state.updateConfig({ scheduledGroups: '987654321' });
    resolve(new Response(JSON.stringify(raw))); await task;
    assert.deepEqual(f.sends.map(value => value.group_id), ['987654321']);
});

test('推送历史落盘失败仍保留进程内成功标记，不无限重发', async t => {
    const f = fixture(t);
    // 同名目录使历史文件原子替换失败，真实模拟磁盘持久化故障。
    fs.mkdirSync(path.join(f.ctx.dataPath, 'delivery-history.json'));
    await f.runtime.tick(); assert.equal(f.sends.length, 2);
    f.advance(60_000); await f.runtime.tick(); assert.equal(f.sends.length, 2);
    assert.equal(f.runtime.state.wasDelivered(date, '123456789'), true);
});

test('回归：全新安装未填关键词群号时，任何群都不回复', async t => {
    const f = fixture(t);
    // 清空成全新安装状态
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '' });
    await f.runtime.onMessage(event('123456789'));
    await f.runtime.onMessage(event('987654321'));
    assert.equal(f.sends.length, 0, '白名单为空必须 fail-closed');
});

test('回归：只填了关键词群号后，仅该群生效', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789' });
    await f.runtime.onMessage(event('987654321'));
    assert.equal(f.sends.length, 0, '未列入白名单的群不应回复');
    await f.runtime.onMessage(event('123456789'));
    assert.equal(f.sends.length, 1, '白名单内的群应回复');
});

test('回归：重载后旧实例不再响应，一条消息只发一次', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789' });
    const reloaded = new DailyRuntime(f.ctx, f.fetcher, () => f.now);
    f.instances.push(reloaded);
    reloaded.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789' });
    DailyRuntime.takeOver(reloaded);
    await Promise.all([f.runtime.onMessage(event()), reloaded.onMessage(event())]);
    assert.equal(f.sends.length, 1, '同一事件只能产生一次发送');
});

test('冷却：配置 60 秒时 59 秒内不再发送，61 秒后恢复', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789', cooldownSeconds: 60 });
    await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 1);
    f.advance(59_000); await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 1, '59 秒仍在冷却');
    f.advance(2_000); await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 2, '61 秒后应恢复');
});

test('冷却：cooldownSeconds=0 时无需等待即可再次发送', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789', cooldownSeconds: 0 });
    await f.runtime.onMessage(event());
    await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 2, '无冷却时应每次都回复');
});

test('冷却：每个群独立计时，互不影响', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789,987654321', cooldownSeconds: 60 });
    await f.runtime.onMessage(event('123456789'));
    await f.runtime.onMessage(event('987654321'));
    assert.equal(f.sends.length, 2, '两个群首次都应回复');
    await f.runtime.onMessage(event('123456789'));
    await f.runtime.onMessage(event('987654321'));
    assert.equal(f.sends.length, 2, '两群各自处于冷却中');
});

test('冷却：冷却期内发送失败也不会重复轰炸', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789', cooldownSeconds: 60 });
    let calls = 0; f.ctx.actions.call = async () => { calls++; throw new Error('muted'); };
    await f.runtime.onMessage(event());
    const after = calls;
    f.advance(30_000); await f.runtime.onMessage(event());
    assert.equal(calls, after, '冷却期内即使失败也不应再次发送');
});

test('简略版开关生效：开启后实际发送的文本省略画师与来源', async t => {
    const f = fixture(t);
    f.runtime.state.replaceConfig({ ...DEFAULT_CONFIG, scheduledGroups: '', keywordGroups: '123456789', compactMode: true });
    await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 1);
    const detail = (f.sends[0].message[0].data as { text: string }).text;
    assert.ok(!detail.includes('画师'), '简略版不应包含画师');
    assert.ok(!detail.includes('作品来源'), '简略版不应包含来源');
    assert.ok(detail.includes(date));

    f.advance(120_000);
    f.runtime.state.updateConfig({ compactMode: false });
    await f.runtime.onMessage(event());
    assert.equal(f.sends.length, 2);
    const full = (f.sends[1].message[0].data as { text: string }).text;
    assert.ok(!full.includes('画师主页'), '详细版也不应包含画师主页');
});

test('配置 Schema 非响应式，只有保存后应用，避免编辑群号触发推送', () => {
    const builder = (type: ConfigItem['type']) => (key: string, label: string, value: unknown, description: string, reactive: boolean) => ({ type, key, label, default: value, description, reactive });
    const ctx = { NapCatConfig: {
        combine: (...items: ConfigItem[]) => items, plainText: (label: string) => ({ type: 'text', key: '', label }),
        boolean: builder('boolean'), text: builder('string'), number: builder('number'),
    } } as unknown as NapCatPluginContext;
    const schema = buildConfigSchema(ctx);
    assert.equal(schema.filter(value => value.key).length, 10);
    assert.ok(schema.every(value => !value.reactive));
});
