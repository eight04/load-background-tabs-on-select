/* global browser */

let manually_disabled = false;
let wasActive = new Set();
let awaitsActivation = new Map();

async function getFromStorage(type, id, fallback) {
  let tmp = await browser.storage.local.get(id);
  return typeof tmp[id] === type ? tmp[id] : fallback;
}

async function setToStorage(id, value) {
  let obj = {};
  obj[id] = value;
  return browser.storage.local.set(obj);
}

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

(async () => {
  // -------------------------------
  // setup
  // -------------------------------
  await onStorageChange();

  // -------------------------------
  // register listeners
  // -------------------------------

  browser.storage.onChanged.addListener(onStorageChange);

  browser.webRequest.onBeforeRequest.addListener(
    (requestDetails) => {
      if (!manually_disabled) {
        if (!wasActive.has(requestDetails.tabId)) {
          const mre = matchesRegEx(
            typeof requestDetails.originUrl === "undefined"
              ? requestDetails.url
              : requestDetails.originUrl,
          );

          if (
            (mode && mre) || // blacklist(true) => matches are not allowed to load
            (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
          ) {
            awaitsActivation.set(requestDetails.tabId, requestDetails.url);
            return { cancel: true };
          }
          // not really, but lets treat it like it has been activated
          wasActive.add(requestDetails.tabId);
        }
      }
    },
    // blocking the main_frame seems sufficient
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"],
  );

  browser.tabs.onActivated.addListener(async (activeInfo) => {
    if (!wasActive.has(activeInfo.tabId)) {
      wasActive.add(activeInfo.tabId);
      // reload doenst work so we use this instead for now
      if (awaitsActivation.has(activeInfo.tabId)) {
        browser.tabs.update(activeInfo.tabId, {
          url: awaitsActivation.get(activeInfo.tabId),
        });
        awaitsActivation.delete(activeInfo.tabId);
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (wasActive.has(tabId)) {
      wasActive.delete(tabId);
    }
    if (awaitsActivation.has(tabId)) {
      awaitsActivation.delete(tabId);
    }
  });

  browser.browserAction.onClicked.addListener(() => {
    if (manually_disabled) {
      manually_disabled = false;
    } else {
      manually_disabled = true;
    }
    setToStorage("manually_disabled", manually_disabled);
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.active) {
      wasActive.add(tab.id);
    }
  });
})();
