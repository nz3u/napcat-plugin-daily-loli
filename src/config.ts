import type { NapCatPluginContext, PluginConfigSchema } from './napcat';
import type { PluginConfig } from './types';

export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    scheduledEnabled: true,
    keywordEnabled: true,
    scheduledGroups: '',
    keywordGroups: '',
    compactMode: false,
    cooldownSeconds: 60,
    requestTimeoutSeconds: 15,
};

export function parseGroupIds(value: string): string[] {
    return [...new Set(value.split(/[\s,，;；]+/).filter(id => /^[1-9]\d{4,19}$/.test(id)))];
}

export function sanitizeConfig(raw: unknown): PluginConfig {
    const result = { ...DEFAULT_CONFIG };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    const input = raw as Record<string, unknown>;
    for (const key of ['enabled', 'scheduledEnabled', 'keywordEnabled', 'compactMode'] as const) {
        if (typeof input[key] === 'boolean') result[key] = input[key];
    }
    for (const key of ['scheduledGroups', 'keywordGroups'] as const) {
        if (typeof input[key] === 'string') result[key] = parseGroupIds(input[key]).join(',');
    }
    for (const [key, min, max] of [
        ['cooldownSeconds', 0, 3600], ['requestTimeoutSeconds', 3, 60],
    ] as const) {
        const value = input[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            result[key] = Math.min(max, Math.max(min, Math.floor(value)));
        }
    }
    return result;
}

export function buildConfigSchema(ctx: NapCatPluginContext): PluginConfigSchema {
    const ui = ctx.NapCatConfig;
    return ui.combine(
        ui.plainText('每日 LC0 图片：固定北京时间 07:21 更新；仅发送标签严格为 LC0 的卡片。不填写群号不会向任何群发送。'),
        ui.boolean('enabled', '启用插件', true, '总开关', false),
        ui.boolean('scheduledEnabled', '每日定时推送', true, '北京时间 07:21 推送；错过时启动补发当日，失败每分钟重试', false),
        ui.text('scheduledGroups', '定时推送群号', '', '多个群号用逗号、空格或换行分隔；空列表不推送', false),
        ui.boolean('keywordEnabled', '“今日图片”触发', true, '群消息内容去除首尾空白后精确等于“今日图片”时发送', false),
        ui.text('keywordGroups', '关键词触发群号', '', '仅这些群可触发；空列表不响应。可与定时群列表不同', false),
        ui.boolean('compactMode', '简略版', false, '只发送日期、评级和角色（写为“xxx（#id）”）；关闭则额外包含画师、作品来源、备注、推荐者', false),
        ui.number('cooldownSeconds', '关键词群冷却（秒）', 60, '同一群的触发间隔，0 表示无冷却', false),
        ui.number('requestTimeoutSeconds', '单个接口超时（秒）', 15, '主接口失败自动尝试备用接口，范围 3–60', false),
    );
}
