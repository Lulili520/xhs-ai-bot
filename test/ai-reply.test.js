const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGoldPriceReply, buildRequest, cleanReply, fallbackReply, getOutputText, isStrongSellIntent } = require("../src/core/ai-reply");
const { isGoldQuestion, normalizeRows, requestedProduct } = require("../src/core/gold-price");
const { enforceBusinessRules } = require("../src/core/ai-reply");
const { retrieveKnowledge } = require("../src/core/knowledge-base");

test("extracts Responses API output text", () => {
    assert.equal(getOutputText({ output: [{ content: [{ type: "output_text", text: "您好" }] }] }), "您好");
});

test("extracts DeepSeek Chat Completions output text", () => {
    assert.equal(getOutputText({ choices: [{ message: { content: "您好" } }] }), "您好");
});

test("builds a non-thinking DeepSeek request", () => {
    const request = buildRequest("u1", "黄金多少钱", "足金999：800元/克", {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash"
    });
    assert.equal(request.url, "https://api.deepseek.com/chat/completions");
    assert.equal(request.body.model, "deepseek-v4-flash");
    assert.deepEqual(request.body.thinking, { type: "disabled" });
    assert.match(request.body.messages[0].content, /800元\/克/);
});

test("cleans and bounds model output", () => {
    assert.equal(cleanReply("  您好\n  请问有什么需要？  "), "您好 请问有什么需要？");
});

test("fallback does not claim an action was completed", () => {
    const reply = fallbackReply("帮我退款");
    assert.doesNotMatch(reply, /已经退款/);
    assert.match(reply, /什么物品|图片/);
});

test("normalizes paired gold quote table cells", () => {
    assert.deepEqual(normalizeRows([["黄金", "812.50", "900.00", "920/800"]]), [
        { name: "黄金", price: 812.5 }
    ]);
    assert.equal(isGoldQuestion("今天999回收多少钱一克"), true);
    assert.equal(isGoldQuestion("你好，在吗"), false);
    assert.equal(isGoldQuestion("物流什么时候到"), false);
});

test("recognizes colloquial gold price questions", () => {
    assert.equal(isGoldQuestion("今天什么价格"), true);
    assert.equal(isGoldQuestion("现在多少价呀"), true);
    assert.equal(isGoldQuestion("价格多少"), true);
    assert.equal(isGoldQuestion("今天多少钱"), true);
});

test("extracts gold buyback after a category column", () => {
    assert.deepEqual(normalizeRows([
        ["水贝板料行情", "黄金", "↑945.50", "↑948.50", "↑948.00↑947.50"]
    ]), [{ name: "黄金", price: 945.5 }]);
});

test("gold quote answers first and delays WeChat guidance for weak intent", async () => {
    const { buildReply } = require("../src/core/ai-reply");
    const context = "店铺实时回购报价：\n黄金：945.5元/克";
    const first = await buildReply("staged-user", "黄金多少钱", context);
    const second = await buildReply("staged-user", "先了解一下", context);
    const third = await buildReply("staged-user", "最近会涨吗", context);
    assert.match(first.reply, /945\.5元\/克/);
    assert.doesNotMatch(first.reply, /微信|名片/);
    assert.doesNotMatch(second.reply, /微信|名片/);
    assert.match(third.reply, /微信|名片/);
    assert.equal(first.source, "gold_price");
});

test("gold quote wording varies without changing the price", () => {
    const replies = Array.from({ length: 5 }, (_, index) => buildGoldPriceReply("945.5元/克", index));
    assert.equal(new Set(replies).size, 5);
    assert.equal(replies.every(reply => reply.includes("945.5元/克")), true);
});

test("strong selling intent immediately guides WeChat", () => {
    assert.equal(isStrongSellIntent("我有30克黄金想卖掉"), true);
    assert.equal(isStrongSellIntent("先看看行情"), false);
    assert.match(fallbackReply("我今天就想卖", ""), /微信|名片/);
});

test("recognizes specific precious metal products without substituting gold", () => {
    assert.equal(requestedProduct("铂金pt950多少钱").name, "铂金");
    assert.equal(requestedProduct("18k金回收价").name, "18K金");
    assert.equal(requestedProduct("白银现在什么价").name, "白银");
});

test("retrieves only relevant historical knowledge", () => {
    assert.match(retrieveKnowledge("你们实体店在哪里"), /微信.*定位/);
    assert.match(retrieveKnowledge("可以上门回收吗"), /上门范围/);
    assert.equal(retrieveKnowledge("今天天气不错"), "");
});

test("blocks invented jewelry loss deductions", () => {
    const reply = enforceBusinessRules("首饰回收价会低一点，因为要扣损耗费。");
    assert.doesNotMatch(reply, /损耗|低一点/);
    assert.match(reply, /纯度和克重/);
});

test("blocks prices invented without trusted live context", () => {
    const reply = enforceBusinessRules("今天可以按950元/克回收。", "");
    assert.doesNotMatch(reply, /950/);
    assert.match(reply, /不乱报数字/);
});
