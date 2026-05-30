import { mountWebUi } from "./app.js";

const root = document.querySelector<HTMLElement>("#app");

if (root) {
  mountWebUi(root);
}
