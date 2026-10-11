import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyMessage, contentDate, DailyClient, isAfterRelease, parseDailyData } from '../src/services/daily-service';
import { DEFAULT_CONFIG, parseGroupIds, sanitizeConfig } from '../src/config';
import { isTodayImageCommand, sendGroupMessage } from '../src/handlers/message-handler';
import type { OB11Message, NapCatPluginContext } from '../src/napcat';

const date = '2026-10-05';
const now = new Date('2026-10-04T23:21:00Z');
function raw(tags = 'LC0') {
    return { date, cards: [{ tags,
        imgUrl: 'https://loli.akkariin.moe/i/test.jpg', artistName: '绘师',
        artistUrl: 'https://x.com/artist', sourceUrl: 'https://x.com/artist/status/123',
        characterNames: ['角色'], characterIds: [123], comment: '备注 [CQ:at,qq=all]',
        suggestedBy: { username: 'user', nickname: '推荐者' },
    }] };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('北京时间 07:21 边界以及年/月切换', () => {
    assert.equal(contentDate(new Date('2026-10-04T23:20:59Z')), '2026-10-04');
    assert.equal(contentDate(now), date);
    assert.equal(isAfterRelease(new Date('2026-10-04T23:20:59Z')), false);
    assert.equal(isAfterRelease(now), true);
    assert.equal(contentDate(new Date('2026-12-31T23:20:59Z')), '2026-12-31');
    assert.equal(contentDate(new Date('2026-12-31T23:21:00Z')), '2027-01-01');
    assert.equal(contentDate(new Date('2026-03-01T00:00:00+08:00')), '2026-02-28');
});

test('可发布标签白名单：LC0 与 LC YJ 都可发布，其它评级绝不回退', () => {
    const body = raw();
    body.cards.push(raw('OTHER').cards[0], raw('').cards[0]);
    assert.equal(parseDailyData(body, date).cards.length, 1);
    // 上游对同一档内容的两种写法，大小写与多余空白都接受。
    for (const tag of ['LC0', 'LC YJ', 'lc yj', 'lc0', '  LC YJ  ']) {
        const parsed = parseDailyData(raw(tag), date);
        assert.equal(parsed.cards.length, 1, `标签 ${tag} 应可发布`);
        assert.equal(parsed.cards[0].tags, 'LC0');
    }
    // 非白名单标签、缺失标签、以及擦边写法一律丢弃。
    for (const tag of ['OTHER', '', 'LC0 extra', 'LC1', 'LCYJ', 'LC  YJ']) {
        assert.throws(() => parseDailyData(raw(tag), date), `标签 ${tag} 不应发布`);
    }
    // 标签字段缺失（undefined / 非字符串）同样不发布。
    for (const tag of [undefined, null, 0, {}]) {
        const body = raw();
        (body.cards[0] as Record<string, unknown>).tags = tag;
        assert.throws(() => parseDailyData(body, date), `标签 ${String(tag)} 不应发布`);
    }
    assert.throws(() => parseDailyData({ date, cards: [] }, date));
    assert.throws(() => parseDailyData(raw(), '2026-10-06'));
    assert.throws(() => parseDailyData(null, date));
});

function segmentsOf(message: ReturnType<typeof buildDailyMessage>): string[] {
    return message.filter(segment => segment.type === 'text').map(segment => (segment.data as { text: string }).text);
}

test('公告随当日内容一起发布，只占一行且不与卡片重复', () => {
    const body = { ...raw(), announcement: '米娜，萝莉节快乐' };
    const data = parseDailyData(body, date);
    assert.equal(data.announcement, '米娜，萝莉节快乐');
    const message = buildDailyMessage(data);
    const texts = segmentsOf(message);
    assert.ok(texts[0].includes('公告：米娜，萝莉节快乐'), '首个文本段应为公告行');
    assert.equal(texts.length, 2, '公告单独一段 + 卡片文本一段');
    assert.ok(texts[1].includes(date), '卡片文本仍带日期');

    // 简略版同样带公告。
    assert.ok(segmentsOf(buildDailyMessage(data, true))[0].includes('公告：米娜，萝莉节快乐'));

    // 多卡片时公告只出现在开头一次。
    const multi = { ...raw(), announcement: '公告测试', cards: [raw().cards[0], raw().cards[0]] };
    const multiTexts = segmentsOf(buildDailyMessage(parseDailyData(multi, date)));
    assert.equal(multiTexts.length, 3, '公告一段 + 两张卡片各一段');
    assert.equal(multiTexts.filter(value => value.includes('公告：')).length, 1, '公告只发一次');
});

test('无公告或公告为空时不输出公告行', () => {
    for (const announcement of [undefined, '', '   ', 123]) {
        const data = parseDailyData({ ...raw(), announcement }, date);
        assert.equal(data.announcement, undefined, `公告 ${String(announcement)} 应视为无公告`);
        for (const text of segmentsOf(buildDailyMessage(data))) {
            assert.ok(!text.includes('公告'), '不应输出公告行');
        }
    }
});

test('图片来源白名单：拒绝内网、文件、CQ、非 HTTPS 和未知域名', () => {
    for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'http://127.0.0.1/a',
        'https://example.com/a', 'https://loli.akkariin.moe.evil.com/a',
        'https://user:pass@loli.akkariin.moe/a', 'https://loli.akkariin.moe:8080/a']) {
        const body = raw(); body.cards[0].imgUrl = url;
        assert.throws(() => parseDailyData(body, date));
    }
});

