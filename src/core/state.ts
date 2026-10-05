import fs from 'node:fs';
import path from 'node:path';
import type { NapCatPluginContext } from '../napcat';
import { DEFAULT_CONFIG, sanitizeConfig } from '../config';
import type { DeliveryHistory, PluginConfig } from '../types';

/** 写入临时文件后原子替换，避免中途退出留下半个 JSON。 */
export function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, file);
}

export class PluginState {
    config: PluginConfig = { ...DEFAULT_CONFIG };
    history: DeliveryHistory = { date: '', groups: [] };
    constructor(readonly ctx: NapCatPluginContext) {
        fs.mkdirSync(ctx.dataPath, { recursive: true });
        this.config = this.readConfig();
        try {
            if (fs.existsSync(this.historyPath)) {
                const raw = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
                if (typeof raw.date === 'string' && Array.isArray(raw.groups)) {
                    this.history = { date: raw.date, groups: raw.groups.filter((id: unknown) => typeof id === 'string') };
                }
            }
        } catch (error) { ctx.logger.warn('推送历史读取失败:', error); }
    }
    private get historyPath(): string { return path.join(this.ctx.dataPath, 'delivery-history.json'); }

    /**
     * 读取磁盘配置；文件不存在或损坏时回退默认值。
     * NapCat 可能把配置包在 `config` 字段里，两种格式都接受，
     * 避免插件内看到的配置与用户在面板里保存的不一致。
     */
    private readConfig(): PluginConfig {
        try {
            if (!fs.existsSync(this.ctx.configPath)) return { ...DEFAULT_CONFIG };
            const raw: unknown = JSON.parse(fs.readFileSync(this.ctx.configPath, 'utf8'));
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                const wrapped = (raw as Record<string, unknown>).config;
                if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
                    // 外层字段优先，其次是被包裹的 config 字段。
                    return sanitizeConfig({ ...(wrapped as Record<string, unknown>), ...(raw as Record<string, unknown>) });
                }
            }
            return sanitizeConfig(raw);
        } catch (error) {
            this.ctx.logger.warn('配置读取失败，使用默认配置:', error);
            return { ...DEFAULT_CONFIG };
        }
    }

    private saveConfig(): void { writeJson(this.ctx.configPath, this.config); }
    replaceConfig(value: unknown): void {
        const config = sanitizeConfig(value);
        writeJson(this.ctx.configPath, config);
        this.config = config;
    }
    updateConfig(value: unknown): void {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        this.replaceConfig({ ...this.config, ...value });
    }
    wasDelivered(date: string, group: string): boolean {
        return this.history.date === date && this.history.groups.includes(group);
    }
    markDelivered(date: string, group: string): void {
        if (this.history.date !== date) this.history = { date, groups: [] };
        if (!this.history.groups.includes(group)) this.history.groups.push(group);
        // 保留内存标记：即使落盘失败也不在本次进程内重复推送。
        try { writeJson(this.historyPath, this.history); }
        catch (error) { this.ctx.logger.error('推送历史保存失败，重启后可能重复推送:', error); }
    }
}
