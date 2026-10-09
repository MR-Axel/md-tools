// Anonymous counts, for the site and the web app. What is sent is the name of an event from a short list (a visit, the
// app opened, a first note) and the channel the visit came from ("reddit", "direct"). Nothing else: no cookie, no
// identifier of a person or a device, nothing about the notes, no address and no file name. The server adds one to a
// counter per day and stores nothing about who sent it.
// Nothing is sent when the browser asks not to be tracked, when "Send anonymous usage counts" is off in Settings, when
// the app uses another server or no cloud, or anywhere that is not the published site: a fork, a copy served from
// somewhere else and the extension send nothing. The extension never loads this file over a file from the disk.
// The site pages load it with data-page (home, mcp, wysiwyg, pay). The app loads it with no attribute.
(function () {
  'use strict';
  var SITE = 'https://sharpmd.app';
  var TO = 'https://sync.sharpmd.app/stats';
  var tag = document.currentScript;
  var app = !!(window.LMD && window.__MDT_WEB === true);
  var page = (tag && tag.getAttribute('data-page')) || (app ? 'app' : '');
  var noop = function () {}; noop.source = function () { return ''; }; noop.on = function () { return false; };
  if (window.LMD) window.LMD.count = noop;
  window.sharpmdCount = noop;
  if (!page) return;

  var local = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var keep = function (store, k, v) { try { store.setItem(k, v); } catch (e) { /* no storage: it is asked again next time */ } };
  var session = function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  var settings = function () { try { return JSON.parse(localStorage.getItem('mdtools:settings') || '{}') || {}; } catch (e) { return {}; } };

  // Only the published site counts, with the server of this version, and only if nobody said no.
  function on() {
    if (location.origin !== SITE) return false;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return false;
    var s = settings();
    return s.usageCounts !== false && !s.cloudUrl;
  }

  // ---------- Where the visit came from: a label, never an address ----------
  var ALIAS = { x: 'twitter', tw: 'twitter', 't-co': 'twitter', 'x-com': 'twitter', hn: 'hackernews', ycombinator: 'hackernews', 'news-ycombinator-com': 'hackernews', wa: 'whatsapp', 'wa-me': 'whatsapp',
    tg: 'telegram', 't-me': 'telegram', li: 'linkedin', yt: 'youtube', gh: 'github', ph: 'producthunt', 'product-hunt': 'producthunt', cws: 'chrome-web-store', play: 'play-store', 'google-play': 'play-store' };
  var HOSTS = [
    [/(^|\.)(reddit\.com|redd\.it)$/, 'reddit'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
    [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, 'telegram'], [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'twitter'], [/(^|\.)github\.com$/, 'github'],
    [/^(chromewebstore\.google\.com|chrome\.google\.com)$/, 'chrome-web-store'], [/^play\.google\.com$/, 'play-store'],
    [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/^news\.ycombinator\.com$/, 'hackernews'], [/(^|\.)producthunt\.com$/, 'producthunt'],
  ];
  // An Android app that opened the link says which app it is, not which page.
  var APPS = [['reddit', 'reddit'], ['linkedin', 'linkedin'], ['whatsapp', 'whatsapp'], ['telegram', 'telegram'], ['twitter', 'twitter'], ['youtube', 'youtube'], ['github', 'github'], ['vending', 'play-store'], ['google', 'google']];
  function label(text) {
    var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
    return ALIAS[s] || s;
  }
  function fromLink() {
    var q = null; try { q = new URLSearchParams(location.search); } catch (e) { return ''; }
    // In the app, src is how the Android app says it is the Android app: it is not a channel there.
    var names = app ? ['utm_source', 'ref'] : ['utm_source', 'ref', 'src'];
    for (var i = 0; i < names.length; i++) { var l = label(q.get(names[i])); if (l) return l; }
    return '';
  }
  function fromReferrer() {
    var r = document.referrer || ''; if (!r) return 'direct';
    var u = null; try { u = new URL(r); } catch (e) { return 'other'; }
    if (u.origin === location.origin) return ''; // a page of this same site is not where the visit came from
    var host = u.hostname.toLowerCase(); var i;
    if (u.protocol === 'android-app:') { for (i = 0; i < APPS.length; i++) if (host.indexOf(APPS[i][0]) >= 0) return APPS[i][1]; return 'other'; }
    for (i = 0; i < HOSTS.length; i++) if (HOSTS[i][0].test(host)) return HOSTS[i][1];
    return 'other';
  }
  // The channel of this visit lasts as long as the tab. The first one this browser ever came from is kept: it is what
  // the app sends, so the steps after the visit are counted under the channel that brought the person.
  var VISIT = 'sharpmd:src'; var FIRST = 'sharpmd:src1';
  function source() {
    var now = fromLink() || session(VISIT) || fromReferrer() || 'direct';
    if (app && now === 'direct' && window.LMD.storeApp) now = 'play-store';
    keep(sessionStorage, VISIT, now);
    var first = local(FIRST);
    if (!first) { first = now; keep(localStorage, FIRST, first); }
    return app ? first : now;
  }

  // ---------- Sending ----------
  function send(events) {
    if (!events.length || !on()) return;
    var body = { e: events.length === 1 ? events[0] : events, p: page, s: source() };
    var v = page === 'home' ? document.documentElement.getAttribute('data-ab') : '';
    if (v === 'a' || v === 'b') body.v = v;
    var text = JSON.stringify(body);
    try {
      // As plain text: it needs no question to the server first. It never waits for the answer.
      if (navigator.sendBeacon) { navigator.sendBeacon(TO, text); return; }
      fetch(TO, { method: 'POST', body: text, keepalive: true, mode: 'no-cors', credentials: 'omit' }).catch(noop);
    } catch (e) { /* not counted */ }
  }
  // What this browser already sent once ("first" events), by name.
  var ONCE = 'sharpmd:counted';
  var sentOnce = function () { var v = local(ONCE); return v == null ? null : v.split(',').filter(Boolean); };
  var seen = {}; // once per page, for the rest

  if (!app) {
    // A page of the site: one view when it loads, and the first click on a link to the app or to the plans.
    var count = function (e) { if (seen[e]) return; seen[e] = true; send([e]); };
    count.source = function () { return on() ? source() : ''; }; count.on = on;
    window.sharpmdCount = count;
    count('view');
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null; if (!a) return;
      var h = a.getAttribute('href') || '';
      if (/src\/app\.html/.test(h)) count('open'); else if (/#plans$/.test(h)) count('plans');
    }, true);
    return;
  }

  // ---------- The app ----------
  var FIRSTS = ['first_open', 'note_created', 'edited'];
  // A browser that already used the app before these counts existed is not a first time of anything.
  function already() {
    var done = sentOnce();
    if (done == null) { done = window.__MDT_NEW === true ? [] : FIRSTS.slice(); keep(localStorage, ONCE, done.join(',')); }
    return done;
  }
  function once(list, e) { if (list.indexOf(e) >= 0) return false; list.push(e); keep(localStorage, ONCE, list.join(',')); return true; }
  var appCount = function (e) {
    if (FIRSTS.indexOf(e) < 0 || !on()) return;
    if (once(already(), e)) send([e]);
  };
  // The channel, for the sign-in: it goes with the request for the code, and the server counts with it. Empty when off.
  appCount.source = function () { return on() ? source() : ''; }; appCount.on = on;
  window.LMD.count = appCount;
  // One request, once the app is drawn and the browser is idle: the app opened in this tab, and whether it is the first time.
  function opened() {
    if (!on()) return;
    var events = [];
    if (session('sharpmd:open') !== '1') { keep(sessionStorage, 'sharpmd:open', '1'); events.push('app_open'); }
    if (once(already(), 'first_open')) events.push('first_open');
    send(events);
  }
  function idle() { if (window.requestIdleCallback) requestIdleCallback(opened, { timeout: 5000 }); else setTimeout(opened, 1500); }
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle);
})();