test('详细版消息包含关联信息，角色写为 xxx（#id），且不再输出画师主页', () => {
    const message = buildDailyMessage(parseDailyData(raw(), date));
    assert.deepEqual(message.map(segment => segment.type), ['text', 'image']);
    const text = message[0].data as { text: string };
    for (const value of [date, 'LC0', '绘师', '角色', '作品来源', '备注', '推荐者']) {
        assert.ok(text.text.includes(value), `详细版应包含 ${value}`);
    }
    assert.ok(text.text.includes('角色：角色（#123）'), '角色应写为 xxx（#id）');
    assert.ok(!text.text.includes('画师主页'), '不应再输出画师主页');
    assert.ok(!text.text.includes('https://bgm.tv/character/'), '不应再输出单独的角色链接行');
    assert.ok(text.text.includes('[CQ:at,qq=all]'));
});

test('简略版只保留日期、评级和角色，省略画师/来源/备注/推荐', () => {
    const message = buildDailyMessage(parseDailyData(raw(), date), true);
    assert.deepEqual(message.map(segment => segment.type), ['text', 'image']);
    const text = message[0].data as { text: string };
    for (const value of [date, 'LC0', '角色：角色（#123）']) {
        assert.ok(text.text.includes(value), `简略版应包含 ${value}`);
    }
    for (const value of ['绘师', '画师主页', '作品来源', '备注', '推荐者', 'https://bgm.tv/character/']) {
        assert.ok(!text.text.includes(value), `简略版不应包含 ${value}`);
    }
});

test('角色缺少 id 时只写名字，不产生空括号', () => {
    const body = raw();
    body.cards[0].characterIds = [0] as unknown as number[];
    const text = buildDailyMessage(parseDailyData(body, date))[0].data as { text: string };
    assert.ok(text.text.includes('角色：角色'));
    assert.ok(!text.text.includes('（#）'));
});

test('主接口失败/格式错误/旧日期后尝试备用接口', async () => {
    for (const first of [response({}, 500), response({}), response({ ...raw(), date: '2026-10-04' })]) {
        let calls = 0;
        const client = new DailyClient(() => 3, new AbortController().signal,
            (async () => ++calls === 1 ? first : response(raw())) as typeof fetch, ['https://primary', 'https://backup']);
        assert.equal((await client.get(now)).date, date);
        assert.equal(calls, 2);
    }
});

