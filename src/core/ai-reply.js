const config = require("./config").ai;
const { retrieveKnowledge } = require("./knowledge-base");

const histories = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanReply(value) {
    return String(value || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, config.maxReplyChars);
}

function enforceBusinessRules(reply, businessContext = "") {
    const text = cleanReply(reply);
    if (/(扣|减|收).{0,4}损耗|损耗.{0,4}(费|价|钱)|首饰.{0,8}(低|便宜)|金条.{0,8}(高|贵)/.test(text)) {
        return "黄金回收主要看纯度和克重，不看品牌和款式，具体要看实物情况。方便的话加个微信，发张实物图我帮您看看。";
    }
    const containsUntrustedPrice = /(?:\d+(?:\.\d+)?\s*(?:元|块)(?:\s*\/\s*克)?|¥\s*\d+)/.test(text)
        && !/元\/克/.test(businessContext);
    if (containsUntrustedPrice) {
        return "具体回购价要按实时行情确认，我不乱报数字。您告诉我是什么黄金、大概多少克，我再帮您看看。";
    }
    return text;
}

function isStrongSellIntent(text) {
    return /(想卖|要卖|卖掉|出售|出手|准备卖|现在卖|今天卖|怎么卖|怎么交易|上门回收|有\s*\d+(?:\.\d+)?\s*克|大概\s*\d+(?:\.\d+)?\s*克|加微信|联系方式)/i.test(String(text || ""));
}

function fallbackReply(text, businessContext = "", { guideWechat = isStrongSellIntent(text) } = {}) {
    if (businessContext.includes("没有获取到")) {
        return "这个品类要结合具体物品和成色确认，我不拿别的价格替代。您加个微信，点击名片把图片发我看看。";
    }
    if (businessContext.includes("无法可靠获取")) {
        return "实时回购价这会儿没刷新出来，我不乱报数字。您可以加个微信，点击名片添加就行，价格更新后我跟您说。";
    }
    if (businessContext && !businessContext.includes("无法可靠获取")) {
        const prices = businessContext.split("\n").filter(line => /元\/克/.test(line));
        if (prices.length) {
            return `当前回购价是${prices.join("；")}。具体还要看实物纯度和克重，方便的话加个微信，点击名片发图片我看看。`;
        }
    }
    if (guideWechat) {
        return "观望或者出售都可以加个微信，涨价跌价都能知道，每天发实时金价，点击名片添加就行。";
    }
    return /图|照片|图片/.test(String(text || ""))
        ? "可以的，您方便发张物品图片看看吗？"
        : "您这边具体是什么物品呀？";
}

function getOutputText(data) {
    if (typeof data?.choices?.[0]?.message?.content === "string") {
        return data.choices[0].message.content;
    }
    if (typeof data?.output_text === "string") return data.output_text;
    for (const item of data?.output || []) {
        for (const content of item?.content || []) {
            if (content?.type === "output_text" && content.text) return content.text;
        }
    }
    return "";
}

function buildInstructions(businessContext, userText = "") {
    const knowledgeContext = retrieveKnowledge(userText);
    return [
        config.systemPrompt,
        businessContext ? `以下是系统刚获取的业务数据，只能依据这些数据回答，不得修改数字或补充未提供的报价：\n${businessContext}` : "",
        knowledgeContext
    ].filter(Boolean).join("\n\n");
}

function buildGoldPriceReply(price, variantIndex = Math.floor(Math.random() * 5), productName = "黄金", guideWechat = false) {
    const inquiryTemplates = [
        `现在${productName}回购是${price}，您这边具体是什么物品呀？`,
        `今天${productName}回购价是${price}，您这个大概有多少克呀？`,
        `${productName}目前回购是${price}，方便发张物品图片看看吗？`,
        `现在${productName}回购价${price}，您知道大概纯度吗？`,
        `${productName}今天回购是${price}，您的是首饰还是其他物品呀？`
    ];
    const wechatTemplates = [
        `${productName}现在回购是${price}。观望或者出售都可以加个微信，涨跌都能知道，点击名片添加就行。`,
        `今天${productName}回购价是${price}，您要出手的话直接加微信，点击名片把物品图片发我看看。`,
        `${productName}目前回购是${price}。可以加个微信，每天的实时金价都能看到，点击名片添加就行。`,
        `现在${productName}回购价${price}，具体看实物纯度和克重，您加微信把图片发我就行。`,
        `${productName}今天回购是${price}，方便的话直接加微信，点击名片添加就行。`
    ];
    const templates = guideWechat ? wechatTemplates : inquiryTemplates;
    return templates[Math.abs(variantIndex) % templates.length];
}

