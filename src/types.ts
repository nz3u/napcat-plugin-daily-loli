/**
 * 类型定义文件
 * 定义插件所需的所有接口和类型
 */

/**
 * 插件主配置接口
 * 根据你的插件需求添加配置项
 */
export interface PluginConfig {
    /** 全局开关：是否启用插件功能 */
    enabled: boolean;
    /** 调试模式：启用后输出详细日志 */
    debug: boolean;
    /** 触发命令前缀，默认为 #cmd */
    commandPrefix: string;
    /** 同一命令请求冷却时间（秒），0 表示不限制 */
    cooldownSeconds: number;
    /** 按群的单独配置 */
    groupConfigs?: Record<string, GroupConfig>;
    // TODO: 在这里添加你的插件配置项
}

/**
 * 群配置
 */
export interface GroupConfig {
    /** 是否启用此群的功能 */
    enabled?: boolean;
    // TODO: 在这里添加群级别的配置项
}

/**
 * API 响应格式
 */
export interface ApiResponse<T = unknown> {
    code: number;
    message?: string;
    data?: T;
}

// ==================== 消息段类型 ====================

/**
 * 文本消息段
 */
export interface TextSegment {
    type: 'text';
    data: { text: string };
}

/**
 * 图片消息段
 */
export interface ImageSegment {
    type: 'image';
    data: { file: string };
}

/**
 * @消息段
 */
export interface AtSegment {
    type: 'at';
    data: { qq: string };
}

/**
 * 回复消息段
 */
export interface ReplySegment {
    type: 'reply';
    data: { id: string };
}

/**
 * 通用消息段类型
 */
export type MessageSegment = TextSegment | ImageSegment | AtSegment | ReplySegment | { type: string; data: Record<string, unknown> };

/**
 * 合并转发消息节点
 */
export interface ForwardNode {
    type: 'node';
    data: {
        user_id: string;
        nickname: string;
        content: MessageSegment[];
    };
}
