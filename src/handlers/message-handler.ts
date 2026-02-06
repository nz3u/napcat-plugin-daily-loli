/**
 * 消息处理器
 * 处理接收到的消息事件
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';
import type { MessageSegment, ForwardNode } from '../types';

// ==================== CD 冷却管理 ====================

/**
 * CD 冷却记录
 * key: `${groupId}:${command}`, value: 过期时间戳
 */
const cooldownMap = new Map<string, number>();

/**
 * 检查是否在 CD 中
 * @param groupId 群号
 * @param command 命令标识
 * @returns 剩余 CD 秒数，0 表示不在 CD 中
 */
function getCooldownRemaining(groupId: number | string, command: string): number {
    const cdSeconds = pluginState.config.cooldownSeconds ?? 60;
    if (cdSeconds <= 0) return 0;

    const key = `${groupId}:${command}`;
    const expireTime = cooldownMap.get(key);
    if (!expireTime) return 0;

    const remaining = Math.ceil((expireTime - Date.now()) / 1000);
    if (remaining <= 0) {
        cooldownMap.delete(key);
        return 0;
    }
    return remaining;
}

/**
 * 设置 CD 冷却
 * @param groupId 群号
 * @param command 命令标识
 */
function setCooldown(groupId: number | string, command: string): void {
    const cdSeconds = pluginState.config.cooldownSeconds ?? 60;
    if (cdSeconds <= 0) return;

    const key = `${groupId}:${command}`;
    cooldownMap.set(key, Date.now() + cdSeconds * 1000);
}

// ==================== 消息发送工具 ====================

/**
 * 发送群消息
 * @param ctx 插件上下文
 * @param groupId 群号
 * @param message 消息内容
 */
