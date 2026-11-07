document.getElementById("start").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "VF_START_ACTIVE" });
  window.close();
});
