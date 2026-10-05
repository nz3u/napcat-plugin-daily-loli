/**
 * 本插件使用的 NapCat 公共接口结构类型（运行时不导入）。
 * 对照 napcat-types@0.0.16 的 plugin/types.ts 与 OB11 接口。
 * 上游 0.0.16/0.0.17 的 UploadForwardMsgV2.ts 含非法声明语法，
 * 因此不引用其庞大的内部类型依赖图；此处只描述插件实际调用的公共边界。
 */
export interface ConfigItem {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'select' | 'multi-select' | 'html' | 'text';
    label: string;
    default?: unknown;
    description?: string;
    reactive?: boolean;
}
export type PluginConfigSchema = ConfigItem[];
export interface ConfigBuilder {
    plainText(content: string): ConfigItem;
    boolean(key: string, label: string, value?: boolean, description?: string, reactive?: boolean): ConfigItem;
    text(key: string, label: string, value?: string, description?: string, reactive?: boolean): ConfigItem;
    number(key: string, label: string, value?: number, description?: string, reactive?: boolean): ConfigItem;
    combine(...items: ConfigItem[]): PluginConfigSchema;
}
export interface NapCatPluginContext {
    configPath: string;
    dataPath: string;
    adapterName: string;
    pluginManager: { config: unknown };
    NapCatConfig: ConfigBuilder;
    actions: {
        call(action: 'send_msg', params: OB11PostSendMsg, adapter: string, config: unknown): Promise<unknown>;
    };
    logger: {
        info(...args: unknown[]): void;
        warn(...args: unknown[]): void;
        error(...args: unknown[]): void;
    };
}
export interface OB11Message {
    post_type: string;
    message_type: string;
    self_id: number | string;
    user_id: number | string;
    group_id?: number | string;
    raw_message: string;
    message?: Array<{ type: string; data: Record<string, unknown> }> | string;
}
export interface OB11PostSendMsg {
    message_type: 'group';
    group_id: string;
    message: Array<{ type: string; data: unknown }>;
}
export interface PluginModule {
    plugin_init: (ctx: NapCatPluginContext) => void | Promise<void>;
    plugin_onmessage: (ctx: NapCatPluginContext, event: OB11Message) => void | Promise<void>;
    plugin_cleanup: (ctx: NapCatPluginContext) => void | Promise<void>;
    plugin_get_config: (ctx: NapCatPluginContext) => unknown | Promise<unknown>;
    plugin_set_config: (ctx: NapCatPluginContext, config: unknown) => void | Promise<void>;
}
