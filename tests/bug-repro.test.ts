import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DailyRuntime } from '../src/services/api-service';
import type { NapCatPluginContext, OB11Message, OB11PostSendMsg } from '../src/napcat';

const raw = { date: '2026-10-05', cards: [{ tags: 'LC0', imgUrl: 'https://loli.akkariin.moe/i/test.jpg' }] };
const event = (group = '123456789') => ({
    post_type: 'message', message_type: 'group', group_id: group, self_id: '10001', user_id: '20002',
    raw_message: '今日图片', message: [{ type: 'text', data: { text: '今日图片' } }],
}) as OB11Message;

function fixture(t: TestContext) {
    const root = path.resolve('.test-data'); fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'repro-'));
    const sends: OB11PostSendMsg[] = [];
    const ctx = {
        configPath: path.join(dir, 'config.json'), dataPath: path.join(dir, 'data'),
        adapterName: 'test', pluginManager: { config: {} },
        logger: { info() {}, warn() {}, error() {} },
        actions: { call: async (_action: unknown, params: OB11PostSendMsg) => { sends.push(params); return { message_id: 1 }; } },
    } as unknown as NapCatPluginContext;
    const fetchDaily = (async () => new Response(JSON.stringify(raw))) as typeof fetch;
    t.after(async () => {
        const resolved = path.resolve(dir);
        assert.equal(path.dirname(resolved), root);
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return { ctx, sends, fetchDaily };
}

test('复现：全新安装（无配置文件）时关键词白名单不应生效', async t => {
    const f = fixture(t);
    assert.equal(fs.existsSync(f.ctx.configPath), false, '前置条件：全新安装没有配置文件');
    const runtime = new DailyRuntime(f.ctx, f.fetchDaily, () => new Date('2026-10-04T23:30:00Z'));
    t.after(() => runtime.stop());
    DailyRuntime.takeOver(runtime);
    await runtime.onMessage(event());
    assert.equal(f.sends.length, 0, '未填写关键词群号时不应回复任何群');
});