test('缓存 5 分钟、定时强刷、跨内容日刷新', async () => {
    let calls = 0;
    const client = new DailyClient(() => 3, new AbortController().signal,
        (async () => { calls++; return response({ ...raw(), date: calls >= 4 ? '2026-10-06' : date }); }) as typeof fetch);
    await client.get(now); await client.get(new Date(now.getTime() + 1000));
    assert.equal(calls, 1);
    await client.get(now, true); assert.equal(calls, 2);
    await client.get(new Date(now.getTime() + 300_000)); assert.equal(calls, 3);
    assert.equal((await client.get(new Date('2026-10-05T23:21:00Z'))).date, '2026-10-06');
});

test('并发请求合并为一次实际获取', async () => {
    let calls = 0;
    const client = new DailyClient(() => 3, new AbortController().signal,
        (async () => { calls++; return response(raw()); }) as typeof fetch);
    const values = await Promise.all([client.get(now), client.get(now), client.get(now, true)]);
    assert.equal(calls, 1); assert.equal(values.length, 3);
});

test('卸载信号取消 HTTP 请求且不继续尝试备用接口', async () => {
    const controller = new AbortController(); let calls = 0;
    const client = new DailyClient(() => 3, controller.signal,
        ((_url, options) => { calls++; return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }); }) as typeof fetch);
    const pending = client.get(now); controller.abort();
    await assert.rejects(pending); assert.equal(calls, 1);
});

test('单接口超时后会走备用接口', async () => {
    let calls = 0;
    const client = new DailyClient(() => 0.01, new AbortController().signal,
        ((_url, options) => {
            if (++calls > 1) return Promise.resolve(response(raw()));
            return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout'))));
        }) as typeof fetch);
    assert.equal((await client.get(now)).date, date); assert.equal(calls, 2);
});

test('配置清洗、数字边界、群白名单不允许空列表变成所有群', () => {
    assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG);
    assert.deepEqual(parseGroupIds('123456789，987654321\n123456789 bad 0 -1'), ['123456789', '987654321']);
    const config = sanitizeConfig({ scheduledGroups: '123456789 bad', keywordGroups: '',
        cooldownSeconds: -1, requestTimeoutSeconds: 999, enabled: 'false' });
    assert.equal(config.scheduledGroups, '123456789'); assert.equal(config.keywordGroups, '');
    assert.equal(config.cooldownSeconds, 0); assert.equal(config.requestTimeoutSeconds, 60);
    assert.equal(config.enabled, true);
    assert.equal(sanitizeConfig({ cooldownSeconds: NaN }).cooldownSeconds, 60);
});

test('关键词精确匹配：接受分段文本，拒绝混合/引用/包含关键词', () => {
    const event = (content: unknown) => ({ message: content, raw_message: '今日图片' }) as OB11Message;
    assert.equal(isTodayImageCommand(event([{ type: 'text', data: { text: ' 今日图片\n' } }])), true);
    assert.equal(isTodayImageCommand(event([{ type: 'text', data: { text: '今日' } }, { type: 'text', data: { text: '图片' } }])), true);
    assert.equal(isTodayImageCommand(event([{ type: 'reply', data: {} }, { type: 'text', data: { text: '今日图片' } }])), false);
    assert.equal(isTodayImageCommand(event([{ type: 'text', data: { text: '请给我今日图片' } }])), false);
});

test('发送识别 OneBot 错误包装且 stop 信号不被挂起 action 阻塞', async () => {
    const ctx = { logger: { error() {} }, adapterName: 'mock', pluginManager: { config: {} },
        actions: { call: async () => ({ status: 'failed', retcode: 1 }) } } as unknown as NapCatPluginContext;
    assert.equal(await sendGroupMessage(ctx, '123456789', []), false);
    ctx.actions.call = () => new Promise(() => {});
    const controller = new AbortController();
    const task = sendGroupMessage(ctx, '123456789', [], controller.signal); controller.abort();
    assert.equal(await task, false);
});
