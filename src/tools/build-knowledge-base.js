const fs = require("fs");
const path = require("path");

const EXPORTS_DIR = path.resolve(__dirname, "../../data/exports");
const KNOWLEDGE_DIR = path.resolve(__dirname, "../../data/knowledge");
const sourceFile = process.env.HISTORY_SOURCE || fs.readdirSync(EXPORTS_DIR)
    .filter(name => /^reply-history-.*\.json$/.test(name))
    .sort()
    .at(-1);

if (!sourceFile) throw new Error("No reply-history JSON found in data/exports/");

const sourcePath = path.isAbsolute(sourceFile) ? sourceFile : path.join(EXPORTS_DIR, sourceFile);
const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

function cleanText(value) {
    return String(value || "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isDirty(message) {
    const text = message.text;
    if (!text || text.length > 120) return true;
    if (/测试回复|⚓|↓\s*↓|立即添加客服|客服VX/i.test(text)) return true;
    if (message.role === "customer" && /傻逼|操你|妈的/.test(text)) return true;
    if (message.role === "shop" && /^(亲|知道|你好|您好|好的|是的|不是我们)$/.test(text)) return true;
    return false;
}

function removeStalePrice(text) {
    return text.replace(/(?:今天|今日|当前)?(?:黄金|金价)?(?:回收价?)?\s*\d+(?:\.\d+)?\s*(?:元)?(?:一克|元\/克)/g, "{{实时黄金回购价}}");
}

const conversations = raw.conversations.map(conversation => {
    const messages = [];
    for (const sourceMessage of conversation.messages) {
        const message = { ...sourceMessage, text: cleanText(sourceMessage.text) };
        if (isDirty(message)) continue;
        if (message.role === "shop") message.text = removeStalePrice(message.text);
        const previous = messages.at(-1);
        if (previous && previous.role === message.role && previous.text === message.text) continue;
        messages.push(message);
    }
    return { conversationId: conversation.conversationId, messages };
}).filter(conversation => conversation.messages.some(message => message.role === "shop"));

const knowledge = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(sourcePath),
    rules: [
        "具体黄金回购价只能使用系统实时价格，历史数字全部无效。",
        "先回答客户问题，再自然引导微信；客户拒绝后不要继续催促。",
        "不确定的信息要追问或说明需确认，不得编造。"
    ],
    entries: [
        { id: "wechat_add", keywords: ["微信", "添加", "联系方式", "名片"], answer: "点击我发的微信名片添加就可以了。", evidence: "历史高频话术" },
        { id: "wechat_watch", keywords: ["观望", "涨价", "跌价", "行情", "以后价格"], answer: "观望或者出售都可以加个微信，涨价跌价都能知道，每天发实时金价，点击名片添加就行。", evidence: "业务转化规则" },
        { id: "item_type", keywords: ["首饰", "手镯", "镯子", "戒指", "项链", "金条", "金豆", "黄金物品"], answer: "可以的，您这个大概多少克、什么纯度呢？方便的话加微信发张实物图我看看。", evidence: "历史追问方式" },
        { id: "location", keywords: ["地址", "位置", "实体店", "在哪", "到店"], answer: "您加个微信，点击名片添加就行，具体定位我后续在微信发您。", evidence: "门店隐私规则" },
        { id: "home_service", keywords: ["上门", "距离", "太远", "闵行", "外地"], answer: "上门范围要结合地区和物品情况确认，您加个微信，把位置和物品图片发我看看。", evidence: "业务安全规则" },
        { id: "cash", keywords: ["现金", "打款", "转账", "付款", "到账"], answer: "可以现场验货后打款，具体结算方式咱们可以微信里确认。", evidence: "历史结算回答" },
        { id: "process", keywords: ["流程", "怎么回收", "怎么交易", "检测", "验货"], answer: "流程是预约、见面、验货、打款，确认无误后完成交易。您是什么黄金物品呢？", evidence: "历史交易流程" },
        { id: "price_low", keywords: ["便宜", "太低", "价格低", "能高", "加价", "报价高"], answer: "我们是按照实时大盘报价的，觉得价格暂时不合适也可以再观望一下。加个微信的话，涨跌都能及时了解。", evidence: "历史议价回答" },
        { id: "same_price", keywords: ["品牌", "款式", "首饰和金条", "价格一样", "一口价"], answer: "回收主要看纯度和克重，不看品牌和款式，具体以现场验货为准。", evidence: "历史品类回答" },
        { id: "sell_gold", keywords: ["卖黄金", "出售黄金", "你们出", "购买黄金", "买金"], answer: "我们这边只做黄金回收，不出售黄金。", evidence: "历史经营范围回答" },
        { id: "small_weight", keywords: ["一克", "1克", "少量", "很少"], answer: "少量也可以回收，您是什么黄金物品呢？", evidence: "历史小克重回答" },
        { id: "decline", keywords: ["不用了", "算了", "谢谢", "不卖了"], answer: "好的，没关系，后面想了解行情再联系我就行。", evidence: "清洗后礼貌收尾" }
    ]
};

const cleaned = {
    generatedAt: knowledge.generatedAt,
    sourceFile: knowledge.sourceFile,
    rawConversationCount: raw.conversationCount,
    cleanedConversationCount: conversations.length,
    conversations
};

fs.mkdirSync(EXPORTS_DIR, { recursive: true });
fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
fs.writeFileSync(path.join(EXPORTS_DIR, "cleaned-history.json"), JSON.stringify(cleaned, null, 2));
fs.writeFileSync(path.join(KNOWLEDGE_DIR, "knowledge-base.json"), JSON.stringify(knowledge, null, 2));
console.log("KNOWLEDGE_BASE_DONE", {
    source: knowledge.sourceFile,
    conversations: conversations.length,
    entries: knowledge.entries.length
});
