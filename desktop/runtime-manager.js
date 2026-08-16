const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000;

class RuntimeManager extends EventEmitter {
    constructor({ workerPath, env, executablePath, cwd, spawnFn = spawn }) {
        super();
        this.workerPath = workerPath;
        this.env = env;
        this.executablePath = executablePath;
        this.cwd = cwd;
        this.spawnFn = spawnFn;
        this.entries = new Map();
    }

    status() {
        return Object.fromEntries([...this.entries].map(([id, entry]) => [id, entry.state]));
    }

    isActive(id) {
        return this.entries.has(id);
    }

    setEnv(env) {
        this.env = { ...env };
    }

    emitStatus() {
        this.emit("status", this.status());
    }

    setState(id, state) {
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.state = state;
        this.emitStatus();
    }

    start(account) {
        if (this.entries.get(account.id)?.state === "failed") this.entries.delete(account.id);
        if (this.entries.has(account.id)) return;
        const entry = { account: { ...account }, child: null, state: "starting", intentional: false, restartTimes: [], restartTimer: null, loginTimer: null };
        this.entries.set(account.id, entry);
        this.launch(account.id);
    }

    launch(id) {
        const entry = this.entries.get(id);
        if (!entry || entry.intentional) return;
        const account = entry.account;
        fs.mkdirSync(account.profileDir, { recursive: true });
        fs.mkdirSync(path.dirname(account.logFile), { recursive: true });
        entry.state = entry.restartTimes.length ? "restarting" : "starting";
        this.emitStatus();

        let child;
        try {
            child = this.spawnFn(this.executablePath, [this.workerPath], {
                cwd: this.cwd || path.dirname(this.workerPath),
                env: {
                    ...process.env, ...this.env, ELECTRON_RUN_AS_NODE: "1",
                    ACCOUNT_ID: account.id, ACCOUNT_NAME: account.name, ACCOUNT_REGION: account.region,
                    XHS_PROFILE_DIR: account.profileDir, LOG_FILE: account.logFile,
                    PROCESSED_STATE_FILE: `${account.logFile}.processed.json`,
                    WECHAT_CARD_TYPE: account.wechatCardType, WECHAT_CARD_NAME: account.wechatCardName
                },
                stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true
            });
        } catch (error) {
            this.handleFailure(id, error.message);
            return;
        }
        entry.child = child;
        entry.loginTimer = setTimeout(() => this.setState(id, "waiting_login"), 5000);
        const forward = level => chunk => {
            const message = String(chunk).trimEnd();
            if (/LOGIN_OK/.test(message)) this.setState(id, "initializing");
            if (/SERVICE_READY/.test(message)) {
                clearTimeout(entry.loginTimer);
                entry.restartTimes = [];
                this.setState(id, "running");
            }
            this.emit("log", { accountId: id, level, message, time: new Date().toISOString() });
        };
        child.stdout.on("data", forward("info"));
        child.stderr.on("data", forward("error"));
        child.on("message", message => {
            if (!message || message.type !== "wechat-card-test-result") return;
            this.emit("log", {
                accountId: id,
                level: message.result?.status === "sent" ? "info" : "error",
                message: `CARD_TEST ${JSON.stringify(message.result || {})}`,
                time: new Date().toISOString()
            });
        });
        child.once("error", error => this.handleFailure(id, error.message, child));
        child.once("exit", (code, signal) => this.handleExit(id, code, signal, child));
    }

    testWechatCard(id) {
        const entry = this.entries.get(id);
        if (!entry || entry.state !== "running" || !entry.child?.connected) {
            throw new Error("请先启动账号，等待状态变为“运行中”，并在 Chrome 中打开一个客户对话");
        }
        entry.child.send({ type: "test-wechat-card" });
    }

    handleFailure(id, message, child = null) {
        const entry = this.entries.get(id);
        if (!entry || (child && entry.child !== child)) return;
        this.emit("log", { accountId: id, level: "error", message, time: new Date().toISOString() });
        this.handleExit(id, 1, null, child);
    }

    handleExit(id, code, signal, child = null) {
        const entry = this.entries.get(id);
        if (child?.__runtimeHandled) return;
        if (child) child.__runtimeHandled = true;
        if (!entry || (child && entry.child && entry.child !== child)) return;
        clearTimeout(entry.loginTimer);
        entry.child = null;
        this.emit("exit", { accountId: id, code, signal, intentional: entry.intentional });
        if (entry.intentional) {
            this.entries.delete(id);
            this.emitStatus();
            return;
        }
        const now = Date.now();
        entry.restartTimes = entry.restartTimes.filter(time => now - time < RESTART_WINDOW_MS);
        if (entry.restartTimes.length >= MAX_RESTARTS) {
            entry.state = "failed";
            this.emitStatus();
            return;
        }
        entry.restartTimes.push(now);
        entry.state = "restarting";
        const delay = Math.min(30000, 1000 * (2 ** (entry.restartTimes.length - 1)));
        entry.restartTimer = setTimeout(() => this.launch(id), delay);
        this.emitStatus();
    }

    async stop(id) {
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.intentional = true;
        entry.state = "stopping";
        clearTimeout(entry.restartTimer);
        clearTimeout(entry.loginTimer);
        this.emitStatus();
        const child = entry.child;
        if (!child) {
            this.entries.delete(id);
            this.emitStatus();
            return;
        }
        child.kill("SIGTERM");
        await new Promise(resolve => {
            const timer = setTimeout(() => { if (entry.child) child.kill("SIGKILL"); resolve(); }, 4000);
            child.once("exit", () => { clearTimeout(timer); resolve(); });
        });
    }

    async restart(account) {
        await this.stop(account.id);
        this.start(account);
    }

    async restartAll(accounts) {
        const activeIds = new Set(this.entries.keys());
        await Promise.all([...activeIds].map(id => this.stop(id)));
        for (const account of accounts.filter(item => activeIds.has(item.id) && item.enabled)) this.start(account);
    }

    async stopAll() {
        await Promise.all([...this.entries.keys()].map(id => this.stop(id)));
    }
}

module.exports = { MAX_RESTARTS, RESTART_WINDOW_MS, RuntimeManager };
