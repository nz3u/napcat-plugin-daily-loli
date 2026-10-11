import type { NapCatPluginContext } from '../napcat';
import type { OB11Message } from '../napcat';
import { parseGroupIds } from '../config';
import { PluginState } from '../core/state';
import { DailyClient, contentDate, isAfterRelease, buildDailyMessage } from './daily-service';
import { isTodayImageCommand, sendGroupMessage } from '../handlers/message-handler';
import type { DailyData, MessageSegment } from '../types';

/**
 * 每 20 秒检查北京时间，逐群记录成功状态；重试不会重发已经成功的群。
 *
 * 同一进程只允许一个生效实例：NapCat 重载或重复初始化时，
 * 旧实例会被停用，避免一条消息被多个实例重复响应。
 */
export class DailyRuntime {
    readonly state: PluginState;
    private readonly abortController = new AbortController();
    private readonly client: DailyClient;
    private timer?: ReturnType<typeof setInterval>;
    private active = true;
    private scheduledTask?: Promise<void>;
    private nextAttempt = 0;
    /** 连续失败计数所属的内容日；跨日自动重新开始计数。 */
    private failureDate?: string;
    private consecutiveFailures = 0;
    /** 已达到重试上限、停止自动重试的内容日；换日或改配置后恢复。 */
    private haltedDate?: string;
    private readonly keywordTasks = new Map<string, Promise<void>>();
    /** 记录每个群冷却起点及故障兜底时长，避免时钟问题导致冷却失效。 */
    private readonly lastTriggerAt = new Map<string, { startedAt: number; minimumMs: number }>();
    /** 已经处理过的消息 id，兜底拦截 NapCat 重复投递的同一事件。 */
    private readonly handledMessages = new Set<string>();
    private static current?: DailyRuntime;

    constructor(
        readonly ctx: NapCatPluginContext,
        fetcher: typeof fetch = fetch,
        private readonly clock: () => Date = () => new Date(),
    ) {
        this.state = new PluginState(ctx);
        this.client = new DailyClient(() => this.state.config.requestTimeoutSeconds, this.abortController.signal, fetcher);
    }
    /**
     * 接管为当前生效实例并停用上一个实例。
     * 返回被接管的旧实例，调用方可等待其排空。
     */
    static takeOver(instance: DailyRuntime): DailyRuntime | undefined {
        const candidate = instance as DailyRuntime & { registered?: boolean };
        const previous = DailyRuntime.current;
        DailyRuntime.current = instance;
        candidate.registered = true;
        if (previous && previous !== instance) previous.active = false;
        return previous;
    }
    static get active(): DailyRuntime | undefined {
        return DailyRuntime.current?.active ? DailyRuntime.current : undefined;
    }
    get isActive(): boolean { return this.active; }
    /** 只有当本实例是当前生效实例时才处理事件。 */
    private get isCurrent(): boolean { return DailyRuntime.current === undefined || DailyRuntime.current === this; }
    start(): void {
        if (!this.active || this.timer) return;
        const config = this.state.config;
        if (!parseGroupIds(config.scheduledGroups).length) {
            this.ctx.logger.info('定时推送群号为空，不会自动发送；请在插件配置中填写目标群。');
        }
        if (!parseGroupIds(config.keywordGroups).length) {
            this.ctx.logger.info('关键词触发群号为空，“今日图片”不会在任何群生效；请在插件配置中填写目标群。');
        }
        this.timer = setInterval(() => { void this.tick(); }, 20_000);
        this.timer.unref?.();
        void this.tick();
    }
    async stop(): Promise<void> {
        this.active = false;
        if (DailyRuntime.current === this) DailyRuntime.current = undefined;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.abortController.abort();
        await Promise.allSettled([this.scheduledTask, ...this.keywordTasks.values()].filter(Boolean));
        this.lastTriggerAt.clear();
        this.handledMessages.clear();
    }
    configChanged(): void {
        this.nextAttempt = 0;
        // 用户改配置视为一次人工干预：清除停止重试状态并重新计数。
        this.haltedDate = undefined;
        this.failureDate = undefined;
        this.consecutiveFailures = 0;
        void this.tick();
    }
    private scheduledAllowed(group: string): boolean {
        const config = this.state.config;
        return this.active && this.isCurrent && config.enabled && config.scheduledEnabled
            && parseGroupIds(config.scheduledGroups).includes(group);
    }
    /** 白名单为空即视为“未配置”，必须 fail-closed（不回任何群）。 */
    private keywordAllowed(group: string): boolean {
        const config = this.state.config;
        if (!this.active || !this.isCurrent || !config.enabled || !config.keywordEnabled) return false;
        const groups = parseGroupIds(config.keywordGroups);
        return groups.length > 0 && groups.includes(group);
    }

