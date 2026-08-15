const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const configPath = path.resolve(__dirname, process.env.ACCOUNTS_FILE || "accounts.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const accounts = (config.accounts || []).filter(account => account.enabled !== false);

if (!accounts.length) {
    throw new Error("accounts.json 中没有启用的账号");
}

const profileDirs = new Set();
for (const account of accounts) {
    if (!account.id || !account.profileDir) {
        throw new Error("每个账号都必须配置 id 和 profileDir");
    }
    const profileDir = path.resolve(__dirname, account.profileDir);
    if (profileDirs.has(profileDir)) {
        throw new Error(`多个账号不能共用浏览器目录：${account.profileDir}`);
    }
    profileDirs.add(profileDir);
}

const children = new Map();
let shuttingDown = false;

function startAccount(account) {
    const child = spawn(process.execPath, [path.resolve(__dirname, "test-chrome.js")], {
        cwd: __dirname,
        env: {
            ...process.env,
            ACCOUNT_ID: account.id,
            XHS_PROFILE_DIR: account.profileDir,
            LOG_FILE: account.logFile || `data/${account.id}.log`,
            WECHAT_CARD_TYPE: account.wechatCardType || process.env.WECHAT_CARD_TYPE || "enterprise",
            WECHAT_CARD_NAME: account.wechatCardName || process.env.WECHAT_CARD_NAME || ""
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    children.set(account.id, child);
    const forward = stream => data => process.stdout.write(`[${account.id}] ${data}`);
    child.stdout.on("data", forward("stdout"));
    child.stderr.on("data", forward("stderr"));
    child.on("exit", (code, signal) => {
        children.delete(account.id);
        console.log(`[${account.id}] EXIT code=${code ?? ""} signal=${signal ?? ""}`);
        if (!shuttingDown) {
            console.log(`[${account.id}] 5 秒后自动重启`);
            setTimeout(() => startAccount(account), 5000);
        }
    });
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在关闭全部账号...`);
    for (const child of children.values()) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(`准备启动 ${accounts.length} 个账号：${accounts.map(account => account.id).join(", ")}`);
for (const account of accounts) startAccount(account);
