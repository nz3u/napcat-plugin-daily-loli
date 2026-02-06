/**
 * API 服务模块
 * 注册 WebUI API 路由（无认证模式）
 * 
 * NapCat 路由器提供两种注册方式：
 * - router.get / router.post：需要认证（NapCat WebUI 登录后才能访问）
 * - router.getNoAuth / router.postNoAuth：无需认证（插件自己的 WebUI 页面可直接调用）
 * 
 * 一般插件自带的 WebUI 页面使用 NoAuth 路由，因为页面本身已在 NapCat WebUI 内嵌展示。
 */

import type { NapCatPluginContext, PluginHttpRequest, PluginHttpResponse } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { OB11Group } from 'napcat-types/napcat-onebot/types';
import { pluginState } from '../core/state';

/**
 * 解析请求体
 * PluginHttpRequest.body 已由框架解析
 */
function parseBody(req: PluginHttpRequest): Record<string, unknown> {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body as object).length > 0) {
        return req.body as Record<string, unknown>;
    }
    return {};
}

/**
 * 注册 API 路由
 * @param ctx 插件上下文
 */
export function registerApiRoutes(ctx: NapCatPluginContext): void {
    const router = ctx.router;

    // ==================== 基础接口（无认证）====================

    // 插件信息
    router.getNoAuth('/info', (_req: PluginHttpRequest, res: PluginHttpResponse) => {
        res.json({
            code: 0,
            data: { pluginName: ctx.pluginName }
        });
    });

    // 状态接口
    router.getNoAuth('/status', (_req: PluginHttpRequest, res: PluginHttpResponse) => {
        res.json({
            code: 0,
            data: {
                pluginName: pluginState.pluginName,
                uptime: pluginState.getUptime(),
                uptimeFormatted: pluginState.getUptimeFormatted(),
                config: pluginState.getConfig(),
                stats: pluginState.stats
            }
        });
    });

    // ==================== 配置接口（无认证）====================

    // 获取配置
    router.getNoAuth('/config', (_req: PluginHttpRequest, res: PluginHttpResponse) => {
        res.json({ code: 0, data: pluginState.getConfig() });
    });

    // 保存配置
    router.postNoAuth('/config', async (req: PluginHttpRequest, res: PluginHttpResponse) => {
        try {
            const body = parseBody(req);
            pluginState.setConfig(ctx, body as Partial<import('../types').PluginConfig>);
            pluginState.log('info', '配置已保存');
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            pluginState.log('error', '保存配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 群管理接口（无认证）====================

    // 获取群列表
    router.getNoAuth('/groups', async (_req: PluginHttpRequest, res: PluginHttpResponse) => {
        try {
            const groups = await ctx.actions.call(
                'get_group_list',
                {},
                ctx.adapterName,
                ctx.pluginManager.config
            ) as OB11Group[];
            const config = pluginState.getConfig();

            // 为每个群添加配置信息
            const groupsWithConfig = (groups || []).map((group) => {
                const groupId = String(group.group_id);
                const groupConfig = config.groupConfigs?.[groupId] || {};
                return {
                    ...group,
                    enabled: groupConfig.enabled !== false
                };
            });

            res.json({ code: 0, data: groupsWithConfig });
        } catch (e) {
            pluginState.log('error', '获取群列表失败:', e);
            res.status(500).json({ code: -1, message: String(e) });
        }
    });

    // 更新群配置
    router.postNoAuth('/groups/:id/config', async (req: PluginHttpRequest, res: PluginHttpResponse) => {
        try {
            const groupId = String(req.params?.id || '');
            if (!groupId) {
                return res.status(400).json({ code: -1, message: '缺少群 ID' });
            }

            const body = parseBody(req);
            const { enabled } = body;

            pluginState.updateGroupConfig(ctx, groupId, { enabled: Boolean(enabled) });
            pluginState.log('info', `群 ${groupId} 配置已更新: enabled=${enabled}`);
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            pluginState.log('error', '更新群配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // 批量更新群配置
    router.postNoAuth('/groups/bulk-config', async (req: PluginHttpRequest, res: PluginHttpResponse) => {
        try {
            const body = parseBody(req);
            const { enabled, groupIds } = body;

            if (typeof enabled !== 'boolean' || !Array.isArray(groupIds)) {
                return res.status(400).json({ code: -1, message: '参数错误' });
            }

            const currentGroupConfigs = { ...(pluginState.config.groupConfigs || {}) };
            for (const groupId of groupIds) {
                const gid = String(groupId);
                currentGroupConfigs[gid] = { ...currentGroupConfigs[gid], enabled };
            }

            pluginState.setConfig(ctx, { groupConfigs: currentGroupConfigs });
            pluginState.log('info', `批量更新群配置完成 | 数量: ${groupIds.length}, enabled=${enabled}`);
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            pluginState.log('error', '批量更新群配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // TODO: 在这里添加你的自定义 API 路由

    pluginState.logDebug('API 路由注册完成');
}
