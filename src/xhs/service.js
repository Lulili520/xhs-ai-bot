const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const util = require("util");
const crypto = require("crypto");
const config = require("../core/config");
const { buildReply } = require("../core/ai-reply");
const { GoldPriceService } = require("../core/gold-price");

// ============================================================
// 配置
// ============================================================

const XHS_URL = config.xhsUrl;
const PROFILE_DIR = config.profileDir;
const SCAN_INTERVAL = config.scanIntervalMs;
const CHAT_SETTLE_MS = config.chatSettleMs;
const REPLY_DELAY_MS = config.replyDelayMs;
const FRESH_BEFORE_START_MS = config.freshBeforeStartMs;


// ============================================================
// 状态
// ============================================================

let page;
let browserContext;
const goldPriceService = new GoldPriceService();

const startedAt = Date.now();

const contactState = new Map();

const processedMessages = new Set();
const processedStateFile = process.env.PROCESSED_STATE_FILE || `${config.logFile}.processed.json`;

// 同一次运行中，每位客户最多自动发送一次微信名片。
const cardSentUsers = new Set();

const queue = [];
const queuedUsers = new Set();

let processingUser = "";
let queueRunning = false;
let serviceRunning = true;
let shuttingDown = false;
let consecutiveScanErrors = 0;

try {
    const saved = JSON.parse(fs.readFileSync(processedStateFile, "utf8"));
    for (const key of saved.slice(-5000)) processedMessages.add(String(key));
} catch (error) {
    if (error.code !== "ENOENT") console.error("PROCESSED_STATE_LOAD_ERROR", error.message);
}

function rememberBounded(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
}

