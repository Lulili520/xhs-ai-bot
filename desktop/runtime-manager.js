const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

class RuntimeManager extends EventEmitter {
    constructor({ workerPath, env, executablePath, cwd }) {
        super();
        this.workerPath = workerPath;
        this.env = env;
        this.executablePath = executablePath;
        this.cwd = cwd;
        this.processes = new Map();
        this.stopping = new Set();
    }

    status() {
        return Object.fromEntries([...this.processes.keys()].map(id => [id, "running"]));
    }

    setEnv(env) {
        this.env = { ...env };
    }

    start(account) {
        if (this.processes.has(account.id)) return;
        fs.mkdirSync(account.profileDir, { recursive: true });
        fs.mkdirSync(path.dirname(account.logFile), { recursive: true });
        const child = spawn(this.executablePath, [this.workerPath], {
            cwd: this.cwd || path.dirname(this.workerPath),
            env: {
                ...process.env,
                ...this.env,
                ELECTRON_RUN_AS_NODE: "1",
                ACCOUNT_ID: account.id,
                ACCOUNT_NAME: account.name,
                ACCOUNT_REGION: account.region,
                XHS_PROFILE_DIR: account.profileDir,
                LOG_FILE: account.logFile,
                WECHAT_CARD_TYPE: account.wechatCardType,
                WECHAT_CARD_NAME: account.wechatCardName
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });
        this.processes.set(account.id, child);
        const forward = level => chunk => this.emit("log", {
            accountId: account.id,
            level,
            message: String(chunk).trimEnd(),
            time: new Date().toISOString()
        });
        child.stdout.on("data", forward("info"));
        child.stderr.on("data", forward("error"));
        child.on("error", error => forward("error")(error.message));
        child.on("exit", (code, signal) => {
            this.processes.delete(account.id);
            this.stopping.delete(account.id);
            this.emit("exit", { accountId: account.id, code, signal });
            this.emit("status", this.status());
        });
        this.emit("status", this.status());
    }

    async stop(id) {
        const child = this.processes.get(id);
        if (!child) return;
        this.stopping.add(id);
        child.kill("SIGTERM");
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                if (this.processes.has(id)) child.kill("SIGKILL");
                resolve();
            }, 4000);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    async stopAll() {
        await Promise.all([...this.processes.keys()].map(id => this.stop(id)));
    }
}

module.exports = { RuntimeManager };
