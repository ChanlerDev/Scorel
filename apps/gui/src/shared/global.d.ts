import type { GuiApi } from "./ipc.js";

declare global {
  interface Window {
    scorel: GuiApi;
  }
}
