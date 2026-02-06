/**
 * 插件配置模块
 * 定义默认配置和 WebUI 配置 Schema
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { PluginConfig } from './types';

/** 默认配置 */
export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    debug: false,
    commandPrefix: '#cmd',
    cooldownSeconds: 60,
    groupConfigs: {},
    // TODO: 在这里添加你的默认配置值
};

/**
 * 初始化 WebUI 配置 Schema
 * 使用 NapCat 提供的构建器生成配置界面
 * 
 * 可用的 UI 组件：
 * - ctx.NapCatConfig.boolean(key, label, defaultValue?, description?, reactive?) - 开关
 * - ctx.NapCatConfig.text(key, label, defaultValue?, description?, reactive?) - 文本输入
 * - ctx.NapCatConfig.number(key, label, defaultValue?, description?, reactive?) - 数字输入
 * - ctx.NapCatConfig.select(key, label, options, defaultValue?, description?, reactive?) - 下拉选择
 * - ctx.NapCatConfig.html(htmlString) - 自定义 HTML
 * - ctx.NapCatConfig.combine(...schemas) - 组合多个配置项
 */
export function initConfigUI(ctx: NapCatPluginContext) {
    const schema = ctx.NapCatConfig.combine(
        // 插件信息头部
        ctx.NapCatConfig.html(`
            <div style="padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; margin-bottom: 20px; color: white;">
                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">🔌 插件模板</h3>
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">这是一个 NapCat 插件开发模板，请根据需要修改配置。</p>
            </div>
        `),
        // 全局开关
        ctx.NapCatConfig.boolean('enabled', '启用插件', true, '是否启用此插件的功能'),
        // 调试模式
        ctx.NapCatConfig.boolean('debug', '调试模式', false, '启用后将输出详细的调试日志'),
        // 命令前缀
        ctx.NapCatConfig.text('commandPrefix', '命令前缀', '#cmd', '触发命令的前缀，默认为 #cmd'),
        // 冷却时间
        ctx.NapCatConfig.number('cooldownSeconds', '冷却时间（秒）', 60, '同一命令请求冷却时间，0 表示不限制')
        // TODO: 在这里添加你的配置项
    );

    return schema;
}

/**
 * 获取默认配置的副本
 */
export function getDefaultConfig(): PluginConfig {
    return {
        ...DEFAULT_CONFIG,
        groupConfigs: {},
    };
}
