const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("customerService", {
    snapshot: () => ipcRenderer.invoke("app:snapshot"),
    addAccount: input => ipcRenderer.invoke("account:add", input),
    updateAccount: (id, changes) => ipcRenderer.invoke("account:update", id, changes),
    removeAccount: (id, deleteProfile) => ipcRenderer.invoke("account:remove", id, deleteProfile),
    startAccount: id => ipcRenderer.invoke("runtime:start", id),
    stopAccount: id => ipcRenderer.invoke("runtime:stop", id),
    startAll: () => ipcRenderer.invoke("runtime:start-all"),
    stopAll: () => ipcRenderer.invoke("runtime:stop-all"),
    saveSettings: input => ipcRenderer.invoke("settings:save", input),
    onStatus: callback => ipcRenderer.on("runtime:status", (_event, value) => callback(value)),
    onLog: callback => ipcRenderer.on("runtime:log", (_event, value) => callback(value)),
    onExit: callback => ipcRenderer.on("runtime:exit", (_event, value) => callback(value))
});
