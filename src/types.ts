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
}

export interface DailyCard {
    tags: 'LC0';
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
    cards: DailyCard[];
}

export type MessageSegment =
    | { type: 'text'; data: { text: string } }
    | { type: 'image'; data: { file: string } };

export interface DeliveryHistory {
    date: string;
    groups: string[];
}
