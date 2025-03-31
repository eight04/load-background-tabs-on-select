/* global browser */

let manually_disabled = false;
let wasActive = new Set();
let decoder = new TextDecoder("utf-8");
let encoder = new TextEncoder();
let parser = new DOMParser();

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

  async function listener(requestDetails) {
    if (manually_disabled) {
      return;
    }
    if (wasActive.has(requestDetails.tabId)) {
      return;
    }
    const mre = matchesRegEx(
      typeof requestDetails.originUrl === "undefined"
        ? requestDetails.url
        : requestDetails.originUrl,
    );

    if (
      (mode && mre) || // blacklist(true) => matches are not allowed to load
      (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
    ) {
      // Instead of canceling the request, we just rewrite the response
      // we still get the Title, but the actual data that is rendered is keeped to basically nothing
      // which requires less resources
      let filter = await browser.webRequest.filterResponseData(
        requestDetails.requestId,
      );

      filter.ondata = (event) => {
        let str = decoder.decode(event.data, { stream: true });
        const doc = parser.parseFromString(str, "text/html");
        str =
          "<!doctype html><head><title>" +
          doc.title +
          "</title></head><body>please wait ...</body></html>";
        filter.write(encoder.encode(str));
        filter.close();
      };
      return;
    }
    // not really, but lets treat it like it has been activated
    wasActive.add(requestDetails.tabId);
  }

  browser.webRequest.onBeforeRequest.addListener(
    listener,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"],
  );

  // ----
  browser.tabs.onActivated.addListener(async (activeInfo) => {
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

  browser.browserAction.onClicked.addListener(() => {
    manually_disabled = !manually_disabled;
    setToStorage("manually_disabled", manually_disabled);
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.active) {
      wasActive.add(tab.id);
    }
  });
})();
