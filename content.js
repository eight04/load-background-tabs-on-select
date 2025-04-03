// FIXME: what if the page content is "please wait..."
if (document.body.textContent === "Loading now, please wait...") {
  browser.runtime.sendMessage({action: "dummy-ready"});
}