    async tick(now = this.clock()): Promise<void> {
        const config = this.state.config;
        if (!this.active || !config.enabled || !config.scheduledEnabled || !isAfterRelease(now)) return;
        if (this.scheduledTask || now.getTime() < this.nextAttempt) return;
        const date = contentDate(now);
        const groups = parseGroupIds(config.scheduledGroups).filter(id => !this.state.wasDelivered(date, id));
        if (!groups.length) return;
        // 换日重新开始计数，并解除上一日的停止状态。
        if (this.failureDate !== date) { this.failureDate = date; this.consecutiveFailures = 0; }
        if (this.haltedDate === date) return;
        this.nextAttempt = now.getTime() + 60_000;
        const task = this.deliverScheduled(now, date, groups);
        this.scheduledTask = task;
        try { await task; }
        finally { if (this.scheduledTask === task) this.scheduledTask = undefined; }
    }
    private async deliverScheduled(now: Date, date: string, groups: string[]): Promise<void> {
        try {
            // 定时任务不复用关键词的旧缓存，07:21 必须重新查询。
            const daily = await this.client.get(now, true);
            let sent = false;
            for (const group of groups) {
                if (!this.scheduledAllowed(group) || contentDate(this.clock()) !== date) continue;
                const ok = await this.deliver(group, daily);
                if (ok) { this.state.markDelivered(date, group); sent = true; }
            }
            // 至少有一个群成功即视为本轮成功，重置连续失败计数。
            if (sent) { this.consecutiveFailures = 0; return; }
            this.countFailure(date, groups, '所有目标群发送失败');
        } catch (error) {
            this.countFailure(date, groups, error instanceof Error ? error.message : String(error));
        }
    }
    /**
     * 累计一次失败；达到上限时停止当天重试并按需提醒，等待人工排查。
     *
     * 计数按内容日隔离：跨日自动从头开始，避免昨日的失败拖住今天。
     */
    private countFailure(date: string, groups: string[], reason: string): void {
        if (this.failureDate !== date) { this.failureDate = date; this.consecutiveFailures = 0; }
        const limit = Math.max(0, this.state.config.maxRetryAttempts);
        if (limit === 0) {
            if (this.active) this.ctx.logger.warn(`每日定时推送失败：${reason}；将于一分钟后重试。`);
            return;
        }
        const attempts = ++this.consecutiveFailures;
        if (attempts < limit) {
            if (this.active) {
                this.ctx.logger.warn(`每日定时推送失败（第 ${attempts}/${limit} 次）：${reason}；将于一分钟后重试。`);
            }
            return;
        }
        // 到达上限：停止当天重试，不再自动继续，等人工修复配置或环境。
        if (this.haltedDate === date) return;
        this.haltedDate = date;
        const message = `每日定时推送已连续失败 ${attempts} 次，达到上限 ${limit}，当天停止重试，等待人工排查。最后失败原因：${reason}`;
        if (this.active) this.ctx.logger.error(message);
        if (!this.state.config.failureAlertEnabled) return;
        const targets = groups.filter(group => this.scheduledAllowed(group));
        if (!targets.length) return;
        void this.sendFailureAlert(targets, message);
    }
    private async sendFailureAlert(groups: string[], reason: string): Promise<void> {
        const message: MessageSegment[] = [{
            type: 'text',
            data: { text: `今日图片推送失败提醒：${reason}\n插件当天已停止自动重试，请检查接口、网络、群白名单与机器人发言权限后，在插件配置中重新保存或重载插件以恢复。` },
        }];
        for (const group of groups) {
            await sendGroupMessage(this.ctx, group, message, this.abortController.signal);
        }
    }
    private async deliver(group: string, daily: DailyData): Promise<boolean> {
        const ok = await sendGroupMessage(this.ctx, group, buildDailyMessage(daily, this.state.config.compactMode), this.abortController.signal);
        if (ok) this.ctx.logger.info(`LC0 图片已推送到群 ${group}（${daily.date}）`);
        return ok;
    }
    /**
     * 计算某群剩余的冷却毫秒数。
     * 冷却时长取“配置值”与“本次记录的有效值”中的较大者，
     * 这样故障兜底的十秒冷却在 cooldownSeconds=0 时同样生效。
     */
    private cooldownRemaining(group: string, now: number): number {
        const entry = this.lastTriggerAt.get(group);
        if (!entry) return 0;
        const configured = Math.max(0, this.state.config.cooldownSeconds) * 1000;
        const effective = Math.max(configured, entry.minimumMs);
        if (effective <= 0) return 0;
        const elapsed = now - entry.startedAt;
        // 时钟回拨时按“仍在冷却”处理，避免误放行。
        if (elapsed < 0) return effective;
        return Math.max(0, effective - elapsed);
    }
    /**
     * 记录冷却起点；在真正发起请求之前调用，避免并发穿透。
     * minimumMs 用于故障兜底，可高于配置值。
     */
    private armCooldown(group: string, now: number, minimumMs = 0): void {
        this.lastTriggerAt.set(group, { startedAt: now, minimumMs: Math.max(0, minimumMs) });
    }
    private messageKey(event: OB11Message): string | undefined {
        const id = (event as { message_id?: number | string }).message_id;
        // 只有拿得到明确的消息 id 时才做去重，避免把用户短时间内重复发送的
        // 相同内容误判为框架重复投递。
        if (id === undefined || id === null || String(id) === '') return undefined;
        return `id:${event.group_id}:${id}`;
    }
    async onMessage(event: OB11Message): Promise<void> {
        if (!this.active || !this.isCurrent) return;
        if (event.message_type !== 'group' || !event.group_id) return;
        if (String(event.user_id) === String(event.self_id)) return;
        const group = String(event.group_id);
        if (!this.keywordAllowed(group) || !isTodayImageCommand(event)) return;

        const key = this.messageKey(event);
        if (key !== undefined) {
            if (this.handledMessages.has(key)) return;
            // 先占位再判断冷却，确保同一事件不会被并发或重复投递处理两次。
            this.handledMessages.add(key);
            if (this.handledMessages.size > 500) {
                const oldest = this.handledMessages.values().next().value;
                if (oldest !== undefined) this.handledMessages.delete(oldest);
            }
        }

        const now = this.clock().getTime();
        if (this.keywordTasks.has(group) || this.cooldownRemaining(group, now) > 0) return;
        // 在请求前上锁并起算冷却，阻止多个并发消息绕过冷却。
        this.armCooldown(group, now);
        const task = this.deliverKeyword(group);
        this.keywordTasks.set(group, task);
        try { await task; }
        finally { if (this.keywordTasks.get(group) === task) this.keywordTasks.delete(group); }
    }
    private async deliverKeyword(group: string): Promise<void> {
        try {
            let daily = await this.client.get(this.clock());
            // 网络请求跨过 07:21 时重新取新日数据，不发送昨日图片。
            if (daily.date !== contentDate(this.clock())) daily = await this.client.get(this.clock(), true);
            if (!this.keywordAllowed(group)) return;
            if (!await this.deliver(group, daily)) throw new Error('QQ群发送失败');
        } catch (error) {
            if (this.abortController.signal.aborted || !this.keywordAllowed(group)) return;
            this.ctx.logger.warn('今日图片获取失败:', error);
            // 失败时至少保留十秒冷却，避免故障时刷屏。
            this.armCooldown(group, this.clock().getTime(), 10_000);
            await sendGroupMessage(this.ctx, group, [{
                type: 'text', data: { text: '今日 LC0 图片暂时不可用，请稍后再试。' },
            }], this.abortController.signal);
        }
    }
}
