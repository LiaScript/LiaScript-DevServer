// The tab of a chat shell of the DevServer gets a session rule: the frames in
// it lose the headers that forbid framing, the course of the DevServer keeps
// its own. No state of its own, the service worker may stop at any time.

var HEADERS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only']

function shell(url) {
  try {
    var u = new URL(url)
    return /^(localhost|127\.0\.0\.1)$/.test(u.hostname) && u.pathname == '/liascript/chat.html' ? u.origin : ''
  } catch (e) {
    return ''
  }
}

function forget(tabId) {
  return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] })
}

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  var tab = sender.tab
  var origin = tab && shell(tab.url)
  // the shell: frames in this tab may show any page
  if (msg && msg.shell) {
    if (!origin || sender.frameId) return reply(false)
    chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [tab.id],
        addRules: [
          {
            id: tab.id,
            action: {
              type: 'modifyHeaders',
              responseHeaders: HEADERS.map(function (header) {
                return { header: header, operation: 'remove' }
              }),
            },
            condition: {
              tabIds: [tab.id],
              resourceTypes: ['sub_frame'],
              excludedRequestDomains: ['localhost', '127.0.0.1'],
            },
          },
        ],
      })
      .then(function () {
        reply(true)
      })
      .catch(function () {
        reply(false)
      })
    return true
  }
  // a page in a frame: the origin of the shell it reports to, if any
  if (msg && msg.where) reply(origin || '')
})

chrome.tabs.onRemoved.addListener(function (tabId) {
  forget(tabId)
})
chrome.tabs.onUpdated.addListener(function (tabId, change) {
  if (change.url && !shell(change.url)) forget(tabId)
})
