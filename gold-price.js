const config = require("./config").gold;

function normalizeRows(rows) {
    const prices = [];
    for (const cells of rows || []) {
        const values = cells.map(value => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
        // 有些表格首列是分类，有些一行横排两个商品。
        // 商品名后的第一个数字始终是该商品的“回购”列。
        for (let index = 0; index + 1 < values.length; index += 1) {
            const name = values[index];
            const isName = name && !/-?\d+(?:\.\d+)?/.test(name);
            const match = values[index + 1]?.match(/-?\d+(?:\.\d+)?/);
            if (isName && match && !/商品|回购|销售|高.?低|更新时间|行情$/.test(name)) {
                prices.push({ name, price: Number(match[0]) });
            }
        }
    }
    return prices.filter((item, index, all) =>
        Number.isFinite(item.price) && all.findIndex(other => other.name === item.name) === index
    );
}

function isGoldQuestion(text) {
    const value = String(text || "").replace(/\s+/g, "");
    return (
        /(金价|黄金|足金|回收价|回购|多少钱一克|一克多少钱|999|9999|au99|金条|金饰|克价)/i.test(value)
        ||
        /(?:今天|今日|现在|目前).{0,6}(?:什么价|多少价|价格|价钱)/.test(value)
        ||
        /(?:今天|今日|现在|目前).{0,6}多少钱/.test(value)
        ||
        /(?:什么价|多少价|价格多少|价钱多少)(?:了|啊|呀|呢)?$/.test(value)
    );
}

class GoldPriceService {
    constructor() {
        this.page = null;
        this.snapshot = null;
        this.running = false;
    }

    async start(browserContext) {
        if (!config.enabled) return;
        this.page = await browserContext.newPage();
        await this.page.goto(`${config.url}${config.url.includes("?") ? "&" : "?"}_t=${Date.now()}`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });
        this.running = true;
        this.poll().catch(error => console.error("GOLD_POLL_FATAL", error.message));
    }

    async poll() {
        while (this.running) {
            try {
                const rows = await this.page.locator("table tr").evaluateAll(nodes =>
                    nodes.map(row => [...row.querySelectorAll("th,td")].map(cell => cell.textContent || ""))
                );
                const prices = normalizeRows(rows).filter(item =>
                    item.name.replace(/\s+/g, "") === config.productName.replace(/\s+/g, "")
                );
                if (prices.length) {
                    const changed = JSON.stringify(prices) !== JSON.stringify(this.snapshot?.prices);
                    this.snapshot = { prices, fetchedAt: Date.now() };
                    if (changed) console.log(`[${new Date().toLocaleTimeString()}] GOLD_UPDATED`, prices);
                }
            } catch (error) {
                console.error("GOLD_POLL_ERROR", error.message);
            }
            await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
        }
    }

    async stop() {
        this.running = false;
        if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
        this.page = null;
    }

    getContext(text) {
        if (!isGoldQuestion(text)) return "";
        if (!this.snapshot || Date.now() - this.snapshot.fetchedAt > config.staleAfterMs) {
            return "实时回收金价当前无法可靠获取。请明确告知客户暂时无法报价，并建议稍后再问或转人工；禁止引用历史价格。";
        }
        const item = this.snapshot.prices[0];
        return [
            `店铺实时回购报价（采集时间：${new Date(this.snapshot.fetchedAt).toLocaleString("zh-CN")}）：`,
            `${item.name}：${item.price}元/克`,
            "只回复这一项回购价格，不得加入其他品类、销售价、最高价或最低价。"
        ].join("\n");
    }
}

module.exports = { GoldPriceService, isGoldQuestion, normalizeRows };
