import type { PluginModule, PluginConfigSchema } from './napcat';
import { buildConfigSchema } from './config';
import { PluginState } from './core/state';
import { DailyRuntime } from './services/api-service';

export let plugin_config_ui: PluginConfigSchema = [];
let runtime: DailyRuntime | undefined;
let stopping: Promise<void> = Promise.resolve();

/**
 * 初始化。重复调用（重载、HMR 或框架二次初始化）时会先停用上一个实例，
 * 保证同一进程内只有一份运行时在监听消息和定时任务，避免重复回复。
 */
export const plugin_init: PluginModule['plugin_init'] = async ctx => {
    const previous = runtime;
    runtime = undefined;
    if (previous) await previous.stop();
    else await stopping;

    const instance = new DailyRuntime(ctx);
    // 抢占用：上一个实例即使仍在收尾，也不再是生效实例。
    const displaced = DailyRuntime.takeOver(instance);
    if (displaced && displaced !== instance) await displaced.stop();
    runtime = instance;
    // 配置面板与运行时读取同一份配置，空群号列表不会被默认值覆盖。
    plugin_config_ui = buildConfigSchema(ctx);
    instance.start();
    ctx.logger.info('每日 LC0 图片插件已加载：北京时间 07:21；请在插件配置中填写目标群号。');
};

export const plugin_onmessage: PluginModule['plugin_onmessage'] = async (_ctx, event) => {
    if (event.post_type !== 'message') return;
    // 只把事件交给当前生效实例，忽略已停用的旧实例。
    await DailyRuntime.active?.onMessage(event);
};

export const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
    const current = runtime;
    runtime = undefined;
    stopping = current?.stop() ?? Promise.resolve();
    await stopping;
};

/**
 * 供 NapCat 配置面板读取。运行时未就绪时直接从磁盘读取用户保存的配置，
 * 不回退到默认值 —— 否则面板可能显示（并再次保存）空的群号列表，
 * 造成“没填群号也能触发 / 填了才正常”的不一致。
 */
export const plugin_get_config: PluginModule['plugin_get_config'] = async ctx => {
    return runtime?.state.config ?? new PluginState(ctx).config;
};

export const plugin_set_config: PluginModule['plugin_set_config'] = async (_ctx, config) => {
    if (!runtime) throw new Error('插件尚未初始化');
    runtime.state.replaceConfig(config);
    runtime.configChanged();
};
// 所有字段非 reactive：只在用户点击保存（plugin_set_config）后应用，
// 避免编辑群号的中间状态触发实际推送。
