/* global browser */

async function getFromStorage(type, id, fallback) {
  let tmp = await browser.storage.local.get(id);
  return typeof tmp[id] === type ? tmp[id] : fallback;
}

async function setToStorage(id, value) {
  let obj = {};
  obj[id] = value;
  return browser.storage.local.set(obj);
}

(async () => {
  let manually_disabled = false;

  async function getRegexList() {
    let out = [];
    let tmp = await getFromStorage("string", "matchers", "");

    tmp.split("\n").forEach((line) => {
      line = line.trim();
      if (line !== "") {
        try {
          line = new RegExp(line.trim());
          out.push(line);
        } catch (e) {
          console.error(e);
        }
      }
    });
    return out;
  }

  function matchesRegEx(url) {
    for (let i = 0; i < regexList.length; i++) {
      if (regexList[i].test(url)) {
        return true;
      }
    }
    return false;
  }

  async function onStorageChange() {
    manually_disabled = await getFromStorage(
      "boolean",
      "manually_disabled",
      manually_disabled,
    );
    if (manually_disabled) {
      browser.browserAction.setBadgeText({ text: "off" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [115, 0, 0, 115],
      });
    } else {
      browser.browserAction.setBadgeText({ text: "on" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [0, 115, 0, 115],
      });
    }
    mode = await getFromStorage("boolean", "mode", false);
    regexList = await getRegexList();
  }

  await onStorageChange();

  // -------------------------------

  let wasActive = new Set();

  browser.webRequest.onBeforeRequest.addListener(
    (requestDetails) => {
      if (!manually_disabled) {
        if (!wasActive.has(requestDetails.tabId)) {
          console.debug(requestDetails.url, requestDetails.originUrl);
          const mre = matchesRegEx(
            typeof requestDetails.originUrl === "undefined"
              ? requestDetails.url
              : requestDetails.originUrl,
          );

          if (
            (mode && mre) || // blacklist(true) => matches are not allowed to load
            (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
          ) {
            return { cancel: true };
          }
          wasActive.add(requestDetails.tabId); // not really, but lets treat it like it has been activated , that should make things easier
        }
      }
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"],
  );

  browser.tabs.onActivated.addListener((activeInfo) => {
    if (!wasActive.has(activeInfo.tabId)) {
      wasActive.add(activeInfo.tabId);
      browser.tabs.reload(activeInfo.tabId);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (wasActive.has(tabId)) {
      wasActive.delete(tabId);
    }
  });

  browser.storage.onChanged.addListener(onStorageChange);
  browser.browserAction.onClicked.addListener(() => {
    if (manually_disabled) {
      //
      manually_disabled = false;
      browser.browserAction.setBadgeText({ text: "on" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [0, 115, 0, 115],
      });
    } else {
      //
      manually_disabled = true;
      browser.browserAction.setBadgeText({ text: "off" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [115, 0, 0, 115],
      });
    }
    setToStorage("manually_disabled", manually_disabled);
  });
  browser.browserAction.setTitle({ title: "Toggle tab background loading" });
})();

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    browser.runtime.openOptionsPage();
  }
});
