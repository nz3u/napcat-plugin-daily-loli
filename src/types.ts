export interface PluginConfig {
    enabled: boolean;
    scheduledEnabled: boolean;
    keywordEnabled: boolean;
    /** 逗号、空格或换行分隔；空列表不发送。 */
    scheduledGroups: string;
    keywordGroups: string;
    /** 简略版：只发送日期、评级和角色（xxx（#id）），省略画师/来源/备注/推荐。 */
    compactMode: boolean;
    cooldownSeconds: number;
    requestTimeoutSeconds: number;
    /** 连续失败达到该次数后停止当天重试，0 表示不限制。 */
    maxRetryAttempts: number;
    /** 停止重试时是否向尚未成功的定时群发送一条提醒。 */
    failureAlertEnabled: boolean;
}

/**
 * 上游对同一档内容会使用不同写法；归一化后只保留这两个可发布标签。
 * 其它评级（含缺失标签）一律丢弃，不回退。
 */
export type PublishableTag = 'LC0' | 'LC YJ';

export interface DailyCard {
    tags: PublishableTag;
    imgUrl: string;
    artistName: string;
    artistUrl: string;
    sourceUrl: string;
    characterNames: string[];
    characterIds: string[];
    comment: string;
    suggestedBy?: { username: string; nickname: string };
}

export interface DailyData {
    date: string;
    /** 上游公告；存在时随当日内容一起发布，只占一行。 */
    announcement?: string;
    cards: DailyCard[];
}

export type MessageSegment =
    | { type: 'text'; data: { text: string } }
    | { type: 'image'; data: { file: string } };

export interface DeliveryHistory {
    date: string;
    groups: string[];
}
