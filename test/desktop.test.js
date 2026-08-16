const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { AccountStore } = require("../desktop/account-store");
const { parseEnv } = require("../desktop/env");
const { SettingsStore } = require("../desktop/settings-store");
const { RuntimeManager } = require("../desktop/runtime-manager");

test("parses desktop environment configuration", () => {
    assert.deepEqual(parseEnv("# comment\nAI_PROVIDER=deepseek\nEMPTY=\nQUOTED=\"hello world\"\n"), {
        AI_PROVIDER: "deepseek",
        EMPTY: "",
        QUOTED: "hello world"
    });
});

test("adds, updates and removes dynamic accounts", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-account-store-"));
    try {
        const store = new AccountStore({
            filePath: path.join(dataDir, "accounts.json"),
            dataDir
        });
        const added = store.add({ name: "客服小李", region: "上海静安", enabled: true, wechatCardType: "personal" });
        assert.match(added.id, /^acc_[a-f0-9]{12}$/);
        assert.equal(added.region, "上海静安");
        assert.equal(store.list().length, 1);
        assert.equal(store.update(added.id, { name: "客服小王", region: "杭州西湖", enabled: false }).name, "客服小王");
        assert.equal(store.list()[0].region, "杭州西湖");
        assert.equal(store.list()[0].enabled, false);
        assert.throws(() => store.add({ name: "", region: "上海" }), /名称不能为空/);
        assert.throws(() => store.add({ name: "客服", region: "" }), /地区不能为空/);
        assert.equal(store.remove(added.id).id, added.id);
        assert.equal(store.list().length, 0);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("starts a fresh desktop installation without fixed accounts", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-empty-seed-"));
    try {
        const store = new AccountStore({
            filePath: path.join(dataDir, "accounts.json"),
            dataDir,
            seedFile: path.resolve(__dirname, "../accounts.json")
        });
        assert.deepEqual(store.list(), []);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("migrates legacy accounts with a visible region placeholder", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-account-migrate-"));
    try {
        const filePath = path.join(dataDir, "accounts.json");
        fs.writeFileSync(filePath, JSON.stringify({ accounts: [{
            id: "legacy",
            name: "旧账号",
            enabled: true,
            profileDir: path.join(dataDir, "profile"),
            logFile: path.join(dataDir, "legacy.log")
        }] }));
        const store = new AccountStore({ filePath, dataDir });
        assert.equal(store.list()[0].region, "地区待补充");
        assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).version, 2);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("encrypts desktop API settings and only exposes key presence", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-settings-"));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(`encrypted:${value}`),
        decryptString: value => value.toString().replace(/^encrypted:/, "")
    };
    try {
        const store = new SettingsStore({
            filePath: path.join(dataDir, "settings.json"),
            safeStorage,
            seedEnv: { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "secret", DEEPSEEK_MODEL: "model" }
        });
        assert.deepEqual(store.publicSettings(), {
            provider: "deepseek",
            model: "model",
            baseUrl: "https://api.deepseek.com",
            hasApiKey: true,
            providerKeyStatus: { deepseek: true, openai: false },
            providerSettings: {
                deepseek: { model: "model", baseUrl: "https://api.deepseek.com" },
                openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }
            }
        });
        assert.equal(store.toEnv().DEEPSEEK_API_KEY, "secret");
        assert.doesNotMatch(fs.readFileSync(store.filePath, "utf8"), /secret/);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("keeps API credentials isolated by provider", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-provider-keys-"));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(`encrypted:${value}`),
        decryptString: value => value.toString().replace(/^encrypted:/, "")
    };
    try {
        const store = new SettingsStore({ filePath: path.join(dataDir, "settings.json"), safeStorage });
        store.save({ provider: "deepseek", apiKey: "deep-key" });
        store.save({ provider: "openai", apiKey: "" });
        assert.equal(store.toEnv().OPENAI_API_KEY, "");
        store.save({ provider: "openai", apiKey: "open-key" });
        store.save({ provider: "deepseek", apiKey: "" });
        assert.equal(store.toEnv().DEEPSEEK_API_KEY, "deep-key");
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("recovers account data from the last valid backup", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-account-backup-"));
    try {
        const filePath = path.join(dataDir, "accounts.json");
        const store = new AccountStore({ filePath, dataDir });
        store.add({ name: "账号甲", region: "上海" });
        store.update(store.list()[0].id, { region: "杭州" });
        fs.writeFileSync(filePath, "{broken");
        assert.equal(store.list()[0].region, "上海");
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("reports worker lifecycle states from service output", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-runtime-"));
    class FakeChild extends EventEmitter {
        constructor() {
            super();
            this.stdout = new EventEmitter();
            this.stderr = new EventEmitter();
        }
        kill(signal) { queueMicrotask(() => this.emit("exit", 0, signal)); }
    }
    try {
        let child;
        const runtime = new RuntimeManager({
            workerPath: path.join(dataDir, "worker.js"), executablePath: "node", cwd: dataDir, env: {},
            spawnFn: () => (child = new FakeChild())
        });
        const account = { id: "a1", name: "测试", region: "上海", profileDir: path.join(dataDir, "profile"), logFile: path.join(dataDir, "a1.log"), wechatCardType: "enterprise", wechatCardName: "" };
        runtime.start(account);
        assert.equal(runtime.status().a1, "starting");
        child.stdout.emit("data", "LOGIN_OK\n");
        assert.equal(runtime.status().a1, "initializing");
        child.stdout.emit("data", "SERVICE_READY\n");
        assert.equal(runtime.status().a1, "running");
        await runtime.stop("a1");
        assert.deepEqual(runtime.status(), {});
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
