// 预览两种版本的实际发送文本（只读取公共接口，不发送任何消息）。
import { API_ENDPOINTS, parseDailyData, buildDailyMessage } from '../src/services/daily-service';
const response = await fetch(API_ENDPOINTS[0], { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const raw = await response.json();
const data = parseDailyData(raw, (raw as { date: string }).date);
for (const compact of [false, true]) {
    console.log(`===== ${compact ? '简略版' : '详细版'} =====`);
    for (const segment of buildDailyMessage(data, compact)) {
        if (segment.type === 'text') console.log((segment.data as { text: string }).text);
        else console.log(`[图片] ${(segment.data as { file: string }).file}`);
    }
}
