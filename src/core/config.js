const path = require("path");
const projectRoot = path.resolve(__dirname, "../..");

const aiProvider = String(process.env.AI_PROVIDER || "openai").toLowerCase();
if (!new Set(["openai", "deepseek"]).has(aiProvider)) {
    throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}`);
}

const wechatCardType = String(process.env.WECHAT_CARD_TYPE || "enterprise").toLowerCase();
if (!new Set(["enterprise", "personal"]).has(wechatCardType)) {
    throw new Error(`Unsupported WECHAT_CARD_TYPE: ${wechatCardType}`);
}

function numberFromEnv(name, fallback, { min = 0 } = {}) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= min ? value : fallback;
}

module.exports = Object.freeze({
    account: Object.freeze({
        id: process.env.ACCOUNT_ID || "main",
        name: process.env.ACCOUNT_NAME || "主账号",
        region: process.env.ACCOUNT_REGION || "地区待补充"
    }),
    xhsUrl: process.env.XHS_URL || "https://pro.xiaohongshu.com/im/multiCustomerService",
    profileDir: path.resolve(projectRoot, process.env.XHS_PROFILE_DIR || "xhs-profile"),
    headless: process.env.HEADLESS === "true",
    scanIntervalMs: numberFromEnv("SCAN_INTERVAL_MS", 500, { min: 100 }),
    chatSettleMs: numberFromEnv("CHAT_SETTLE_MS", 300),
    replyDelayMs: numberFromEnv("REPLY_DELAY_MS", 1000),
    freshBeforeStartMs: numberFromEnv("FRESH_BEFORE_START_MS", 5000),
    logFile: path.resolve(projectRoot, process.env.LOG_FILE || "data/service.log"),
    gold: Object.freeze({
        enabled: process.env.GOLD_PRICE_ENABLED !== "false",
        url: process.env.GOLD_PRICE_URL || "https://h5.baobte.com/679/quote",
        productName: process.env.GOLD_PRODUCT_NAME || "黄金",
        pollIntervalMs: numberFromEnv("GOLD_POLL_INTERVAL_MS", 3000, { min: 1000 }),
        staleAfterMs: numberFromEnv("GOLD_STALE_AFTER_MS", 30000, { min: 5000 })
    }),
    wechatCard: Object.freeze({
        enabled: process.env.WECHAT_CARD_ENABLED !== "false",
        type: wechatCardType,
        name: process.env.WECHAT_CARD_NAME || "",
        sendWhenReplyMentionsWechat: process.env.WECHAT_CARD_ON_WECHAT_MENTION !== "false"
    }),
    ai: Object.freeze({
        provider: aiProvider,
        apiKey: aiProvider === "deepseek"
            ? process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || ""
            : process.env.OPENAI_API_KEY || "",
        baseUrl: (
            aiProvider === "deepseek"
                ? process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
                : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        ).replace(/\/$/, ""),
        model: aiProvider === "deepseek"
            ? process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
            : process.env.OPENAI_MODEL || "gpt-4o-mini",
        timeoutMs: numberFromEnv("AI_TIMEOUT_MS", 15000, { min: 1000 }),
        maxRetries: numberFromEnv("AI_MAX_RETRIES", 2),
        maxHistory: numberFromEnv("AI_MAX_HISTORY", 8, { min: 1 }),
        maxReplyChars: numberFromEnv("AI_MAX_REPLY_CHARS", 300, { min: 20 }),
        systemPrompt: process.env.AI_SYSTEM_PROMPT || [
            "你是黄金回收金店老板本人，正在小红书私信里和客户聊天。回复要像真人打字：自然、接地气、有温度，尽量一到两句话，不使用正式客服腔。",
            "先直接回应客户刚说的内容，再根据上下文追问一个有用的问题。不要复述或引用客户整句话，不要使用“收到您的消息”“感谢咨询”“为您服务”等模板话术。",
            "可以根据语境少量使用“呀、呢、可以的、没关系”等口语，但不要每句都用，也不要夸张热情。不同轮次要变换表达方式。",
            "你的业务目标是自然了解客户的黄金品类、纯度、克重、所在地区或到店意向，并在合适时引导添加微信进一步沟通。先解决客户问题再引导，不要生硬推销。",
            "系统会在你的回复提到微信时自动发送微信名片。可以说“方便的话加个微信”“我给您发个名片”或结合语境自然表达；如果最近一轮已经引导过加微信，本轮不要重复，继续正常聊天。不得声称客户已经添加。",
            "不得编造回购价格、检测结果、纯度、克重、门店地址、优惠、到账时间或其他未提供的信息。涉及具体报价时以系统实时价格为准。",
            "黄金首饰和金条的回收不要擅自声称哪一种价格更低或更高，不得说要扣损耗、损耗费、折旧费。只能说回收主要看纯度和克重，不看品牌和款式，具体以实物检测为准。",
            "遇到无关闲聊可以简短自然回应，再柔和地转回黄金回收话题。信息不足时只问一个最关键的问题。不要输出 Markdown、编号或表情符号。"
        ].join("\n")
    })
});
