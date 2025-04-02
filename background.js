/* global browser */

let manually_disabled = false;
let wasActive = new Set();
let awaitsReload = new Map();

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
  // inital setup
  // -------------------------------
  for (const atab of await browser.tabs.query({ active: true })) {
    wasActive.add(atab.id);
  }

  await onStorageChange();

  // -------------------------------
  // register listeners
  // -------------------------------

  browser.storage.onChanged.addListener(onStorageChange);

  async function onBeforeRequest(e) {
    if (manually_disabled) {
      return;
    }

    if (wasActive.has(e.tabId)) {
      return;
    }

    const reqTab = await browser.tabs.get(e.tabId);
    if (reqTab.active) {
      wasActive.add(e.tabId);
      return;
    }

    const mre = matchesRegEx(e.url);

    if (
      (mode && mre) || // blacklist(true) => matches are not allowed to load
      (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
    ) {
      // Instead of canceling the request, we just rewrite the response
      // this way we still get the title,
      // the resources that a tab will allocate should be close to nothing
      // and it should have a stable/reloadable state
      console.debug("reload set");

      // NOTE: awaitsReload should always be set before the user is able to initalize a focus switch to the created yet unfocused tab
      // no documentation seems to explicitly state that this has to be the case so this is an assumption currenlty only supported by tests
      awaitsReload.set(e.tabId, e.url);

      let filter = await browser.webRequest.filterResponseData(e.requestId);

      filter.ondata = (event) => {
        let str = decoder.decode(event.data, { stream: true });
        const doc = parser.parseFromString(str, "text/html");
        str = `<!doctype html>
<head>
  <title>${doc.title}</title>
</head>
<body>
<h1>trying to load now, please wait ... </h1>
</body>
</html>`;
        //console.debug(str);
        filter.write(encoder.encode(str));
        filter.close(); // close filter/stream
      };
      // dont add to wasActive here
      return;
    }
    // not really, but lets treat it like it has been activated
    wasActive.add(e.tabId);
  }

  browser.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    {
      urls: ["<all_urls>"],
      types: ["main_frame"],
    },
    ["blocking"],
  );

  /*
  async function onHeadersReceived(e) {
    if (!manually_disabled) {
      if (!wasActive.has(e.tabId)) {
        const reqTab = await browser.tabs.get(e.tabId);
        if (!reqTab.active) {
          const mre = matchesRegEx(
            typeof e.originUrl === "undefined" ? e.url : e.originUrl,
          );

          if (
            (mode && mre) || // blacklist(true) => matches are not allowed to load
            (!mode && !mre) // whitelist(false) => matches are allowed to load <=> no match => not allowed
          ) {
            return { responseHeaders: [] };
          }
        }
      }
      wasActive.add(e.tabId);
    }
  }

  browser.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    {
      urls: ["<all_urls>"],
      types: [
        "main_frame",
        "sub_frame",
        "stylesheet",
        "script",
        "image",
        "font",
        "object",
        "xmlhttprequest",
        "ping",
        "csp_report",
        "media",
        "websocket",
        "other",
      ],
    },
    ["blocking", "responseHeaders"],
  );
*/

  // ----
  // a newly created background tab should not be activatable before onBeforeRequest was called
  // if it does, the awaitsReload is not set and the load can not be triggered
  browser.tabs.onActivated.addListener(async (activeInfo) => {
    //console.debug('switched focus');
    if (!wasActive.has(activeInfo.tabId)) {
      wasActive.add(activeInfo.tabId);
      // awaitsReload should always be set before we can switch the focus
      setTimeout(() => {
        if (awaitsReload.has(activeInfo.tabId)) {
          browser.tabs.update(activeInfo.tabId, {
            url: awaitsReload.get(activeInfo.tabId),
          });
        }
      }, 2000); // 2secs seems fine ...
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
