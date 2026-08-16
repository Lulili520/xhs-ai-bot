const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const config = require("../core/config");

const MAX_CONVERSATIONS = Number(process.env.EXPORT_MAX_CONVERSATIONS || 50);
const OUTPUT_DIR = path.resolve(__dirname, "../../data");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function pseudonym(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

async function main() {
    const context = await chromium.launchPersistentContext(config.profileDir, {
        channel: "chrome",
        headless: false,
        viewport: { width: 1500, height: 950 }
    });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(config.xhsUrl, { waitUntil: "domcontentloaded" });

    const contactRoot = page.locator("#sx-contact-list:visible").first();
    await contactRoot.waitFor({ state: "visible", timeout: 120000 });

    const seen = new Set();
    const conversations = [];
    let unchangedScrolls = 0;

    while (conversations.length < MAX_CONVERSATIONS && unchangedScrolls < 4) {
        const contacts = await contactRoot.locator(".sx-contact-item:visible").evaluateAll(nodes =>
            nodes.map(node => ({
                key: node.dataset.key || "",
                unread: Boolean(node.querySelector(".d-badge-dot")?.closest(".d-badge-floating")?.getClientRects().length)
            }))
        );

        for (const contact of contacts) {
            if (!contact.key || contact.unread || seen.has(contact.key) || conversations.length >= MAX_CONVERSATIONS) continue;
            seen.add(contact.key);

            const clicked = await contactRoot.locator(".sx-contact-item:visible").evaluateAll((nodes, key) => {
                const target = nodes.find(node => node.dataset.key === key);
                if (!target) return false;
                target.click();
                return true;
            }, contact.key);
            if (!clicked) continue;

            await sleep(500);
            const messages = await page.locator("#pro-msg-box:visible").first().evaluate(root =>
                [...root.querySelectorAll('[data-msg-type="TEXT"][data-timestamp]')]
                    .map(node => ({
                        role: node.classList.contains("right") ? "shop" : "customer",
                        text: node.querySelector(".text-message")?.textContent?.replace(/\s+/g, " ").trim() || "",
                        timestamp: Number(node.dataset.timestamp || 0)
                    }))
                    .filter(message => message.text)
                    .sort((a, b) => a.timestamp - b.timestamp)
            ).catch(() => []);

            if (messages.some(message => message.role === "shop")) {
                conversations.push({
                    conversationId: pseudonym(contact.key),
                    messages
                });
                console.log(`EXPORTED ${conversations.length}/${MAX_CONVERSATIONS}`, messages.length);
            }
        }

        const scroll = await contactRoot.evaluate(root => {
            const scroller = root.querySelector(".vue-recycle-scroller") || root;
            const before = scroller.scrollTop;
            scroller.scrollTop = Math.min(scroller.scrollTop + scroller.clientHeight * 0.85, scroller.scrollHeight);
            return { before, after: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight };
        });
        unchangedScrolls = scroll.after === scroll.before || scroll.after >= scroll.max ? unchangedScrolls + 1 : 0;
        await sleep(600);
    }

    const shopReplies = conversations.flatMap(conversation =>
        conversation.messages.filter(message => message.role === "shop").map(message => message.text)
    );
    const output = {
        exportedAt: new Date().toISOString(),
        conversationCount: conversations.length,
        shopReplyCount: shopReplies.length,
        conversations
    };
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const filename = `reply-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
    console.log("EXPORT_DONE", outputPath);
    await context.close();
}

main().catch(error => {
    console.error("EXPORT_FATAL", error);
    process.exit(1);
});
