import type { OB11Message, OB11PostSendMsg } from '../napcat';
import type { NapCatPluginContext } from '../napcat';
import type { MessageSegment } from '../types';

export function isTodayImageCommand(event: OB11Message): boolean {
    // 只接受纯文本消息；不把引用、图片或 CQ 码当作触发文字。
    if (Array.isArray(event.message)) {
        if (event.message.some(segment => segment.type !== 'text')) return false;
        const content = event.message.map(segment => String((segment.data as { text?: unknown }).text ?? '')).join('');
        return content.trim() === '今日图片';
    }
    return (event.raw_message || '').trim() === '今日图片';
}

export async function sendGroupMessage(
    ctx: NapCatPluginContext, group: string, message: MessageSegment[], signal?: AbortSignal,
): Promise<boolean> {
    if (signal?.aborted) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
        const cancelled = new Promise<never>((_resolve, reject) => {
            abort = () => reject(new Error('插件已停止等待发送结果'));
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => reject(new Error('QQ 发送结果等待超时（30秒）')), 30_000);
        });
        const params: OB11PostSendMsg = { message_type: 'group', group_id: group, message };
        // NapCat action 没有取消 API；这里只限制等待时间，不能撤回已提交的消息。
        const response = await Promise.race([
            ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config), cancelled,
        ]);
        if (response && typeof response === 'object') {
            const result = response as unknown as { status?: string; retcode?: number };
            if (result.status === 'failed' || (typeof result.retcode === 'number' && result.retcode !== 0)) {
                throw new Error(`OneBot 发送失败，retcode=${result.retcode}`);
            }
        }
        return true;
    } catch (error) {
        if (!signal?.aborted) ctx.logger.error(`发送群 ${group} 消息失败:`, error);
        return false;
    } finally {
        if (timer) clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
    }
}