export async function sendGroupMessage(ctx: NapCatPluginContext, groupId: number | string, message: MessageSegment[]): Promise<boolean> {
    try {
        await ctx.actions.call(
            'send_group_msg',
            {
                group_id: groupId,
                message: message
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        return true;
    } catch (error) {
        pluginState.log('error', `发送群消息失败:`, error);
        return false;
    }
}

/**
 * 发送私聊消息
 * @param ctx 插件上下文
 * @param userId 用户 QQ 号
 * @param message 消息内容
 */
export async function sendPrivateMessage(ctx: NapCatPluginContext, userId: number | string, message: MessageSegment[]): Promise<boolean> {
    try {
        await ctx.actions.call(
            'send_private_msg',
            {
                user_id: userId,
                message: message
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        return true;
    } catch (error) {
        pluginState.log('error', `发送私聊消息失败:`, error);
        return false;
    }
}

/**
 * 发送群合并转发消息
 * @param ctx 插件上下文
 * @param groupId 群号
 * @param nodes 转发消息节点列表
 */
export async function sendGroupForwardMsg(ctx: NapCatPluginContext, groupId: number | string, nodes: ForwardNode[]): Promise<boolean> {
    try {
        await ctx.actions.call(
            'send_group_forward_msg',
            {
                group_id: groupId,
                messages: nodes
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        return true;
    } catch (error) {
        pluginState.log('error', `发送合并转发消息失败:`, error);
        return false;
    }
}

/**
 * 发送表情回复（回应消息）
 * @param ctx 插件上下文
 * @param messageId 消息 ID
 * @param emojiId 表情 ID
 */
export async function setMsgEmojiLike(ctx: NapCatPluginContext, messageId: string | number, emojiId: string): Promise<boolean> {
    try {
        await ctx.actions.call(
            'set_msg_emoji_like',
            {
                message_id: messageId,
                emoji_id: emojiId
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        return true;
    } catch (error) {
        pluginState.log('error', `发送表情回复失败:`, error);
        return false;
    }
}

/**
 * 上传群文件
 * @param ctx 插件上下文
 * @param groupId 群号
 * @param filePath 本地文件路径
 * @param fileName 文件名
 */
export async function uploadGroupFile(ctx: NapCatPluginContext, groupId: number | string, filePath: string, fileName: string): Promise<boolean> {
    try {
        await ctx.actions.call(
            'upload_group_file',
            {
                group_id: groupId,
                file: filePath,
                name: fileName
            },
            ctx.adapterName,
            ctx.pluginManager.config
        );
        return true;
    } catch (error) {
        pluginState.log('error', `上传群文件失败:`, error);
        return false;
    }
}

// ==================== 消息段构建器 ====================

/**
 * 构建文本消息段
 */
export function textSegment(text: string): MessageSegment {
    return { type: 'text', data: { text } };
}

/**
 * 构建图片消息段
 * @param file 图片路径或 URL 或 base64
 */
export function imageSegment(file: string): MessageSegment {
    return { type: 'image', data: { file } };
}

/**
 * 构建 @ 消息段
 * @param qq QQ 号，'all' 表示 @全体成员
 */
export function atSegment(qq: string | number): MessageSegment {
    return { type: 'at', data: { qq: String(qq) } };
}

/**
 * 构建回复消息段
 * @param messageId 要回复的消息 ID
 */
export function replySegment(messageId: string | number): MessageSegment {
    return { type: 'reply', data: { id: String(messageId) } };
}

/**
 * 构建合并转发消息节点
 * @param userId 用户 ID
 * @param nickname 昵称
 * @param content 消息内容
 */
export function buildForwardNode(userId: string, nickname: string, content: MessageSegment[]): ForwardNode {
    return {
        type: 'node',
        data: { user_id: userId, nickname, content }
    };
}

// ==================== 消息处理主函数 ====================

/**
 * 消息处理主函数
 * 在这里实现你的消息处理逻辑
 */
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message): Promise<void> {
    try {
        // 获取消息内容
        const rawMessage = event.raw_message || '';
        const messageType = event.message_type; // 'group' | 'private'
        const groupId = (event as unknown as { group_id?: number | string }).group_id;
        const userId = event.user_id;
        const messageId = event.message_id;

        pluginState.logDebug(`收到消息: ${rawMessage} | 类型: ${messageType}`);

        // 如果是群消息，检查该群是否启用
        if (messageType === 'group' && groupId) {
            if (!pluginState.isGroupEnabled(String(groupId))) {
                pluginState.logDebug(`群 ${groupId} 未启用，跳过处理`);
                return;
            }
        }

        // 获取命令前缀
        const prefix = pluginState.config.commandPrefix || '#cmd';

        // 检查是否为命令消息
        if (!rawMessage.startsWith(prefix)) return;

        // 解析命令参数
        const args = rawMessage.slice(prefix.length).trim().split(/\s+/);
        const subCommand = args[0]?.toLowerCase() || '';

        // TODO: 在这里实现你的命令处理逻辑
        // 示例：处理不同的子命令

        switch (subCommand) {
            case 'help': {
                // 帮助命令
                const helpText = [
                    `📖 插件帮助`,
                    `${prefix} help - 显示帮助信息`,
                    `${prefix} ping - 测试连通性`,
                    `${prefix} status - 查看运行状态`,
                ].join('\n');

                if (messageType === 'group' && groupId) {
                    await sendGroupMessage(ctx, groupId, [
                        replySegment(messageId),
                        textSegment(helpText)
                    ]);
                } else if (messageType === 'private') {
                    await sendPrivateMessage(ctx, userId, [textSegment(helpText)]);
                }
                break;
            }

            case 'ping': {
                // 检查 CD 冷却
                if (messageType === 'group' && groupId) {
                    const remaining = getCooldownRemaining(groupId, 'ping');
                    if (remaining > 0) {
                        await sendGroupMessage(ctx, groupId, [
                            replySegment(messageId),
                            textSegment(`⏳ 请等待 ${remaining} 秒后再试`)
                        ]);
                        return;
                    }
                }

                // 回复 pong
                if (messageType === 'group' && groupId) {
                    await sendGroupMessage(ctx, groupId, [
                        replySegment(messageId),
                        textSegment('🏓 pong!')
                    ]);
                    // 成功后设置 CD
                    setCooldown(groupId, 'ping');
                } else if (messageType === 'private') {
                    await sendPrivateMessage(ctx, userId, [textSegment('🏓 pong!')]);
                }
                pluginState.incrementProcessedCount();
                break;
            }

            case 'status': {
                // 状态命令
                const uptime = pluginState.getUptimeFormatted();
                const stats = pluginState.stats;
                const statusText = [
                    `📊 插件状态`,
                    `运行时长: ${uptime}`,
                    `今日处理: ${stats.todayProcessed}`,
                    `总计处理: ${stats.processed}`,
                ].join('\n');

                if (messageType === 'group' && groupId) {
                    await sendGroupMessage(ctx, groupId, [
                        replySegment(messageId),
                        textSegment(statusText)
                    ]);
                } else if (messageType === 'private') {
                    await sendPrivateMessage(ctx, userId, [textSegment(statusText)]);
                }
                break;
            }

            default: {
                // 未知命令或主命令
                // TODO: 在这里处理你的主要命令逻辑
                break;
            }
        }

    } catch (error) {
        pluginState.log('error', '处理消息时出错:', error);
    }
}
