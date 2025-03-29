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
  const temporary = browser.runtime.id.endsWith("@temporary-addon"); // debugging?
  const manifest = browser.runtime.getManifest();
  const extname = manifest.name;
  let manually_disabled = false;

  async function getMode() {
    return await getFromStorage("boolean", "mode", false);
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

  async function onStorageChange(/*changes, area*/) {
    manually_disabled = await getFromStorage(
      "boolean",
      "manually_disabled",
      false,
    );
    if (!manually_disabled) {
      //
      browser.browserAction.setBadgeText({ text: "on" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [0, 115, 0, 115],
      });
    } else {
      //
      browser.browserAction.setBadgeText({ text: "off" });
      browser.browserAction.setBadgeBackgroundColor({
        color: [115, 0, 0, 115],
      });
    }
    mode = await getMode();
    regexList = await getRegexList();
  }

  await onStorageChange();

  // -------------------------------

  class ObservedSet extends Set {
    constructor() {
      super();
      this._waiters = new Map(); // id => {promise, resolve}
    }
    add(id) {
      super.add(id);
      if (this._waiters.has(id)) {
        this._waiters.get(id).resolve();
        this._waiters.delete(id);
      }
    }
    delete(id) {
      super.delete(id);
      if (this._waiters.has(id)) {
        this._waiters.delete(id);
      }
    }
    waitUntilHas(id) {
      if (this.has(id)) {
        return Promise.resolve();
      }
      if (!this._waiters.has(id)) {
        let resolve;
        let promise = new Promise((r) => {
          resolve = r;
        });
        this._waiters.set(id, { promise, resolve });
      }
      return this._waiters.get(id).promise;
    }
  }

  let wasActive = new ObservedSet();

  function shouldDiscard(tab) {
    // ignore privileged tabs (extensions, about:*)
    if (tab.id < 0) return false;

    // ignore
    if (
      !(
        tab.active ||
        tab.hidden ||
        tab.discarded ||
        wasActive.has(tab.id) ||
        manually_disabled ||
        !tab.url.startsWith("http")
      )
    ) {
      const mre = matchesRegEx(tab.url);

      if (
        (mode && mre) || // blacklist(true) => matches are not allowed to load
        (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
      ) {
        return true;
      }
    }
    return false;
  }

  // FIXME: toggle discard method via options?
  // browser.tabs.onUpdated.addListener(
  //   (tabId, changeInfo, tab) => {
  //     if (shouldDiscard(tab)) {
  //       browser.tabs.discard(tabId);
  //     }
  //   },
  //   { properties: ["url"] },
  // );

  browser.tabs.onActivated.addListener((activeInfo) => {
    if (!wasActive.has(activeInfo.tabId)) {
      wasActive.add(activeInfo.tabId);
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

  // FIXME: use optional permissions
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const tab = {
        id: details.tabId,
        url: details.documentUrl || details.originUrl || details.url
      };
      if (shouldDiscard(tab)) {
        console.debug(`blocking ${details.url}`);
        return wasActive.waitUntilHas(tab.id);
      }
    },
    { urls: ["<all_urls>"], types: ["image", "imageset", "media", "object", "script", "sub_frame"] },
    ["blocking"],
  )
})();

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    browser.runtime.openOptionsPage();
  } else {
    // Migrate old data
    let tmp = await getFromStorage("object", "selectors", []);
    tmp = tmp.map((e) => e.url_regex).join("\n");
    await setToStorage("matchers", tmp);
  }
});
