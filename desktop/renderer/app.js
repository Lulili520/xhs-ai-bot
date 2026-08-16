const api = window.customerService;
const elements = {
    list: document.querySelector("#accountList"),
    empty: document.querySelector("#emptyState"),
    total: document.querySelector("#totalCount"),
    enabled: document.querySelector("#enabledCount"),
    running: document.querySelector("#runningCount"),
    logs: document.querySelector("#logs"),
    dialog: document.querySelector("#accountDialog"),
    form: document.querySelector("#accountForm"),
    removeDialog: document.querySelector("#removeDialog"),
    removeForm: document.querySelector("#removeForm"),
    settingsDialog: document.querySelector("#settingsDialog"),
    settingsForm: document.querySelector("#settingsForm"),
    toast: document.querySelector("#toast")
};

let accounts = [];
let statuses = {};
let settings = {};
let removeId = null;
let toastTimer;

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

function toast(message, error = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = error ? "show error" : "show";
    toastTimer = setTimeout(() => { elements.toast.className = ""; }, 3000);
}

function render() {
    elements.total.textContent = accounts.length;
    elements.enabled.textContent = accounts.filter(account => account.enabled).length;
    elements.running.textContent = Object.values(statuses).filter(state => state === "running").length;
    elements.empty.hidden = accounts.length > 0;
    elements.list.innerHTML = accounts.map(account => {
        const state = statuses[account.id] || "stopped";
        const active = !["stopped", "failed"].includes(state);
        const stateLabels = { starting: "启动中", waiting_login: "等待登录", initializing: "初始化中", running: "运行中", restarting: "自动重启中", stopping: "停止中", failed: "启动失败", stopped: "已停止" };
        return `<article class="account-row" data-id="${escapeHtml(account.id)}">
            <div class="account-name"><strong>${escapeHtml(account.name)}</strong><span class="region">${escapeHtml(account.region)}</span><code>${escapeHtml(account.id)}</code></div>
            <div class="meta">${account.enabled ? "已启用" : "已停用"} · ${account.wechatCardType === "personal" ? "个人微信" : "企业微信"}</div>
            <span class="badge ${state === "running" ? "running" : ""}">${stateLabels[state] || state}</span>
            <div class="row-actions">
                <button class="button small ${active ? "secondary" : "primary"}" data-action="${active ? "stop" : "start"}">${active ? "停止" : state === "failed" ? "重试" : "启动"}</button>
                <button class="button small secondary" data-action="edit">编辑</button>
                <button class="button small secondary" data-action="remove">移除</button>
            </div>
        </article>`;
    }).join("");
}

function applySnapshot(snapshot) {
    accounts = snapshot.accounts;
    statuses = snapshot.status;
    settings = snapshot.settings || settings;
    render();
}

async function action(task, successMessage) {
    try {
        const snapshot = await task();
        if (snapshot) applySnapshot(snapshot);
        if (successMessage) toast(successMessage);
    } catch (error) {
        toast(error.message || "操作失败", true);
    }
}

function openAccountDialog(account) {
    document.querySelector("#dialogTitle").textContent = account ? "编辑账号" : "添加账号";
    document.querySelector("#accountId").value = account?.id || "";
    document.querySelector("#accountName").value = account?.name || "";
    document.querySelector("#accountRegion").value = account?.region === "地区待补充" ? "" : account?.region || "";
    document.querySelector("#wechatCardType").value = account?.wechatCardType || "enterprise";
    document.querySelector("#wechatCardName").value = account?.wechatCardName || "";
    document.querySelector("#accountEnabled").checked = account?.enabled ?? true;
    elements.dialog.showModal();
    document.querySelector("#accountName").focus();
}

function openSettingsDialog() {
    document.querySelector("#aiProvider").value = settings.provider || "deepseek";
    document.querySelector("#aiApiKey").value = "";
    document.querySelector("#aiModel").value = settings.model || "deepseek-v4-flash";
    document.querySelector("#aiBaseUrl").value = settings.baseUrl || "https://api.deepseek.com";
    document.querySelector("#keyStatus").textContent = settings.hasApiKey
        ? "当前密钥已使用系统加密保存在本机。留空不会覆盖。"
        : "尚未配置 API 密钥；不配置时将使用安全降级回复。";
    elements.settingsDialog.showModal();
}

