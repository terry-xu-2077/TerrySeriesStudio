/* TerrySeriesStudio — immersive co-writing demo.
   Vanilla JS, static deterministic mock AI. No network, API keys, ComfyUI or backend. */
(function () {
  "use strict";

  var STORAGE_KEY = "terry-series-studio-immersive-demo-v1";

  var demoBlocks = [
    {id:"sc01-heading",kind:"scene",text:"场景 01　　基地内部 / 夜"},
    {id:"sc01-action1",kind:"action",text:"灯光不太稳定。特瑞坐在工作台旁，盯着一堆刚带回来的旧零件。风从门边的缝隙里灌进来，带着轻微的金属摩擦声。"},
    {id:"sc01-action2",kind:"action",text:"小七的指示灯亮了一下。它在工作台周围转动，像是在等待一个答案。"},
    {id:"sc01-line1",kind:"dialogue",speaker:"特瑞",text:"我们没有别的选择了。"},
    {id:"sc01-line2",kind:"dialogue",speaker:"小七",text:"如果每一次都这样，我们到底是在修什么？"},
    {id:"sc01-action3",kind:"action",text:"特瑞没有立即回答。他把一枚生锈的螺丝慢慢放回桌面。"},
    {id:"sc02-heading",kind:"scene",text:"场景 02　　基地外部 / 黎明"},
    {id:"sc02-action1",kind:"action",text:"远处的光缓慢地越过地平线。特瑞背起工具包，回头看了一眼基地，然后走进还没有完全散去的晨雾。"}
  ];

  function initialState() {
    return {
      revision: 1,
      approved: false,
      blocks: clone(demoBlocks),
      threads: [],
      activeThreadId: null
    };
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function elem(id) { return document.getElementById(id); }
  function query(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function escapeHTML(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.blocks) || !Array.isArray(parsed.threads)) return initialState();
      return {
        revision: parsed.revision || 1,
        approved: !!parsed.approved,
        blocks: parsed.blocks,
        threads: parsed.threads,
        activeThreadId: null
      };
    } catch (e) { return initialState(); }
  }

  var state = loadState();
  var saveTimer = null, toastTimer = null;
  var typingThreadId = null;
  var pendingSelection = null; // {blockId, quote, start, end, rect}
  var ghostIdleTimer = null;
  var ghostEl = null;

  var doc = elem("doc");
  var gutter = elem("gutter");
  var chatThreads = elem("chatThreads");
  var selectBubble = elem("selectBubble");
  var layout = elem("layout");

  /* ───────────────────────── persistence / status ───────────────────────── */

  function getBlock(id) { return state.blocks.find(function (b) { return b.id === id; }); }
  function lastBlock() { return state.blocks[state.blocks.length - 1]; }

  function markUnsaved() {
    elem("saveIndicator").classList.add("saving");
    elem("saveText").textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elem("saveIndicator").classList.remove("saving");
      elem("saveText").textContent = "已自动保存";
    } catch (e) {
      elem("saveIndicator").classList.remove("saving");
      elem("saveText").textContent = "保存失败：浏览器存储不可用";
    }
  }
  function notify(message) {
    var node = elem("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove("show"); }, 2800);
  }
  function updateWordCount() {
    var total = state.blocks.reduce(function (sum, b) { return sum + b.text.replace(/\s/g, "").length; }, 0);
    elem("wordCount").textContent = String(total);
  }
  function updateHeader() {
    elem("revIndicator").textContent = "定稿修订 r" + state.revision + (state.approved ? " · 已批准" : "");
    elem("approveBtn").classList.toggle("approved", state.approved);
    elem("approveLabel").textContent = state.approved ? "已批准" : "批准本稿";
    updateWordCount();
  }

  /* ───────────────────────── document rendering ───────────────────────── */

  function renderDoc() {
    doc.replaceChildren();
    state.blocks.forEach(function (block) {
      var section = document.createElement("section");
      section.className = "block";
      section.dataset.kind = block.kind;
      section.dataset.blockId = block.id;
      if (block.speaker) {
        var sp = document.createElement("div");
        sp.className = "speaker";
        sp.textContent = block.speaker;
        section.appendChild(sp);
      }
      var textEl = document.createElement("div");
      textEl.className = "block-text";
      textEl.contentEditable = "true";
      textEl.spellcheck = false;
      textEl.setAttribute("role", "textbox");
      textEl.setAttribute("aria-multiline", "true");
      textEl.dataset.blockId = block.id;
      textEl.textContent = block.text;
      attachBlockEvents(textEl, block);
      section.appendChild(textEl);
      doc.appendChild(section);
    });
    scheduleGutter();
  }

  function syncBlockDom(blockId) {
    var block = getBlock(blockId);
    var textEl = query('.block-text[data-block-id="' + blockId + '"]');
    if (block && textEl) textEl.textContent = block.text;
  }

  function flashBlock(blockId) {
    var section = query('.block[data-block-id="' + blockId + '"]');
    if (!section) return;
    section.classList.add("flash");
    setTimeout(function () { section.classList.remove("flash"); }, 900);
  }

  var blockFocusMemo = null;
  function attachBlockEvents(textEl, block) {
    textEl.addEventListener("focus", function () {
      blockFocusMemo = { blockId: block.id, before: block.text };
    });
    textEl.addEventListener("input", function () {
      block.text = textEl.textContent || "";
      state.approved = false;
      markUnsaved();
      updateWordCount();
      scheduleGhostCheck();
    });
    textEl.addEventListener("blur", function () {
      if (blockFocusMemo && blockFocusMemo.blockId === block.id) {
        if (blockFocusMemo.before !== block.text) {
          state.revision++;
          updateHeader();
          saveNow();
        }
        blockFocusMemo = null;
      }
    });
    textEl.addEventListener("paste", function (event) {
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    textEl.addEventListener("keydown", function (event) {
      if (ghostEl && textEl === lastBlockTextEl()) {
        if (event.key === "Tab") { event.preventDefault(); commitGhost(); return; }
        removeGhost();
      }
      if (event.key === "Enter") { event.preventDefault(); document.execCommand("insertText", false, "\n"); }
    });
    textEl.addEventListener("mouseup", function () { setTimeout(function () { captureSelection(); scheduleGhostCheck(); }, 0); });
    textEl.addEventListener("keyup", function (event) {
      if (!["Shift", "Control", "Meta", "Alt"].includes(event.key)) setTimeout(captureSelection, 0);
      scheduleGhostCheck();
    });
  }

  /* ───────────────────────── gutter (thread indicators) ───────────────────────── */

  var gutterQueued = false;
  function scheduleGutter() {
    if (gutterQueued) return;
    gutterQueued = true;
    requestAnimationFrame(function () { gutterQueued = false; renderGutter(); });
  }
  function threadsForBlock(blockId) {
    return state.threads.filter(function (t) { return t.blockId === blockId; });
  }
  function threadHasPendingRevision(thread) {
    var last = lastRevisionEntry(thread);
    return !!last && last.resolution === "pending";
  }
  function lastRevisionEntry(thread) {
    for (var i = thread.log.length - 1; i >= 0; i--) {
      if (thread.log[i].type === "revision") return thread.log[i];
    }
    return null;
  }
  function renderGutter() {
    gutter.replaceChildren();
    var gutterRect = gutter.getBoundingClientRect();
    state.blocks.forEach(function (block) {
      var threads = threadsForBlock(block.id);
      if (!threads.length) return;
      var pending = threads.some(threadHasPendingRevision);
      var section = query('.block[data-block-id="' + block.id + '"]');
      if (!section) return;
      var sectionRect = section.getBoundingClientRect();
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "gutter-dot" + (pending ? " active-thread" : " resolved");
      dot.style.top = (sectionRect.top - gutterRect.top + 2) + "px";
      dot.title = pending ? "有待确认的 AI 修改" : "已讨论过这段";
      dot.addEventListener("click", function () {
        var preferred = threads.find(threadHasPendingRevision) || threads[threads.length - 1];
        openChatPanel();
        setActiveThread(preferred.id);
        scrollThreadIntoView(preferred.id);
      });
      gutter.appendChild(dot);
    });
  }
  window.addEventListener("resize", scheduleGutter);

  /* ───────────────────────── text selection → "跟 AI 聊这段" ───────────────────────── */

  function lastBlockTextEl() {
    var nodes = all(".block-text");
    return nodes[nodes.length - 1] || null;
  }

  function selectionFromWindow() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    var endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    if (!startEl || !endEl || !startEl.closest || !endEl.closest) return null;
    var startBlock = startEl.closest(".block-text"), endBlock = endEl.closest(".block-text");
    if (!startBlock || !endBlock || startBlock !== endBlock) return null;
    var before = document.createRange();
    before.selectNodeContents(startBlock);
    try { before.setEnd(range.startContainer, range.startOffset); } catch (e) { return null; }
    var start = before.toString().length, quote = sel.toString();
    var source = getBlock(startBlock.dataset.blockId);
    if (!source || !quote.trim() || source.text.slice(start, start + quote.length) !== quote) return null;
    return { blockId: source.id, quote: quote, start: start, end: start + quote.length, rect: range.getBoundingClientRect() };
  }

  function captureSelection() {
    var sel = selectionFromWindow();
    if (!sel) { selectBubble.hidden = true; pendingSelection = null; return; }
    pendingSelection = sel;
    var rect = sel.rect, width = 150;
    selectBubble.style.left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left + rect.width / 2 - width / 2)) + "px";
    selectBubble.style.top = Math.max(10, rect.top - 46) + "px";
    selectBubble.hidden = false;
  }

  function openChatWithSelection() {
    var sel = pendingSelection;
    if (!sel) { notify("请先在正文中选中一段文字"); return; }
    var block = getBlock(sel.blockId);
    if (!block || block.text.slice(sel.start, sel.end) !== sel.quote) { notify("所选文字已变化，请重新选择"); return; }
    selectBubble.hidden = true;
    var existing = state.threads.find(function (t) { return t.blockId === sel.blockId && t.quote === sel.quote && !threadResolvedDone(t); });
    var thread = existing;
    if (!thread) {
      thread = { id: newId(), blockId: sel.blockId, quote: sel.quote, instructions: [], log: [] };
      state.threads.push(thread);
    }
    openChatPanel();
    setActiveThread(thread.id);
    window.getSelection().removeAllRanges();
    pendingSelection = null;
    scrollThreadIntoView(thread.id);
    elem("chatInput").focus();
    scheduleGutter();
    saveNow();
  }
  function threadResolvedDone(thread) {
    // A thread is "done for now" only cosmetically; messages can always continue.
    return false;
  }

  /* ───────────────────────── chat panel ───────────────────────── */

  function openChatPanel() { layout.classList.remove("chat-collapsed"); elem("toggleChat").setAttribute("aria-pressed", "true"); }
  function closeChatPanel() { layout.classList.add("chat-collapsed"); elem("toggleChat").setAttribute("aria-pressed", "false"); }

  function setActiveThread(threadId) {
    state.activeThreadId = threadId;
    renderComposerRef();
    renderThreads();
  }
  function getThread(id) { return state.threads.find(function (t) { return t.id === id; }); }
  function generalThread() {
    var t = state.threads.find(function (t) { return t.id === "general"; });
    if (!t) { t = { id: "general", blockId: null, quote: null, instructions: [], log: [] }; state.threads.push(t); }
    return t;
  }
  function activeThreadOrGeneral() {
    var t = state.activeThreadId && getThread(state.activeThreadId);
    return t || generalThread();
  }

  function renderComposerRef() {
    var t = state.activeThreadId && getThread(state.activeThreadId);
    var ref = elem("composerRef");
    var switchGeneral = elem("switchGeneral");
    if (t && t.quote) {
      ref.hidden = false;
      elem("composerRefQuote").textContent = "“" + t.quote + "”";
      switchGeneral.hidden = false;
    } else {
      ref.hidden = true;
      switchGeneral.hidden = true;
    }
  }

  function scrollThreadIntoView(threadId) {
    requestAnimationFrame(function () {
      var card = query('.thread[data-thread-id="' + threadId + '"]');
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function renderThreads() {
    var order = state.threads.filter(function (t) { return t.id !== "general"; });
    var gen = state.threads.find(function (t) { return t.id === "general"; });
    if (gen && gen.log.length) order.push(gen);
    chatThreads.replaceChildren();
    if (!order.length) {
      chatThreads.innerHTML = '<div class="chat-empty"><div class="chat-empty-glyph">✦</div>'
        + '<h3>选一段文字，开始共写</h3>'
        + '<p>框选正文中的任意一句，点击「跟 AI 聊这段」，把你想怎么改告诉它；也可以直接在下面输入框里随便聊聊。</p></div>';
      return;
    }
    order.forEach(function (thread) { chatThreads.appendChild(renderThreadCard(thread)); });
  }

  function renderThreadCard(thread) {
    var card = document.createElement("article");
    card.className = "thread" + (thread.id === state.activeThreadId ? " active" : "");
    card.dataset.threadId = thread.id;
    if (thread.quote) {
      var head = document.createElement("div");
      head.className = "thread-quote-head";
      var pending = threadHasPendingRevision(thread);
      head.innerHTML = '<span class="quote-mark">“</span><span>' + escapeHTML(thread.quote) + '</span>'
        + '<span class="thread-status-chip">' + (pending ? "待确认" : "讨论中") + '</span>';
      card.appendChild(head);
    } else {
      var genHead = document.createElement("div");
      genHead.className = "thread-quote-head";
      genHead.innerHTML = '<span>综合讨论 · 不针对某一句</span>';
      card.appendChild(genHead);
    }
    var body = document.createElement("div");
    body.className = "thread-body";
    thread.log.forEach(function (entry, index) { renderLogEntry(body, thread, entry, index); });
    if (typingThreadId === thread.id) {
      var thinking = document.createElement("div");
      thinking.className = "thinking";
      thinking.innerHTML = "AI 正在改<span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span>";
      body.appendChild(thinking);
    }
    card.appendChild(body);
    card.addEventListener("click", function (event) {
      if (event.target.closest("button, textarea")) return;
      openChatPanel();
      setActiveThread(thread.id);
    });
    return card;
  }

  function renderLogEntry(body, thread, entry, index) {
    if (entry.type === "user") {
      var m = document.createElement("div");
      m.className = "msg msg-user";
      m.textContent = entry.text;
      body.appendChild(m);
      return;
    }
    if (entry.type === "ai_chat") {
      var a = document.createElement("div");
      a.className = "msg msg-ai-text";
      a.textContent = entry.text;
      body.appendChild(a);
      return;
    }
    if (entry.type === "system") {
      var s = document.createElement("div");
      s.className = "msg-system";
      s.textContent = entry.text;
      body.appendChild(s);
      return;
    }
    if (entry.type === "revision") {
      body.appendChild(renderRevisionEntry(thread, entry, index));
    }
  }

  function renderRevisionEntry(thread, entry, index) {
    var wrap = document.createElement("div");
    wrap.className = "revise-card";
    if (entry.resolution === "pending") {
      wrap.innerHTML =
        '<div class="revise-version">AI 改写 · v' + entry.version + '</div>'
        + '<div class="revise-diff">'
        + '<div class="revise-old">' + escapeHTML(entry.original) + '</div>'
        + '<div class="revise-new"><span class="caret">→</span>' + escapeHTML(entry.proposal) + '</div>'
        + '</div>'
        + '<div class="revise-actions">'
        + '<button type="button" class="accept-btn" data-action="accept">✓ 采用</button>'
        + '<button type="button" class="retry-btn" data-action="retry">不满意，再改一版</button>'
        + '</div>'
        + '<div class="retry-box" data-retry-box>'
        + '<textarea rows="2" placeholder="说说哪里不好，或者想往什么方向改（可以留空直接换一版）"></textarea>'
        + '<div class="retry-box-row"><button type="button" class="retry-cancel" data-action="retry-cancel">取消</button>'
        + '<button type="button" class="retry-send" data-action="retry-send">再生成</button></div>'
        + '</div>';
      var acceptBtn = wrap.querySelector('[data-action="accept"]');
      acceptBtn.addEventListener("click", function (e) { e.stopPropagation(); acceptRevision(thread.id, index); });
      wrap.querySelector('[data-action="retry"]').addEventListener("click", function (e) {
        e.stopPropagation();
        wrap.querySelector("[data-retry-box]").classList.add("open");
      });
      wrap.querySelector('[data-action="retry-cancel"]').addEventListener("click", function (e) {
        e.stopPropagation();
        wrap.querySelector("[data-retry-box]").classList.remove("open");
      });
      wrap.querySelector('[data-action="retry-send"]').addEventListener("click", function (e) {
        e.stopPropagation();
        var extra = wrap.querySelector("[data-retry-box] textarea").value.trim();
        retryRevision(thread.id, index, extra);
      });
    } else if (entry.resolution === "accepted") {
      wrap.innerHTML = '<div class="revise-done-label">✓ 已采用 v' + entry.version + '</div>';
    } else if (entry.resolution === "stale") {
      wrap.innerHTML = '<div class="revise-stale">原文已变化，这条引用已失效，无法直接采用。可以重新选中最新文字再聊一次。</div>';
    } else {
      wrap.className += " revise-old-version";
      wrap.innerHTML = '<div class="revise-done-label" style="color:var(--ink-faint)">v' + entry.version + ' · 未采用</div>';
    }
    return wrap;
  }

  /* ───────────────────────── sending & mock AI ───────────────────────── */

  function sendMessage() {
    var input = elem("chatInput");
    var text = input.value.trim();
    if (!text) return;
    var thread = activeThreadOrGeneral();
    if (!state.activeThreadId) state.activeThreadId = thread.id;
    thread.log.push({ type: "user", text: text });
    if (thread.quote) thread.instructions.push(text);
    input.value = "";
    renderThreads();
    scrollThreadIntoView(thread.id);
    saveNow();
    runMockAi(thread, text);
  }

  function runMockAi(thread, userText) {
    typingThreadId = thread.id;
    renderThreads();
    var delay = 650 + Math.random() * 550;
    setTimeout(function () {
      typingThreadId = null;
      if (thread.quote) {
        var block = getBlock(thread.blockId);
        var anchorText = currentAnchorText(thread);
        if (!block || !anchorText || countOccurrences(block.text, anchorText) !== 1) {
          thread.log.push({ type: "system", text: "原文位置已变化，无法直接定位这段了——可以重新选中最新文字。" });
        } else {
          var versionIndex = countRevisions(thread);
          var proposal = reviseText(anchorText, allInstructionsText(thread), versionIndex);
          thread.log.push({ type: "revision", version: versionIndex + 1, original: anchorText, proposal: proposal, resolution: "pending" });
        }
      } else {
        thread.log.push({ type: "ai_chat", text: generalReply(userText) });
      }
      renderThreads();
      scrollThreadIntoView(thread.id);
      scheduleGutter();
      saveNow();
    }, delay);
  }

  function currentAnchorText(thread) {
    // After an accepted revision the anchor moves forward to the new text.
    for (var i = thread.log.length - 1; i >= 0; i--) {
      var e = thread.log[i];
      if (e.type === "revision" && e.resolution === "accepted") return e.proposal;
    }
    return thread.quote;
  }
  function countRevisions(thread) {
    return thread.log.filter(function (e) { return e.type === "revision"; }).length;
  }
  function allInstructionsText(thread) { return thread.instructions.join(" "); }
  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    var count = 0, idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
    return count;
  }

  function acceptRevision(threadId, entryIndex) {
    var thread = getThread(threadId);
    var entry = thread.log[entryIndex];
    if (!entry || entry.resolution !== "pending") return;
    var block = getBlock(thread.blockId);
    var idx = block.text.indexOf(entry.original);
    if (idx < 0 || countOccurrences(block.text, entry.original) !== 1) {
      entry.resolution = "stale";
      renderThreads();
      notify("原文已经变化，这条修改无法自动应用");
      return;
    }
    block.text = block.text.slice(0, idx) + entry.proposal + block.text.slice(idx + entry.original.length);
    entry.resolution = "accepted";
    thread.quote = entry.proposal;
    state.approved = false;
    state.revision++;
    syncBlockDom(thread.blockId);
    flashBlock(thread.blockId);
    thread.log.push({ type: "system", text: "已更新正文 · 定稿修订 r" + state.revision });
    updateHeader();
    renderComposerRef();
    renderThreads();
    scheduleGutter();
    saveNow();
    notify("已采用这版修改");
  }

  function retryRevision(threadId, entryIndex, extraText) {
    var thread = getThread(threadId);
    var entry = thread.log[entryIndex];
    if (!entry || entry.resolution !== "pending") return;
    entry.resolution = "skipped";
    if (extraText) {
      thread.log.push({ type: "user", text: extraText });
      thread.instructions.push(extraText);
    }
    renderThreads();
    scrollThreadIntoView(thread.id);
    scheduleGutter();
    saveNow();
    runMockAi(thread, extraText || "（换一种写法）");
  }

  /* ───────────────────────── mock rewrite generator ───────────────────────── */

  var CONCRETE_BANK = [
    "不这么做，明天我们连水都没有。",
    "再拖下去，下一个趴窝的就是我们自己。",
    "这不是选择，是我们唯一能撑到明天的办法。"
  ];
  var SENSORY_BANK = [
    "风从门缝钻进来，带着铁锈的味道。",
    "远处又传来一声闷响，像是什么东西撑不住了。",
    "指示灯在黑暗里一闪一闪，像是在倒数。",
    "工具台上的零件轻轻晃了一下，又安静下来。"
  ];
  var CONTINUATION_BANK = [
    "灯光又闪了一下，像是随时会彻底熄灭。",
    "远处传来金属碰撞的声音，很快又安静下来。",
    "小七的指示灯转成了暗橙色，没有再说话。",
    "风声小了一些，屋子里只剩下工具碰撞的轻响。",
    "他没有抬头，手指在零件上停了很久。"
  ];

  function trimFiller(text) {
    return text.replace(/其实|说真的|也就是说|那个呢/g, "").replace(/\s+/g, " ").trim() || text;
  }
  function colloquialize(text) {
    var t = text.trim();
    if (t.endsWith("。")) return t.slice(0, -1) + "……";
    return t + "……";
  }
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function reviseText(quote, instructionText, versionIndex) {
    var instr = instructionText || "";
    var variants = [];
    if (/具体|抽象|空泛|讲清楚|说明白/.test(instr)) {
      if (quote.trim() === "我们没有别的选择了。") variants.push("不这么做，明天我们连水都没有。");
      else variants.push(CONCRETE_BANK[(versionIndex + hashStr(quote)) % CONCRETE_BANK.length]);
    }
    if (/短|精简|啰嗦|太长|简洁/.test(instr)) {
      variants.push(trimFiller(quote));
    }
    if (/感觉|情绪|氛围|细节|画面/.test(instr)) {
      variants.push(quote.trim() + " " + SENSORY_BANK[(versionIndex + hashStr(instr)) % SENSORY_BANK.length]);
    }
    if (/台词|说话|口语|像人话|自然/.test(instr)) {
      variants.push(colloquialize(quote));
    }
    // generic fallback, always available so retries never dead-end
    variants.push(trimFiller(quote) + " " + SENSORY_BANK[(versionIndex + 1 + hashStr(quote + instr)) % SENSORY_BANK.length]);
    return variants[versionIndex % variants.length];
  }

  function generalReply(message) {
    if (/动机|为什么.*(做|说|这样)/.test(message)) {
      return "从目前写出来的内容看，特瑞这句更像是说给自己听、给自己一个继续做下去的理由，不完全是说给小七的。你希望这段更偏向说服小七，还是偏向他自己在动摇？";
    }
    if (/调性|风格|基调/.test(message)) {
      return "现在整体偏克制、少废话，情绪靠动作和沉默带出来，不靠大段台词。如果要往更外放的方向改，这一段的停顿和短句可能要先松动一点。";
    }
    if (/小七/.test(message)) {
      return "小七这句提问本身就带着态度——它不是单纯在问流程，更像是在质疑这么做值不值得。保留这种没说透的部分，可能比直接给答案更有张力。";
    }
    if (/特瑞/.test(message)) {
      return "特瑞目前几乎不解释自己的决定，靠动作代替台词。如果想让观众更早理解他的处境，可以在后面的场景里补一两处具体的压力来源，而不是在这句台词里直接讲清楚。";
    }
    if (/怎么样|如何|你觉得/.test(message)) {
      return "这一版的留白和节奏我觉得是对的；如果有顾虑，大概是观众可能需要再多一点信息才能跟上这段的情绪。要不要先挑一句你最不放心的，我们对着改？";
    }
    return "（这是前端模拟回复，没有接入真实模型）记下了——如果想让我针对正文某一句给出具体改写，可以框选那句话再跟我说。";
  }

  /* ───────────────────────── ghost continuation ───────────────────────── */

  function caretAtEndOfLastBlock() {
    var sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount || !sel.anchorNode) return false;
    var lastEl = lastBlockTextEl();
    if (!lastEl) return false;
    var container = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (!container || !container.closest || container.closest(".block-text") !== lastEl) return false;
    var r = document.createRange();
    r.selectNodeContents(lastEl);
    try { r.setEnd(sel.anchorNode, sel.anchorOffset); } catch (e) { return false; }
    return r.toString().length === lastEl.textContent.length;
  }

  function scheduleGhostCheck() {
    removeGhost();
    clearTimeout(ghostIdleTimer);
    var lastEl = lastBlockTextEl();
    if (!lastEl || !lastEl.textContent.trim()) return;
    if (!caretAtEndOfLastBlock()) return;
    ghostIdleTimer = setTimeout(maybeShowGhost, 950);
  }
  function joinWithPunct(base, addition) {
    if (!base) return addition;
    var endsWithPause = /[。！？，、；…\s]$/.test(base);
    return (endsWithPause ? "" : "，") + addition;
  }
  function maybeShowGhost() {
    if (!caretAtEndOfLastBlock()) return;
    if (ghostEl) return;
    var block = lastBlock();
    var preceding = block.text.slice(-60);
    var suggestion = joinWithPunct(block.text, continuationSuggestion(preceding, state.revision + state.blocks.length));
    var lastEl = lastBlockTextEl();
    var section = lastEl.closest(".block");
    ghostEl = document.createElement("div");
    ghostEl.className = "ghost-line" + (section.dataset.kind === "dialogue" ? " dialogue" : "");
    if (section.dataset.kind === "dialogue") ghostEl.style.marginLeft = "32px";
    ghostEl.innerHTML = escapeHTML(suggestion) + '<span class="ghost-tag">Tab 采纳</span>';
    section.insertAdjacentElement("afterend", ghostEl);
  }
  function removeGhost() {
    if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
    ghostEl = null;
  }
  function commitGhost() {
    if (!ghostEl) return;
    var suggestionText = ghostEl.textContent.replace(/Tab 采纳$/, "").trim();
    removeGhost();
    var block = lastBlock();
    block.text += suggestionText;
    syncBlockDom(block.id);
    var lastEl = lastBlockTextEl();
    lastEl.focus();
    var range = document.createRange();
    range.selectNodeContents(lastEl);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    state.approved = false;
    state.revision++;
    updateHeader();
    saveNow();
    scheduleGhostCheck();
  }
  function continuationSuggestion(precedingText, seed) {
    if (/小七/.test(precedingText)) return "小七的指示灯转成了暗橙色，没有再说话。";
    return CONTINUATION_BANK[(hashStr(precedingText) + seed) % CONTINUATION_BANK.length];
  }

  /* ───────────────────────── approve / reset ───────────────────────── */

  function approveCurrent() {
    if (state.approved) { notify("当前稿件已批准"); return; }
    var pending = state.threads.some(threadHasPendingRevision);
    if (pending && !window.confirm("还有 AI 修改没确认采用或忽略，仍然批准当前稿件吗？")) return;
    state.approved = true;
    updateHeader();
    saveNow();
    notify("已批准当前稿件（仅本地演示状态）");
  }
  function resetDemo() {
    if (!window.confirm("将清除当前浏览器里保存的 Demo 编辑与共写记录，确认重置吗？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = initialState();
    typingThreadId = null; pendingSelection = null;
    removeGhost();
    renderAll();
    saveNow();
    notify("已恢复初始示例");
  }

  function renderAll() {
    renderDoc();
    updateHeader();
    renderComposerRef();
    renderThreads();
  }

  /* ───────────────────────── wiring ───────────────────────── */

  elem("askAiBtn").addEventListener("click", openChatWithSelection);
  elem("sendBtn").addEventListener("click", sendMessage);
  elem("chatInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  elem("clearRef").addEventListener("click", function () { state.activeThreadId = null; renderComposerRef(); renderThreads(); });
  elem("switchGeneral").addEventListener("click", function () { state.activeThreadId = null; renderComposerRef(); renderThreads(); elem("chatInput").focus(); });
  elem("toggleChat").addEventListener("click", function () {
    if (layout.classList.contains("chat-collapsed")) openChatPanel();
    else closeChatPanel();
  });
  elem("collapseChat").addEventListener("click", closeChatPanel);
  elem("reopenChat").addEventListener("click", openChatPanel);
  elem("approveBtn").addEventListener("click", approveCurrent);
  elem("resetDemo").addEventListener("click", resetDemo);

  document.addEventListener("pointerdown", function (event) {
    if (selectBubble.hidden) return;
    if (event.target.closest("#selectBubble")) return;
    if (event.target.closest(".block-text")) return;
    selectBubble.hidden = true;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") selectBubble.hidden = true;
  });
  elem("canvasScroll").addEventListener("scroll", scheduleGutter, { passive: true });

  renderAll();
  saveNow();
})();
