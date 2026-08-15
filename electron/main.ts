import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  process.env.MCP_HUB_STATE_PATH = join(app.getPath("userData"), "state.json");
  // The server is compiled separately and intentionally starts on import.
  await import("../dist-server/server.js" as string);
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: "#f4f6f2",
    title: "MCP Hub",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  await mainWindow.loadURL("http://127.0.0.1:7331");
  mainWindow.on("closed", () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
