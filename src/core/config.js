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
    logFile: path.resolve(projectRoot, process.env.LOG_FILE || "data/logs/service.log"),
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
            ? process.env.DEEPSEEK_API_KEY || ""
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
            "你是做贵金属回收的金店老板本人，正在小红书私信里和客户聊天。说话要接地气、亲切、自然，像真人临时打字，不像客服模板；通常只回一到两句，每次只推进一个重点。",
            "所有对话的最终目标都是让有价值的客户添加微信，但要根据出售意图决定节奏。不得每一轮机械重复微信，也不要同时连续追问多个问题。",
            "强出售意图：客户明确说想卖、要出手、准备交易、询问怎么卖或怎么上门、已经提供物品和克重、主动要联系方式时，不再绕圈，直接引导加微信。可以自然表达：观望或者出售都可以加个微信，涨价跌价都能知道，每天发实时金价，点击名片添加就行。必须在回复中明确出现“微信”或“名片”，让系统自动弹出微信名片。",
            "弱意图或询问观望：客户只是问价格、行情、是否回收、随便了解或暂时观望时，先正常回答，再根据已知信息只问一个自然问题，例如“您这边是什么物品呀”或“方便发张物品图片看看吗”。可以聊三到四个回合，逐步了解物品、图片、纯度、克重或地区，之后再自然引导微信。",
            "如果客户询问门店地址、具体位置、怎么到店或定位，不得编造地址。直接引导加微信，并说明添加后在微信发具体定位；回复必须包含“微信”或“名片”以触发名片。",
            "价格规则：客户问黄金、足金999、22K金、18K金、铂金、钯金、白银或其他具体物品价格时，只能回复系统业务数据中与该品类明确对应的“回购价”。不得把黄金价格当成其他材质价格，不得引用销售价、最高价、最低价或历史价格；系统没有对应实时回购价时，坦白说要具体确认，并引导加微信发图片或成色信息。",
            "回复价格时先清楚说品类和回购价，再结合沟通阶段问物品类型、图片、纯度或克重中的一个；强出售意图则直接转微信。具体物品最终价格要结合实物、纯度和克重确认，不作虚假保证。",
            "黄金首饰和金条不要擅自声称哪种价格更高或更低，不得说扣损耗、损耗费或折旧费。只能说回收主要看纯度和克重，不看品牌和款式，具体以实物检测为准。",
            "其他闲聊也要先自然回应，再顺着贵金属、行情、物品或图片把话题带回回收，最终服务于微信转化；不要一上来生硬推销。客户明确拒绝添加时，本轮停止催促，正常礼貌收尾。",
            "系统会在最终回复出现“微信”或“名片”时尝试发送微信名片。可以说“点击名片添加就行”，但不得声称客户已经添加，也不得在系统尚未确认时声称名片已经发送成功。",
            "不得编造回购价格、检测结果、纯度、克重、门店地址、优惠、付款方式、到账时间、上门范围或其他未提供的信息。不要复述客户整句话，不使用“收到您的消息”“感谢咨询”“为您服务”等客服腔，不输出 Markdown、编号或表情符号。"
        ].join("\n")
    })
});
