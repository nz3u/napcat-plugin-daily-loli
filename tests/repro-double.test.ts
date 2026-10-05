import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DailyRuntime } from '../src/services/api-service';
import type { NapCatPluginContext, OB11PostSendMsg } from '../src/napcat';

// 复现：同一插件被加载两次（例如 NapCat 重载/HMR 后旧实例未清理），
// 两次 plugin_onmessage 都会订阅同一事件，导致一条消息触发两次发送。
test('复现：两个运行时实例同时存在时一条消息发送两遍', async () => {
    const root = path.resolve('.test-data'); fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'double-'));
    const sends: OB11PostSendMsg[] = [];
    const ctx = {
        configPath: path.join(dir, 'config.json'), dataPath: path.join(dir, 'data'),
        adapterName: 'test', pluginManager: { config: {} },
        logger: { info() {}, warn() {}, error() {} },
        actions: { call: async (_a: unknown, p: OB11PostSendMsg) => { sends.push(p); return { message_id: 1 }; } },
    } as unknown as NapCatPluginContext;
    const fetcher = (async () => new Response(JSON.stringify({ date: '2026-10-05', cards: [{ tags: 'LC0', imgUrl: 'https://loli.akkariin.moe/i/a.jpg' }] }))) as typeof fetch;
    const event = {
        post_type: 'message', message_type: 'group', group_id: '123456789', self_id: '10001', user_id: '20002',
        raw_message: '今日图片', message: [{ type: 'text', data: { text: '今日图片' } }],
    } as never;
    const older = new DailyRuntime(ctx, fetcher, () => new Date('2026-10-04T23:30:00Z'));
    older.state.replaceConfig({ scheduledGroups: '', keywordGroups: '123456789', cooldownSeconds: 60 });
    // 第一次加载：注册为当前实例
    DailyRuntime.takeOver(older);
    const newer = new DailyRuntime(ctx, fetcher, () => new Date('2026-10-04T23:30:00Z'));
    newer.state.replaceConfig({ scheduledGroups: '', keywordGroups: '123456789', cooldownSeconds: 60 });
    // 模拟 framework 重载：新实例接管，旧实例必须让位
    const displaced = DailyRuntime.takeOver(newer);
    assert.equal(displaced, older, 'takeOver 应返回被替换的旧实例');
    assert.equal(older.isActive, false, '被替换的实例必须停用');
    await Promise.all([older.onMessage(event), newer.onMessage(event)]);
    assert.equal(sends.length, 1, `期望只发送一次，实际 ${sends.length} 次`);
    await older.stop(); await newer.stop();
    fs.rmSync(dir, { recursive: true, force: true });
});
