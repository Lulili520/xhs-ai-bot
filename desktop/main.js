const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { AccountStore } = require("./account-store");
const { RuntimeManager } = require("./runtime-manager");
const { loadEnv } = require("./env");
const { SettingsStore } = require("./settings-store");

let mainWindow;
let accountStore;
let runtime;
let settingsStore;
let quitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
});

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function snapshot() {
    return { accounts: accountStore.list(), status: runtime.status(), settings: settingsStore.publicSettings() };
}

function registerIpc() {
    ipcMain.handle("app:snapshot", () => snapshot());
    ipcMain.handle("account:add", (_event, input) => {
        accountStore.add(input);
        return snapshot();
    });
    ipcMain.handle("account:update", async (_event, id, changes) => {
        const wasActive = runtime.isActive(id);
        const account = accountStore.update(id, changes);
        if (!account.enabled) await runtime.stop(id);
        else if (wasActive) await runtime.restart(account);
        return snapshot();
    });
    ipcMain.handle("account:remove", async (_event, id, deleteProfile) => {
        await runtime.stop(id);
        const account = accountStore.remove(id);
        if (deleteProfile) {
            fs.rmSync(account.profileDir, { recursive: true, force: true });
            fs.rmSync(account.logFile, { force: true });
        }
        return snapshot();
    });
    ipcMain.handle("runtime:start", (_event, id) => {
        const account = accountStore.list().find(item => item.id === id);
        if (!account) throw new Error("账号不存在");
        runtime.start(account);
        return snapshot();
    });
    ipcMain.handle("runtime:stop", async (_event, id) => {
        await runtime.stop(id);
        return snapshot();
    });
    ipcMain.handle("runtime:start-all", () => {
        for (const account of accountStore.list().filter(item => item.enabled)) runtime.start(account);
        return snapshot();
    });
    ipcMain.handle("runtime:stop-all", async () => {
        await runtime.stopAll();
        return snapshot();
    });
    ipcMain.handle("settings:save", async (_event, input) => {
        settingsStore.save(input);
        runtime.setEnv(settingsStore.toEnv());
        await runtime.restartAll(accountStore.list());
        return snapshot();
    });
}

async function createApp() {
    const appRoot = app.getAppPath();
    const dataDir = app.getPath("userData");
    accountStore = new AccountStore({
        filePath: path.join(dataDir, "accounts.json"),
        dataDir,
        seedFile: path.join(appRoot, "accounts.json")
    });
    settingsStore = new SettingsStore({
        filePath: path.join(dataDir, "settings.json"),
        safeStorage,
        seedEnv: app.isPackaged ? {} : loadEnv(path.join(appRoot, ".env"))
    });
    runtime = new RuntimeManager({
        workerPath: path.join(appRoot, "src", "xhs", "service.js"),
        env: settingsStore.toEnv(),
        executablePath: process.execPath,
        cwd: dataDir
    });
    runtime.on("log", entry => send("runtime:log", entry));
    runtime.on("status", status => send("runtime:status", status));
    runtime.on("exit", result => send("runtime:exit", result));
    registerIpc();

    mainWindow = new BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 900,
        minHeight: 600,
        title: "小红书 AI 客服",
        backgroundColor: "#f6f7fb",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

if (hasSingleInstanceLock) app.whenReady().then(createApp);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
    if (quitting || !runtime) return;
    event.preventDefault();
    quitting = true;
    runtime.stopAll().finally(() => app.quit());
});
