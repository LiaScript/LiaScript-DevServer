// The chat shell of the DevServer: tells it that the extension is there, so
// chat.js loads web pages directly, once the rule of this tab is in place.
if (location.pathname == '/liascript/chat.html') {
  document.documentElement.dataset.liaExtension = 'pending'
  chrome.runtime.sendMessage({ shell: true }, function (ok) {
    if (chrome.runtime.lastError || !ok) return delete document.documentElement.dataset.liaExtension
    document.documentElement.dataset.liaExtension = 'ready'
    document.dispatchEvent(new Event('lia-extension'))
  })
}