function buildRequest(userId, text, businessContext, aiConfig = config) {
    const history = histories.get(userId) || [];
    const instructions = buildInstructions(businessContext, text);

    if (aiConfig.provider === "deepseek") {
        return {
            url: `${aiConfig.baseUrl}/chat/completions`,
            body: {
                model: aiConfig.model,
                messages: [
                    { role: "system", content: instructions },
                    ...history,
                    { role: "user", content: text }
                ],
                thinking: { type: "disabled" },
                max_tokens: 300,
                stream: false
            }
        };
    }

    return {
        url: `${aiConfig.baseUrl}/responses`,
        body: {
            model: aiConfig.model,
            instructions,
            input: [...history, { role: "user", content: text }],
            max_output_tokens: 300
        }
    };
}

function remember(userId, role, content) {
    const history = histories.get(userId) || [];
    history.push({ role, content });
    histories.delete(userId);
    histories.set(userId, history.slice(-config.maxHistory));
    while (histories.size > 500) histories.delete(histories.keys().next().value);
}

async function requestReply(userId, text, businessContext) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const request = buildRequest(userId, text, businessContext);

    try {
        const response = await fetch(request.url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${config.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request.body),
            signal: controller.signal
        });

        if (!response.ok) {
            const detail = (await response.text()).slice(0, 300);
            const error = new Error(`AI HTTP ${response.status}: ${detail}`);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
        }

        const reply = enforceBusinessRules(getOutputText(await response.json()), businessContext);
        if (!reply) throw new Error("AI returned an empty reply");
        return reply;
    } finally {
        clearTimeout(timer);
    }
}

async function buildReply(userId, text, businessContext = "") {
    const goldPriceLine = businessContext.split("\n").find(line => /元\/克/.test(line));
    if (goldPriceLine) {
        const price = goldPriceLine.replace(/^.*?：/, "");
        const productName = goldPriceLine.split(/[：:]/)[0].trim() || "黄金";
        const history = histories.get(userId) || [];
        const customerTurns = history.filter(item => item.role === "user").length + 1;
        const guideWechat = isStrongSellIntent(text) || customerTurns >= 3;
        const reply = buildGoldPriceReply(price, Math.floor(Math.random() * 5), productName, guideWechat);
        remember(userId, "user", text);
        remember(userId, "assistant", reply);
        return {
            reply,
            source: "gold_price"
        };
    }

    if (!config.apiKey) {
        const history = histories.get(userId) || [];
        const guideWechat = isStrongSellIntent(text) || history.filter(item => item.role === "user").length >= 2;
        const reply = fallbackReply(text, businessContext, { guideWechat });
        remember(userId, "user", text);
        remember(userId, "assistant", reply);
        return { reply, source: "fallback_no_api_key" };
    }

    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        try {
            const reply = await requestReply(userId, text, businessContext);
            remember(userId, "user", text);
            remember(userId, "assistant", reply);
            return { reply, source: "ai" };
        } catch (error) {
            lastError = error;
            if (!error.retryable || attempt === config.maxRetries) break;
            await sleep(500 * (2 ** attempt));
        }
    }

    return {
        reply: fallbackReply(text, businessContext),
        source: "fallback_ai_error",
        error: lastError?.message || "unknown AI error"
    };
}

module.exports = { buildGoldPriceReply, buildReply, buildRequest, cleanReply, enforceBusinessRules, fallbackReply, getOutputText, isStrongSellIntent };
