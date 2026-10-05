import { resolve, dirname } from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    build: {
        target: 'node20',
        minify: false,
        lib: {
            entry: resolve(root, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.mjs',
        },
        rollupOptions: {
            external: [...builtinModules, ...builtinModules.map(name => `node:${name}`)],
        },
        outDir: 'dist',
    },
    plugins: [{
        name: 'plugin-package',
        writeBundle() {
            const pkg = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8'));
            // 构建产物无第三方运行时依赖。
            const { name, plugin, version, type, main, description, author, license, napcat } = pkg;
            fs.writeFileSync(resolve(root, 'dist/package.json'), JSON.stringify({
                name, plugin, version, type, main, description, author, license, napcat,
            }, null, 2));
            for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'icon.png']) {
                fs.copyFileSync(resolve(root, file), resolve(root, 'dist', file));
            }
        },
    }],
});