function rememberProcessed(key) {
    const digest = crypto.createHash("sha256").update(String(key)).digest("hex");
    processedMessages.delete(digest);
    processedMessages.add(digest);
    while (processedMessages.size > 5000) processedMessages.delete(processedMessages.values().next().value);
    try {
        fs.mkdirSync(path.dirname(processedStateFile), { recursive: true });
        const tempPath = `${processedStateFile}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify([...processedMessages]), "utf8");
        fs.renameSync(tempPath, processedStateFile);
    } catch (error) {
        console.error("PROCESSED_STATE_WRITE_ERROR", error.message);
    }
}

function wasProcessed(key) {
    const digest = crypto.createHash("sha256").update(String(key)).digest("hex");
    return processedMessages.has(digest);
}

function rememberContactState(key, value) {
    rememberBounded(contactState, key, value, 5000);
}


// ============================================================
// 工具
// ============================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));


function log(type, data = "") {

    const timestamp = new Date();
    const line = [
        `[${timestamp.toLocaleString("zh-CN", { hour12: false })}]`,
        type,
        typeof data === "string" ? data : util.inspect(data, { depth: 5, breakLength: Infinity })
    ].filter(Boolean).join(" ");

    console.log(
        `[${timestamp.toLocaleTimeString()}]`,
        type,
        data
    );

    try {
        fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
        fs.appendFileSync(config.logFile, `${line}\n`, "utf8");
    } catch (error) {
        console.error("LOG_WRITE_FAILED", error.message);
    }
}


function normalizeUserId(key) {

    return String(key || "")
        .replace(/^Active-/, "")
        .replace(/^Total-/, "");
}


function messageKey(userId, message) {

    return (
        `${userId}::`
        +
        (
            message?.id
            ||
            `${message?.timestamp}::${message?.text}`
        )
    );
}


function normalizeText(text) {

    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}


function shouldSendWechatCard(reply) {

    return (
        config.wechatCard.enabled
        &&
        config.wechatCard.sendWhenReplyMentionsWechat
        &&
        /微信|名片/.test(String(reply || ""))
    );
}


// ============================================================
// 可见 DOM Root
// ============================================================

function contactRoot() {

    return page
        .locator("#sx-contact-list:visible")
        .first();
}


function chatRoot() {

    return page
        .locator("#pro-msg-box:visible")
        .first();
}


// ============================================================
// 浏览器
// ============================================================

async function startBrowser() {

    browserContext =
        await chromium.launchPersistentContext(
            PROFILE_DIR,
            {
                channel: "chrome",
                headless: config.headless,

                viewport: {
                    width: 1500,
                    height: 950
                }
            }
        );


    page =
        browserContext.pages()[0]
        ||
        await browserContext.newPage();


    page.setDefaultTimeout(8000);


    await page.goto(
        XHS_URL,
        {
            waitUntil: "domcontentloaded"
        }
    );


    await contactRoot().waitFor({
        state: "visible",
        timeout: 120000
    });


    log("LOGIN_OK");

    try {
        await goldPriceService.start(browserContext);
        log("GOLD_MONITOR_STARTED", config.gold.url);
    } catch (error) {
        log("GOLD_MONITOR_FAILED", error.message);
    }
}


// ============================================================
// 当前用户
// ============================================================

async function getActiveUserId() {

    const root =
        contactRoot();


    if (
        await root.count()
        ===
        0
    ) {
        return "";
    }


    const active =
        root.locator(
            ".sx-contact-item.active:visible"
        );


    if (
        await active.count()
        ===
        0
    ) {
        return "";
    }


    const key =
        await active
            .first()
            .getAttribute(
                "data-key"
            );


    return normalizeUserId(key);
}


// ============================================================
// 联系人列表
// ============================================================

async function getContacts() {

    const root =
        contactRoot();


    if (
        await root.count()
        ===
        0
    ) {
        return [];
    }


    return await root
        .locator(
            ".sx-contact-item:visible"
        )
        .evaluateAll(
            nodes => {

                return nodes.map(el => {

                    const userId =
                        String(
                            el.dataset.key || ""
                        )
                            .replace(
                                /^Active-/,
                                ""
                            )
                            .replace(
                                /^Total-/,
                                ""
                            );


                    const preview =
                        el.querySelector(
                            ".item-main-center .content"
                        )
                            ?.textContent
                            ?.trim()
                        || "";


                    const time =
                        el.querySelector(
                            ".time"
                        )
                            ?.textContent
                            ?.trim()
                        || "";


                    const dot =
                        el.querySelector(
                            ".d-badge-dot"
                        );


                    const badge =
                        dot?.closest(
                            ".d-badge-floating"
                        );


                    let unread = false;


                    if (
                        dot &&
                        badge
                    ) {

                        const style =
                            getComputedStyle(
                                badge
                            );


                        unread =
                            badge.getClientRects().length
                                >
                                0
                            &&
                            style.display
                                !==
                                "none"
                            &&
                            style.visibility
                                !==
                                "hidden";
                    }


                    return {

                        userId,

                        preview,

                        time,

                        unread,

                        signature:
                            `${time}::${preview}`
                    };
                });
            }
        );
}


// ============================================================
// 打开用户
// ============================================================

async function openUser(userId) {

    if (
        await getActiveUserId()
        ===
        userId
    ) {
        return true;
    }


    const root =
        contactRoot();


    let item =
        root.locator(
            `.sx-contact-item[data-key$="${userId}"]:visible`
        );


    /*
     * 虚拟列表当前没渲染目标：
     * 先尝试滚到顶部。
     */
    if (
        await item.count()
        ===
        0
    ) {

        await root.evaluate(el => {

            const scroller =
                el.querySelector(
                    ".vue-recycle-scroller"
                )
                ||
                el;

            scroller.scrollTop = 0;
        });


        await sleep(300);


        item =
            root.locator(
                `.sx-contact-item[data-key$="${userId}"]:visible`
            );
    }


    if (
        await item.count()
        ===
        0
    ) {

        log(
            "CONTACT_NOT_RENDERED",
            userId
        );

        return false;
    }


    const target =
        item.first();


    try {

        // 虚拟联系人列表有时会错误报告“元素在视口外”，
        // 已按 userId 精确定位后使用页面原生点击事件更可靠。
        await target.evaluate(element => element.click());

    } catch (e) {

        log(
            "CONTACT_CLICK_FAILED",
            {
                userId,
                error: e.message
            }
        );

        return false;
    }


    /*
     * 等 active 用户真正切换。
     */
    const deadline =
        Date.now() + 5000;


    while (
        Date.now()
        <
        deadline
    ) {

        if (
            await getActiveUserId()
            ===
            userId
        ) {

            await sleep(
                CHAT_SETTLE_MS
            );


            /*
             * 聊天加载之后再确认一次。
             */
            if (
                await getActiveUserId()
                ===
                userId
            ) {

                log(
                    "SWITCH_OK",
                    userId
                );

                return true;
            }
        }


        await sleep(100);
    }


    log(
        "SWITCH_FAILED",
        userId
    );


    return false;
}


// ============================================================
// 聊天状态
// ============================================================

async function getChatState() {

    const root =
        chatRoot();


    if (
        await root.count()
        ===
        0
    ) {

        return {
            latestIncoming: null,
            latestOutgoing: null,
            latestOutgoingTime: 0
        };
    }


    return await root.evaluate(root => {

        function getText(node) {

            return (
                node
                    .querySelector(
                        ".text-message"
                    )
                    ?.textContent
                    ?.trim()
                ||
                ""
            );
        }


        function getTime(node) {

            return Number(
                node.dataset.timestamp
                ||
                0
            );
        }


        /*
         * 客户文字消息
         */
        const incoming =
            [
                ...root.querySelectorAll(
                    '.left[data-msg-type="TEXT"]'
                )
            ]
                .map(node => ({

                    id:
                        node.id || "",

                    timestamp:
                        getTime(node),

                    text:
                        getText(node)
                }))
                .filter(
                    x =>
                        x.text
                )
                .sort(
                    (a, b) =>
                        b.timestamp
                        -
                        a.timestamp
                );


        /*
         * 所有商家发送消息
         */
        const outgoingAny =
            [
                ...root.querySelectorAll(
                    ".right[data-timestamp]"
                )
            ];


        const latestOutgoingTime =
            outgoingAny.length
                ?
                Math.max(
                    ...outgoingAny.map(
                        getTime
                    )
                )
                :
                0;


        /*
         * 商家文字消息
         */
        const outgoingText =
            [
                ...root.querySelectorAll(
                    '.right[data-msg-type="TEXT"]'
                )
            ]
                .map(node => ({

                    id:
                        node.id || "",

                    timestamp:
                        getTime(node),

                    text:
                        getText(node)
                }))
                .filter(
                    x =>
                        x.text
                )
                .sort(
                    (a, b) =>
                        b.timestamp
                        -
                        a.timestamp
                );


        return {

            latestIncoming:
                incoming[0]
                ||
                null,

            latestOutgoing:
                outgoingText[0]
                ||
                null,

            latestOutgoingTime
        };
    });
}


// ============================================================
// 是否启动后的新消息
// ============================================================

function isFreshMessage(message) {

    if (
        !message?.timestamp
    ) {
        return false;
    }


    return (
        message.timestamp
        >=
        startedAt
        -
        FRESH_BEFORE_START_MS
    );
}


// ============================================================
// 发送
// ============================================================

async function sendReply(
    userId,
    originalMessage,
    reply
) {

    /*
     * 1. 用户必须正确
     */
    if (
        await getActiveUserId()
        !==
        userId
    ) {

        return {
            status: "wrong_user"
        };
    }


    /*
     * 2. 消息必须还是刚刚那条
     */
    let state =
        await getChatState();


    if (
        !state.latestIncoming
    ) {

        return {
            status: "no_message"
        };
    }


    const originalKey =
        messageKey(
            userId,
            originalMessage
        );


    const latestKey =
        messageKey(
            userId,
            state.latestIncoming
        );


    if (
        latestKey
        !==
        originalKey
    ) {

        return {
            status: "new_message"
        };
    }


    /*
     * 3. 商家/人工已经回复
     */
    if (
        state.latestOutgoingTime
        >=
        originalMessage.timestamp
    ) {

        return {
            status: "already_replied"
        };
    }


    const beforeOutgoingTime =
        state.latestOutgoingTime;


    /*
     * 4. 填写
     */
    const input =
        page.locator(
            "textarea.reply-textarea:visible"
        );


    if (
        await input.count()
        ===
        0
    ) {

        return {
            status: "input_missing"
        };
    }


    await input.fill(reply);


    /*
     * 5. 填写之后，再检查一次
     */
    if (
        await getActiveUserId()
        !==
        userId
    ) {

        await input.fill("");

        return {
            status: "wrong_user"
        };
    }


    state =
        await getChatState();


    if (
        !state.latestIncoming
        ||
        messageKey(
            userId,
            state.latestIncoming
        )
        !==
        originalKey
    ) {

        await input.fill("");

        return {
            status: "new_message"
        };
    }


    /*
     * 6. 发送
     */
    const button =
        page.locator(
            ".base-reply-box .reply-bottom-bar button:visible"
        );


    if (
        await button.count()
        ===
        0
    ) {

        return {
            status: "button_missing"
        };
    }


    try {

        await button.click({
            timeout: 5000
        });

    } catch (e) {

        return {
            status: "click_failed",
            error: e.message
        };
    }


    /*
     * 7. 必须确认右侧真的出现了新消息
     */
    const deadline =
        Date.now() + 5000;


    while (
        Date.now()
        <
        deadline
    ) {

        /*
         * 页面被切走则直接失败
         */
        if (
            await getActiveUserId()
            !==
            userId
        ) {

            return {
                status: "wrong_user"
            };
        }


        const current =
            await getChatState();


        const outgoing =
            current.latestOutgoing;


        if (
            outgoing
            &&
            outgoing.timestamp
                >
                Math.max(
                    beforeOutgoingTime,
                    originalMessage.timestamp
                )
            &&
            normalizeText(
                outgoing.text
            )
            ===
            normalizeText(
                reply
            )
        ) {

            return {
                status: "sent",
                outgoing
            };
        }


        await sleep(100);
    }


    return {
        status: "not_confirmed"
    };
}


async function sendWechatCard(userId) {

    if (cardSentUsers.has(userId)) {
        return { status: "already_sent" };
    }

    if (await getActiveUserId() !== userId) {
        return { status: "wrong_user" };
    }

    const root = chatRoot();
    const beforeCount = await root.locator(".right[data-timestamp]").count();
    const beforeState = await getChatState();
    const clickCardButton = () => page.evaluate(cardConfig => {
        const isDisplayed = element => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };

        const panels = [...document.querySelectorAll(".business-card")].filter(isDisplayed);
        for (const panel of panels) {
            const cards = [...panel.querySelectorAll(".card")].map(card => ({
                card,
                title: card.querySelector(".card-box__content-title")?.getAttribute("title") || "",
                description: card.querySelector(".card-box__content-desc")?.textContent?.trim() || ""
            }));
            const isEnterprise = item => item.title.includes("企微") || item.description.startsWith("@");
            const typedCards = cards.filter(item =>
                cardConfig.type === "enterprise"
                    ? isEnterprise(item)
                    : !isEnterprise(item) && (item.title.includes("微信") || item.description.startsWith("号码："))
            );
            const exact = cardConfig.name
                ? typedCards.find(item => item.title === cardConfig.name)
                : null;
            const selected = exact || (typedCards.length === 1 ? typedCards[0] : null);
            if (!selected) {
                return {
                    status: typedCards.length > 1 ? "card_name_ambiguous" : "panel_or_card_missing",
                    availableCards: cards.map(item => item.title).filter(Boolean)
                };
            }
            const button = [...selected.card.querySelectorAll("button")]
                .find(node => node.textContent?.includes("发送"));
            if (!button) return { status: "button_missing", cardName: selected.title };
            if (button.disabled) return { status: "button_disabled", cardName: selected.title };
            button.click();
            return { status: "clicked", cardName: selected.title };
        }
        return { status: "panel_or_card_missing", availableCards: [] };
    }, {
        type: config.wechatCard.type,
        name: config.wechatCard.name
    });

    let clickResult = await clickCardButton();

    if (clickResult.status === "panel_or_card_missing") {
        const tools = page.locator(
            ".reply-box:visible .reply-tools .tool-item:visible"
        );
        const namedTool = page.locator([
            '.reply-box:visible .reply-tools .tool-item:visible[title*="获客"]',
            '.reply-box:visible .reply-tools .tool-item:visible[aria-label*="获客"]',
            '.reply-box:visible .reply-tools .tool-item:visible[title*="名片"]',
            '.reply-box:visible .reply-tools .tool-item:visible[aria-label*="名片"]'
        ].join(",")).first();
        const toolCount = await tools.count();
        const targetTool = await namedTool.count() ? namedTool : toolCount >= 6 ? tools.nth(5) : null;
        if (!targetTool) return { status: "card_tool_missing" };

        try {
            // 优先按可访问名称定位“获客工具/名片”，旧页面才回退到第 6 项。
            await targetTool.click({ timeout: 5000 });
        } catch (error) {
            return { status: "card_tool_click_failed", error: error.message };
        }

        const panelDeadline = Date.now() + 5000;
        while (Date.now() < panelDeadline) {
            if (await getActiveUserId() !== userId) {
                return { status: "wrong_user" };
            }
            clickResult = await clickCardButton();
            if (clickResult.status !== "panel_or_card_missing") break;
            await sleep(100);
        }
    }

    if (clickResult.status !== "clicked") {
        return {
            status: clickResult.status === "panel_or_card_missing" ? "configured_card_missing" : clickResult.status,
            availableCards: clickResult.availableCards || []
        };
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await getActiveUserId() !== userId) {
            return { status: "wrong_user" };
        }

        const currentCount = await root.locator(".right[data-timestamp]").count();
        const currentState = await getChatState();
        if (
            currentCount > beforeCount
            ||
            currentState.latestOutgoingTime > beforeState.latestOutgoingTime
        ) {
            cardSentUsers.add(userId);
            return { status: "sent", cardName: clickResult.cardName };
        }

        await sleep(100);
    }

    return { status: "not_confirmed" };
}


// ============================================================
// 处理一个用户
// ============================================================

async function processUser(userId) {

    const opened =
        await openUser(userId);


    if (!opened) {

        return {
            requeue: false
        };
    }


    /*
     * 等客户可能连续输入。
     */
    await sleep(
        REPLY_DELAY_MS
    );


    if (
        await getActiveUserId()
        !==
        userId
    ) {

        return {
            requeue: false
        };
    }


    const state =
        await getChatState();


    const message =
        state.latestIncoming;


    if (!message) {

        return {
            requeue: false
        };
    }


    /*
     * 启动前历史消息不处理。
     */
    if (
        !isFreshMessage(
            message
        )
    ) {

        return {
            requeue: false
        };
    }


    const key =
        messageKey(
            userId,
            message
        );


    /*
     * 已处理
     */
    if (
        wasProcessed(
            key
        )
    ) {

        return {
            requeue: false
        };
    }


    /*
     * 商家已经回复。
     */
    if (
        state.latestOutgoingTime
        >=
        message.timestamp
    ) {

        rememberProcessed(
            key
        );


        return {
            requeue: false
        };
    }


    log(
        "RECEIVE",
        {
            userId,
            messageId:
                message.id,
            text:
                message.text
        }
    );


    const generated =
        await buildReply(
            userId,
            message.text,
            goldPriceService.getContext(message.text)
        );

    const reply = generated.reply;

    log("REPLY_READY", {
        userId,
        source: generated.source,
        error: generated.error || ""
    });


    const result =
        await sendReply(
            userId,
            message,
            reply
        );


    /*
     * 成功
     */
    if (
        result.status
        ===
        "sent"
    ) {

        rememberProcessed(
            key
        );


        log(
            "SEND_OK",
            {
                userId,
                reply
            }
        );

        if (shouldSendWechatCard(reply)) {
            const cardResult = await sendWechatCard(userId);
            log(
                cardResult.status === "sent" || cardResult.status === "already_sent"
                    ? "CARD_SEND_OK"
                    : "CARD_SEND_FAILED",
                {
                    userId,
                    status: cardResult.status,
                    cardName: cardResult.cardName || "",
                    availableCards: cardResult.availableCards || [],
                    error: cardResult.error || ""
                }
            );
        }


        return {
            requeue: false
        };
    }


    /*
     * 人工已经回复
     */
    if (
        result.status
        ===
        "already_replied"
    ) {

        rememberProcessed(
            key
        );


        return {
            requeue: false
        };
    }


    /*
     * 客户处理过程中又说话了。
     *
     * 旧消息以后不用再处理，
     * 重新处理最新消息。
     */
    if (
        result.status
        ===
        "new_message"
    ) {

        rememberProcessed(
            key
        );


        log(
            "NEW_MESSAGE_DURING_REPLY",
            userId
        );


        return {
            requeue: true
        };
    }


    log(
        "SEND_FAILED",
        {
            userId,
            status:
                result.status
        }
    );


    return {
        requeue: false
    };
}


// ============================================================
// Queue
// ============================================================

function enqueue(userId) {

    if (!userId) {
        return;
    }


    /*
     * 这里非常重要：
     *
     * 以前 queued/processing 时会 dirty.add，
     * 导致 scanActiveChat 每 500ms
     * 把同一消息重新排队。
     *
     * 现在重复触发直接忽略。
     */
    if (
        queuedUsers.has(
            userId
        )
        ||
        processingUser
            ===
            userId
    ) {

        return;
    }


    queuedUsers.add(
        userId
    );


    queue.push(
        userId
    );


    log(
        "QUEUE_ADD",
        {
            userId,
            size:
                queue.length
        }
    );


    runQueue()
        .catch(console.error);
}


async function runQueue() {

    if (
        queueRunning
    ) {

        return;
    }


    queueRunning = true;


    try {

        while (
            queue.length
        ) {

            const userId =
                queue.shift();


            processingUser =
                userId;


            let result = {
                requeue: false
            };


            try {

                result =
                    await processUser(
                        userId
                    );

            } catch (e) {

                console.error(
                    "PROCESS_ERROR",
                    userId,
                    e
                );
            }


            queuedUsers.delete(
                userId
            );


            processingUser = "";


            /*
             * 只有明确检测到新消息时
             * 才重新排队。
             */
            if (
                result?.requeue
            ) {

                enqueue(
                    userId
                );
            }


            await sleep(200);
        }

    } finally {

        queueRunning = false;


        if (
            queue.length
        ) {

            runQueue()
                .catch(
                    console.error
                );
        }
    }
}


// ============================================================
// 联系人扫描
// ============================================================

async function scanContacts() {

    const list =
        await getContacts();


    for (
        const contact
        of list
    ) {

        if (!contact.userId) {

            continue;
        }


        const old =
            contactState.get(
                contact.userId
            );


        /*
         * 第一次出现。
         */
        if (!old) {

            rememberContactState(
                contact.userId,
                {
                    signature:
                        contact.signature,

                    unread:
                        contact.unread
                }
            );


            /*
             * 新渲染出来的未读用户：
             * 可以尝试处理。
             *
             * 历史消息最终还有
             * timestamp freshness 保护。
             */
            if (
                contact.unread
            ) {

                enqueue(
                    contact.userId
                );
            }


            continue;
        }


        const signatureChanged =
            old.signature
            !==
            contact.signature;


        const unreadAppeared =
            contact.unread
            &&
            !old.unread;


        /*
         * 非当前用户触发规则：
         *
         * 1. unread 从 false -> true
         *
         * 或
         *
         * 2. 已经 unread，但 preview 又变化
         *
         * 自己发送回复：
         * preview 会变化，但是 unread=false，
         * 因此不会再次入队。
         */
        if (
            unreadAppeared
            ||
            (
                contact.unread
                &&
                signatureChanged
            )
        ) {

            enqueue(
                contact.userId
            );
        }


        rememberContactState(
            contact.userId,
            {
                signature:
                    contact.signature,

                unread:
                    contact.unread
            }
        );
    }
}


// ============================================================
// 当前聊天扫描
// ============================================================

async function scanActiveChat() {

    /*
     * Queue 正在控制页面时，
     * 不要让当前聊天扫描参与竞争。
     *
     * processUser 自己会检查是否来了新消息。
     */
    if (
        queueRunning
    ) {

        return;
    }


    const userId =
        await getActiveUserId();


    if (!userId) {

        return;
    }


    const state =
        await getChatState();


    const message =
        state.latestIncoming;


    if (
        !message
        ||
        !isFreshMessage(
            message
        )
    ) {

        return;
    }


    const key =
        messageKey(
            userId,
            message
        );


    if (
        wasProcessed(
            key
        )
    ) {

        return;
    }


    /*
     * 客户最后说话。
     */
    if (
        message.timestamp
        >
        state.latestOutgoingTime
    ) {

        enqueue(
            userId
        );
    }
}


// ============================================================
// 初始化联系人基线
// ============================================================

async function initBaseline() {

    const list =
        await getContacts();


    for (
        const contact
        of list
    ) {

        rememberContactState(
            contact.userId,
            {
                signature:
                    contact.signature,

                unread:
                    contact.unread
            }
        );
    }


    log(
        "BASELINE_READY",
        list.length
    );
}


// ============================================================
// Main
// ============================================================

async function main() {

    log("SERVICE_START", config.account);

    await startBrowser();

    await initBaseline();


    log(
        "SERVICE_READY"
    );


    while (serviceRunning) {

        try {

            /*
             * 非当前用户
             */
            await scanContacts();


            /*
             * 当前用户
             */
            await scanActiveChat();

            consecutiveScanErrors = 0;

        } catch (e) {

            consecutiveScanErrors += 1;

            console.error(
                "SCAN_ERROR",
                e.message
            );

            if (consecutiveScanErrors >= 5 && page) {
                log("PAGE_RECOVERY_START", e.message);
                await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
                await contactRoot().waitFor({ state: "visible", timeout: 120000 });
                contactState.clear();
                await initBaseline();
                consecutiveScanErrors = 0;
                log("PAGE_RECOVERY_DONE");
            }
        }


        await sleep(
            SCAN_INTERVAL
        );
    }
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    serviceRunning = false;
    log("SERVICE_STOP", signal);
    await goldPriceService.stop();
    if (browserContext) await browserContext.close().catch(() => {});
    process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));


main()
    .catch(err => {

        console.error(
            "FATAL",
            err
        );

        process.exit(1);
    });