document.querySelector("#addAccount").addEventListener("click", () => openAccountDialog());
document.querySelector("#closeDialog").addEventListener("click", () => elements.dialog.close());
document.querySelector("#cancelDialog").addEventListener("click", () => elements.dialog.close());
document.querySelector("#closeRemoveDialog").addEventListener("click", () => elements.removeDialog.close());
document.querySelector("#cancelRemove").addEventListener("click", () => elements.removeDialog.close());
document.querySelector("#openSettings").addEventListener("click", openSettingsDialog);
document.querySelector("#closeSettings").addEventListener("click", () => elements.settingsDialog.close());
document.querySelector("#cancelSettings").addEventListener("click", () => elements.settingsDialog.close());

elements.form.addEventListener("submit", event => {
    event.preventDefault();
    const id = document.querySelector("#accountId").value;
    const input = {
        name: document.querySelector("#accountName").value,
        region: document.querySelector("#accountRegion").value,
        enabled: document.querySelector("#accountEnabled").checked,
        wechatCardType: document.querySelector("#wechatCardType").value,
        wechatCardName: document.querySelector("#wechatCardName").value
    };
    action(() => id ? api.updateAccount(id, input) : api.addAccount(input), id ? "账号已更新" : "账号已添加");
    elements.dialog.close();
});

elements.list.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.closest("[data-id]").dataset.id;
    const account = accounts.find(item => item.id === id);
    if (!account) return;
    if (button.dataset.action === "start") action(() => api.startAccount(id), `正在启动 ${account.name}`);
    if (button.dataset.action === "stop") action(() => api.stopAccount(id), `${account.name} 已停止`);
    if (button.dataset.action === "edit") openAccountDialog(account);
    if (button.dataset.action === "remove") {
        removeId = id;
        document.querySelector("#removeName").textContent = account.name;
        document.querySelector("#removeRegion").textContent = account.region;
        document.querySelector("#removeAccountId").textContent = account.id;
        document.querySelector("#deleteProfile").checked = false;
        elements.removeDialog.showModal();
    }
});

elements.settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    const input = {
        provider: document.querySelector("#aiProvider").value,
        apiKey: document.querySelector("#aiApiKey").value,
        model: document.querySelector("#aiModel").value,
        baseUrl: document.querySelector("#aiBaseUrl").value
    };
    elements.settingsDialog.close();
    action(() => api.saveSettings(input), "AI 设置已保存，运行中的账号已自动重启");
});

document.querySelector("#aiProvider").addEventListener("change", event => {
    const openai = event.target.value === "openai";
    const provider = openai ? "openai" : "deepseek";
    const saved = settings.providerSettings?.[provider];
    document.querySelector("#aiModel").value = saved?.model || (openai ? "gpt-4o-mini" : "deepseek-v4-flash");
    document.querySelector("#aiBaseUrl").value = saved?.baseUrl || (openai ? "https://api.openai.com/v1" : "https://api.deepseek.com");
    document.querySelector("#keyStatus").textContent = settings.providerKeyStatus?.[provider]
        ? `${openai ? "OpenAI" : "DeepSeek"} 密钥已加密保存，留空不会覆盖。`
        : `${openai ? "OpenAI" : "DeepSeek"} 尚未配置密钥。`;
});

elements.removeForm.addEventListener("submit", event => {
    event.preventDefault();
    const id = removeId;
    const deleteProfile = document.querySelector("#deleteProfile").checked;
    elements.removeDialog.close();
    action(() => api.removeAccount(id, deleteProfile), "账号已移除");
});

document.querySelector("#startAll").addEventListener("click", () => action(() => api.startAll(), "正在启动全部已启用账号"));
document.querySelector("#stopAll").addEventListener("click", () => action(() => api.stopAll(), "全部账号已停止"));
document.querySelector("#clearLogs").addEventListener("click", () => { elements.logs.textContent = ""; });

api.onStatus(value => { statuses = value; render(); });
api.onExit(({ accountId, code }) => {
    const account = accounts.find(item => item.id === accountId);
    toast(`${account?.name || accountId} 已退出${code ? `（代码 ${code}）` : ""}`, Boolean(code));
});
api.onLog(entry => {
    if (elements.logs.textContent === "等待启动账号…") elements.logs.textContent = "";
    const account = accounts.find(item => item.id === entry.accountId);
    const time = new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false });
    elements.logs.textContent += `[${time}] [${account?.name || entry.accountId}] ${entry.message}\n`;
    const lines = elements.logs.textContent.split("\n");
    if (lines.length > 500) elements.logs.textContent = lines.slice(-500).join("\n");
    elements.logs.scrollTop = elements.logs.scrollHeight;
});

api.snapshot().then(applySnapshot).catch(error => toast(error.message, true));
