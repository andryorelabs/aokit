import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";

export default defineBackground(() => {
  console.log("Extension background started", browser.runtime.id);
});
