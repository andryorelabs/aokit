import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  console.log("Extension background started", browser.runtime.id);
});
