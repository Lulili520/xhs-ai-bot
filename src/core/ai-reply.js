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

function fallbackReply(text, businessContext = "") {
    if (businessContext.includes("无法可靠获取")) {
        return "抱歉，实时回收金价目前暂时无法获取，为避免报错价格，请稍后再问或联系人工客服确认。";
    }
    if (businessContext && !businessContext.includes("无法可靠获取")) {
        const prices = businessContext.split("\n").filter(line => /元\/克/.test(line));
        if (prices.length) {
            return `当前回收参考价：${prices.join("；")}。价格随行情变化，最终以验金时的实时价格、纯度和克重为准。`;
        }
    }
    const preview = String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return preview
        ? `收到，您是想了解“${preview}”对吗？可以加微信详细沟通，我给您发名片。`
        : "收到，请问您想咨询黄金回收的哪方面？可以加微信详细沟通。";
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

function buildGoldPriceReply(price, variantIndex = Math.floor(Math.random() * 5)) {
    const templates = [
        `当前黄金回购价是${price}。您这边大概有多少克呀？方便的话可以加个微信细聊。`,
        `今天黄金回购是${price}。您的是首饰还是金条？我给您发个微信名片。`,
        `黄金现在回购${price}。方便的话加个微信，可以把实物情况发我看看。`,
        `目前黄金回购价是${price}。您可以加微信详聊，我给您发个名片。`,
        `现在黄金回购是${price}。您知道大概的纯度和克重吗？咱们可以加微信聊。`
    ];
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
        return {
            reply: buildGoldPriceReply(price),
            source: "gold_price"
        };
    }

    if (!config.apiKey) {
        return { reply: fallbackReply(text, businessContext), source: "fallback_no_api_key" };
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

module.exports = { buildGoldPriceReply, buildReply, buildRequest, cleanReply, enforceBusinessRules, fallbackReply, getOutputText };
