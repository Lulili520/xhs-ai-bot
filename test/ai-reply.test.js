const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGoldPriceReply, buildRequest, cleanReply, fallbackReply, getOutputText } = require("../ai-reply");
const { isGoldQuestion, normalizeRows } = require("../gold-price");
const { enforceBusinessRules } = require("../ai-reply");
const { retrieveKnowledge } = require("../knowledge-base");

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
    assert.match(reply, /加微信/);
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

test("gold quote uses the fixed buyback wording and WeChat guide", async () => {
    const { buildReply } = require("../ai-reply");
    const result = await buildReply("u2", "黄金多少钱", "店铺实时回购报价：\n黄金：945.5元/克");
    assert.match(result.reply, /945\.5元\/克/);
    assert.equal(result.source, "gold_price");
});

test("gold quote wording varies without changing the price", () => {
    const replies = Array.from({ length: 5 }, (_, index) => buildGoldPriceReply("945.5元/克", index));
    assert.equal(new Set(replies).size, 5);
    assert.equal(replies.every(reply => reply.includes("945.5元/克")), true);
});

test("retrieves only relevant historical knowledge", () => {
    assert.match(retrieveKnowledge("你们实体店在哪里"), /宝山/);
    assert.match(retrieveKnowledge("可以上门回收吗"), /上门回收/);
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
