// 手动在线检查：只读取公共 LC0 接口，不连接 QQ、不发送消息。
import { API_ENDPOINTS, parseDailyData, buildDailyMessage, contentDate } from '../src/services/daily-service';
const response = await fetch(API_ENDPOINTS[0], { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const raw = await response.json();
const data = parseDailyData(raw, raw.date);
console.log(JSON.stringify({
    sourceDate: data.date,
    expectedContentDate: contentDate(),
    isCurrent: data.date === contentDate(),
    cards: data.cards.length,
    tags: data.cards.map(card => card.tags),
    segments: buildDailyMessage(data).length,
    qqMessagesSent: 0,
}, null, 2));
