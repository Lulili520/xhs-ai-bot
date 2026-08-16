const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function cleanName(value) {
    const name = String(value || "").trim().slice(0, 40);
    if (!name) throw new Error("账号名称不能为空");
    return name;
}

function cleanRegion(value) {
    const region = String(value || "").trim().slice(0, 60);
    if (!region) throw new Error("账号地区不能为空");
    return region;
}

function normalizeAccount(account) {
    if (!account || !account.id) throw new Error("账号缺少唯一 ID");
    return {
        id: String(account.id),
        name: cleanName(account.name || account.id),
        region: cleanRegion(account.region || "地区待补充"),
        enabled: account.enabled !== false,
        profileDir: String(account.profileDir),
        logFile: String(account.logFile),
        wechatCardType: account.wechatCardType === "personal" ? "personal" : "enterprise",
        wechatCardName: String(account.wechatCardName || "").trim().slice(0, 80)
    };
}

class AccountStore {
    constructor({ filePath, dataDir, seedFile }) {
        this.filePath = filePath;
        this.dataDir = dataDir;
        this.seedFile = seedFile;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.initialize();
    }

    initialize() {
        if (fs.existsSync(this.filePath)) {
            const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
            this.write((raw.accounts || []).map(normalizeAccount));
            return;
        }
        let seed = { accounts: [] };
        if (this.seedFile && fs.existsSync(this.seedFile)) {
            seed = JSON.parse(fs.readFileSync(this.seedFile, "utf8"));
        }
        const accounts = (seed.accounts || []).map((account, index) => {
            const id = account.id || `account-${index + 1}`;
            return normalizeAccount({
                ...account,
                id,
                name: account.name || (id === "main" ? "主账号" : id),
                region: account.region || "地区待补充",
                profileDir: path.join(this.dataDir, "profiles", id),
                logFile: path.join(this.dataDir, "logs", `${id}.log`)
            });
        });
        this.write(accounts);
    }

    list() {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        return (data.accounts || []).map(normalizeAccount);
    }

    write(accounts) {
        const tempPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tempPath, `${JSON.stringify({ version: 2, accounts }, null, 2)}\n`, "utf8");
        fs.renameSync(tempPath, this.filePath);
    }

    add(input) {
        const accounts = this.list();
        const name = cleanName(input.name);
        const region = cleanRegion(input.region);
        if (accounts.some(account => account.name === name && account.region === region)) {
            throw new Error("相同名称和地区的账号已存在");
        }
        const id = `acc_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const account = normalizeAccount({
            id,
            name,
            region,
            enabled: input.enabled !== false,
            profileDir: path.join(this.dataDir, "profiles", id),
            logFile: path.join(this.dataDir, "logs", `${id}.log`),
            wechatCardType: input.wechatCardType,
            wechatCardName: input.wechatCardName
        });
        accounts.push(account);
        this.write(accounts);
        return account;
    }

    update(id, changes) {
        const accounts = this.list();
        const index = accounts.findIndex(account => account.id === id);
        if (index < 0) throw new Error("账号不存在");
        const name = cleanName(changes.name ?? accounts[index].name);
        const region = cleanRegion(changes.region ?? accounts[index].region);
        if (accounts.some((account, accountIndex) => accountIndex !== index && account.name === name && account.region === region)) {
            throw new Error("相同名称和地区的账号已存在");
        }
        accounts[index] = normalizeAccount({
            ...accounts[index],
            name,
            region,
            enabled: changes.enabled ?? accounts[index].enabled,
            wechatCardType: changes.wechatCardType ?? accounts[index].wechatCardType,
            wechatCardName: changes.wechatCardName ?? accounts[index].wechatCardName
        });
        this.write(accounts);
        return accounts[index];
    }

    remove(id) {
        const accounts = this.list();
        const account = accounts.find(item => item.id === id);
        if (!account) throw new Error("账号不存在");
        this.write(accounts.filter(item => item.id !== id));
        return account;
    }
}

module.exports = { AccountStore, cleanName, cleanRegion, normalizeAccount };
