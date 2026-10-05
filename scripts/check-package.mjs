import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as plugin from '../dist/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.test-data');
fs.mkdirSync(scratch, { recursive: true });
const temp = fs.mkdtempSync(path.join(scratch, 'package-'));
let sends = 0;
const field = type => (key, label, value, description, reactive) => ({ key, label, type, default: value, description, reactive });
const ctx = {
    configPath: path.join(temp, 'config.json'), dataPath: path.join(temp, 'data'),
    adapterName: 'test', pluginManager: { config: {} },
    logger: { info() {}, warn() {}, error() {} },
    actions: { async call() { sends++; throw new Error('Smoke test must not send any QQ message'); } },
    NapCatConfig: {
        plainText: label => ({ type: 'text', key: '', label }), combine: (...items) => items,
        boolean: field('boolean'), text: field('string'), number: field('number'),
    },
};
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'dist/package.json'), 'utf8'));
    assert.equal(pkg.name, 'napcat-plugin-daily-loli');
    assert.equal(pkg.main, 'index.mjs');
    assert.ok(!pkg.dependencies);
    assert.equal(pkg.napcat?.icon, 'icon.png', 'package.json 应声明 icon');
    assert.ok(fs.existsSync(path.join(root, 'dist/icon.png')), '构建产物应包含 icon.png');
    for (const name of ['plugin_init', 'plugin_onmessage', 'plugin_cleanup', 'plugin_get_config', 'plugin_set_config']) {
        assert.equal(typeof plugin[name], 'function');
    }
    await plugin.plugin_init(ctx);
    assert.equal(plugin.plugin_config_ui.filter(item => item.key).length, 8);
    assert.equal((await plugin.plugin_get_config(ctx)).scheduledGroups, '');
    assert.equal((await plugin.plugin_get_config(ctx)).keywordGroups, '');
    assert.equal((await plugin.plugin_get_config(ctx)).compactMode, false);
    await plugin.plugin_set_config(ctx, { enabled: false, scheduledGroups: '123456789', keywordGroups: '123456789' });
    assert.equal((await plugin.plugin_get_config(ctx)).enabled, false);
    await plugin.plugin_onmessage(ctx, {
        post_type: 'message', message_type: 'group', group_id: '123456789',
        self_id: '10001', user_id: '20002', raw_message: '今日图片',
        message: [{ type: 'text', data: { text: '今日图片' } }],
    });
    assert.equal(sends, 0);
    console.log('Built package smoke test passed: lifecycle, config schema, safe defaults, no QQ sends.');
} finally {
    await plugin.plugin_cleanup(ctx);
    const target = path.resolve(temp);
    assert.equal(path.dirname(target), scratch);
    assert.ok(path.basename(target).startsWith('package-'));
    fs.rmSync(target, { recursive: true, force: true });
}
