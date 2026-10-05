import type { DailyCard, DailyData, MessageSegment } from '../types';

export const API_ENDPOINTS = [
    'https://loliconey.tsuki.ga/api/v1/daily?badge=LC0',
    'https://lc-coney.deno.dev/api/v1/daily?badge=LC0',
];
// 当前上游的图片域名白名单；禁止把上游任意 URL 交给 QQ 下载内网资源。
const IMAGE_HOSTS = new Set(['loli.akkariin.moe', 'p.sda1.dev']);
const CST_OFFSET = 8 * 3_600_000;
const RELEASE_MINUTE = 7 * 60 + 21;

/** 与用户脚本一致：北京时间 07:21 前仍属于上一个内容日。 */
export function contentDate(now = new Date()): string {
    return new Date(now.getTime() + CST_OFFSET - RELEASE_MINUTE * 60_000).toISOString().slice(0, 10);
}
export function isAfterRelease(now = new Date()): boolean {
    const cst = new Date(now.getTime() + CST_OFFSET);
    return cst.getUTCHours() * 60 + cst.getUTCMinutes() >= RELEASE_MINUTE;
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 1000): string {
    return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : '';
}
export function httpUrl(value: unknown): string {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

/** 白名单 fail-closed：非 LC0/缺少标签的卡片完全丢弃，不回退到其它评级。 */
export function parseDailyData(raw: unknown, expectedDate: string): DailyData {
    if (!record(raw) || raw.date !== expectedDate || !Array.isArray(raw.cards)) {
        throw new Error(`接口尚未更新到内容日 ${expectedDate}，或响应格式错误`);
    }
    const cards: DailyCard[] = [];
    for (const value of raw.cards.slice(0, 10)) {
        if (!record(value) || value.tags !== 'LC0') continue;
        const imgUrl = httpUrl(value.imgUrl);
        if (!imgUrl) continue;
        const image = new URL(imgUrl);
        if (image.protocol !== 'https:' || image.port || !IMAGE_HOSTS.has(image.hostname)) continue;
        const names = Array.isArray(value.characterNames) ? value.characterNames : [];
        const ids = Array.isArray(value.characterIds) ? value.characterIds : [];
        const pairs = names.slice(0, 20).map((name, index) => ({
            name: text(name, 120),
            id: /^[1-9]\d*$/.test(String(ids[index])) ? String(ids[index]) : '',
        })).filter(pair => pair.name);
        cards.push({
            tags: 'LC0', imgUrl,
            artistName: text(value.artistName, 200), artistUrl: httpUrl(value.artistUrl),
            sourceUrl: httpUrl(value.sourceUrl),
            characterNames: pairs.map(pair => pair.name), characterIds: pairs.map(pair => pair.id),
            comment: text(value.comment),
            ...(record(value.suggestedBy) ? { suggestedBy: {
                username: text(value.suggestedBy.username, 100), nickname: text(value.suggestedBy.nickname, 100),
            } } : {}),
        });
    }
    if (!cards.length) throw new Error('当日没有可用的 LC0 图片');
    return { date: expectedDate, cards };
}

/**
 * 生成图文消息。
 *
 * 详细版：日期/评级、画师、角色、作品来源、备注、推荐者。
 * 简略版（compact）：只保留日期/评级与角色，角色写成 `xxx（#id）`，
 *   不带画师、来源、备注和推荐者。
 * 两个版本都不再输出画师主页和单独的 bgm.tv 链接行。
 */
export function buildDailyMessage(daily: DailyData, compact = false): MessageSegment[] {
    return daily.cards.flatMap((card, index): MessageSegment[] => {
        const lines = [`今日图片 · ${daily.date} · LC0${daily.cards.length > 1 ? ` (${index + 1}/${daily.cards.length})` : ''}`];
        // 角色格式：xxx（#id）；没有 id 时只写名字。
        const characters = card.characterNames.map((name, i) => {
            const id = card.characterIds[i];
            return id ? `${name}（#${id}）` : name;
        });
        if (compact) {
            if (characters.length) lines.push(`角色：${characters.join('、')}`);
            return [
                { type: 'text', data: { text: `${lines.join('\n')}\n` } },
                { type: 'image', data: { file: card.imgUrl } },
            ];
        }
        if (card.artistName) lines.push(`画师：${card.artistName}`);
        if (characters.length) lines.push(`角色：${characters.join('、')}`);
        if (card.sourceUrl) lines.push(`作品来源：${card.sourceUrl}`);
        if (card.comment) lines.push(`备注：${card.comment}`);
        const suggester = card.suggestedBy?.nickname || card.suggestedBy?.username;
        if (suggester) lines.push(`推荐：${suggester}`);
        // 使用消息段，而非 CQ 字符串，远端文本中的 [CQ:...] 不会被执行。
        return [
            { type: 'text', data: { text: `${lines.join('\n')}\n` } },
            { type: 'image', data: { file: card.imgUrl } },
        ];
    });
}

export class DailyClient {
    private cache?: { data: DailyData; fetchedAt: number };
    private pending?: { date: string; promise: Promise<DailyData> };
    constructor(
        private readonly timeoutSeconds: () => number,
        private readonly signal: AbortSignal,
        private readonly fetcher: typeof fetch = fetch,
        private readonly endpoints = API_ENDPOINTS,
    ) {}

    async get(now = new Date(), fresh = false): Promise<DailyData> {
        const date = contentDate(now);
        if (this.signal.aborted) throw new Error('插件已停止');
        if (!fresh && this.cache?.data.date === date && now.getTime() - this.cache.fetchedAt < 5 * 60_000) {
            return this.cache.data;
        }
        if (this.pending?.date === date) return this.pending.promise;
        const promise = this.fetchDaily(date).then(data => {
            this.cache = { data, fetchedAt: now.getTime() };
            return data;
        });
        const pending = { date, promise };
        this.pending = pending;
        try { return await promise; }
        finally { if (this.pending === pending) this.pending = undefined; }
    }

    private async fetchDaily(date: string): Promise<DailyData> {
        const errors: string[] = [];
        for (const endpoint of this.endpoints) {
            if (this.signal.aborted) throw new Error('插件已停止');
            const controller = new AbortController();
            const abort = () => controller.abort();
            this.signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, this.timeoutSeconds() * 1000);
            try {
                const response = await this.fetcher(endpoint, {
                    headers: { Accept: 'application/json', 'User-Agent': 'napcat-plugin-daily-loli/1.0.0' },
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return parseDailyData(await response.json(), date);
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            } finally {
                clearTimeout(timer);
                this.signal.removeEventListener('abort', abort);
            }
        }
        throw new Error(`LC0 接口获取失败：${errors.join('；')}`);
    }
}
