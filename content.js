(() => {
  const ROOT_ID = "cgj-root";
  const OPEN_CLASS = "cgj-open";
  const HIGHLIGHT_CLASS = "cgj-highlight";
  const PREVIEW_LIMIT = 72;
  const TOGGLE_IMAGE_SRC = chrome.runtime.getURL("assets/kunkun.jpg");

  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const state = {
    entries: [],
    entriesByKey: new Map(),
    open: false,
    activeKey: null,
    refreshTimer: null,
    locationKey: getLocationKey(),
    nextOrder: 1
  };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <button class="cgj-toggle" type="button" aria-expanded="false" aria-label="Open your ChatGPT messages">
      <img class="cgj-toggle-avatar" src="${TOGGLE_IMAGE_SRC}" alt="" aria-hidden="true">
      <span class="cgj-count">0</span>
    </button>
    <section class="cgj-panel" aria-label="Your ChatGPT messages">
      <header class="cgj-header">
        <div>
          <strong>My Messages</strong>
          <span class="cgj-subtitle">Click to jump</span>
        </div>
        <button class="cgj-refresh" type="button" aria-label="Refresh message list">Refresh</button>
      </header>
      <div class="cgj-list" role="list"></div>
      <div class="cgj-empty">No messages found yet.</div>
    </section>
  `;

  document.documentElement.appendChild(root);

  const toggleButton = root.querySelector(".cgj-toggle");
  const countBadge = root.querySelector(".cgj-count");
  const panel = root.querySelector(".cgj-panel");
  const refreshButton = root.querySelector(".cgj-refresh");
  const list = root.querySelector(".cgj-list");
  const empty = root.querySelector(".cgj-empty");

  toggleButton.addEventListener("click", () => {
    setOpen(!state.open);
    collectEntries();
  });

  refreshButton.addEventListener("click", () => {
    collectEntries();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      setOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (state.open && !root.contains(event.target)) {
      setOpen(false);
    }
  });

  const observer = new MutationObserver(() => {
    queueRefresh();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.addEventListener("scroll", () => {
    queueRefresh(90);
  }, true);

  window.addEventListener("popstate", () => {
    queueRefresh(80);
  });

  window.addEventListener("hashchange", () => {
    queueRefresh(80);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      queueRefresh(80);
    }
  });

  collectEntries();

  function setOpen(open) {
    state.open = open;
    root.classList.toggle(OPEN_CLASS, open);
    toggleButton.setAttribute("aria-expanded", String(open));

    if (open) {
      panel.scrollTop = 0;
      renderList();
    } else {
      list.replaceChildren();
    }
  }

  function queueRefresh(delay = 180) {
    syncLocation();
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      collectEntries();
    }, delay);
  }

  function syncLocation() {
    const nextLocationKey = getLocationKey();

    if (state.locationKey === nextLocationKey) {
      return false;
    }

    state.locationKey = nextLocationKey;
    clearEntries();
    return true;
  }

  function clearEntries() {
    state.entries = [];
    state.entriesByKey.clear();
    state.activeKey = null;
    countBadge.textContent = String(state.entries.length);

    if (state.open) {
      renderList();
    } else {
      list.replaceChildren();
    }
  }

  function collectEntries() {
    syncLocation();
    const foundEntries = findUserMessageEntries();

    foundEntries.forEach((entry) => {
      const existing = state.entriesByKey.get(entry.key);

      if (existing) {
        existing.element = entry.element;
        existing.scroller = entry.scroller;
        existing.scrollTop = entry.scrollTop;
        existing.text = entry.text;
        existing.preview = entry.preview;
        existing.lastSeenAt = Date.now();
        return;
      }

      state.entriesByKey.set(entry.key, {
        ...entry,
        discoveredAt: state.nextOrder++,
        lastSeenAt: Date.now()
      });
    });

    releaseDisconnectedReferences();
    state.entries = Array.from(state.entriesByKey.values()).sort(compareEntries);
    countBadge.textContent = String(state.entries.length);

    if (state.open) {
      renderList();
    }
  }

  function releaseDisconnectedReferences() {
    state.entriesByKey.forEach((entry) => {
      if (entry.element && !entry.element.isConnected) {
        entry.element = null;
      }

      if (entry.scroller && !entry.scroller.isConnected) {
        entry.scroller = null;
      }
    });
  }

  function findUserMessageEntries() {
    const byKey = new Map();
    const main = document.querySelector("main") || document.body;
    const candidateNodes = collectCandidateNodes(main);

    candidateNodes.forEach((node) => {
      const messageNode = getMessageNode(node);
      const scrollTarget = getScrollTarget(node);
      const primaryContent = getMessageContent(messageNode || node);
      const fallbackContent = messageNode && messageNode !== node ? getMessageContent(node) : null;
      const content = chooseBetterContent(primaryContent, fallbackContent);

      if (!scrollTarget || !content) {
        return;
      }

      const position = getScrollPosition(scrollTarget);
      const key = getEntryKey(messageNode || node, scrollTarget, content.keySource, position.top);

      if (!key) {
        return;
      }

      const nextEntry = {
        key,
        element: scrollTarget,
        scroller: position.scroller,
        scrollTop: position.top,
        text: content.title,
        preview: truncateText(content.preview, PREVIEW_LIMIT)
      };
      const existingEntry = byKey.get(key);

      if (!existingEntry || nextEntry.text.length > existingEntry.text.length) {
        byKey.set(key, nextEntry);
      }
    });

    return Array.from(byKey.values()).sort(compareEntries);
  }

  function collectCandidateNodes(rootNode) {
    const nodes = new Set();

    rootNode.querySelectorAll('[data-message-author-role="user"]').forEach((node) => {
      nodes.add(node);
    });

    rootNode.querySelectorAll('[data-testid^="conversation-turn-"], article, [role="article"]').forEach((node) => {
      if (isUserTurn(node)) {
        nodes.add(node);
      }
    });

    return Array.from(nodes);
  }

  function isUserTurn(node) {
    if (node.matches?.('[data-message-author-role="user"]')) {
      return true;
    }

    const authorNode = node.querySelector?.("[data-message-author-role]");
    if (authorNode?.getAttribute("data-message-author-role") === "user") {
      return true;
    }

    const labelText = [
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("data-testid"),
      ...Array.from(node.querySelectorAll?.(".sr-only, [class*='sr-only']") || []).map((item) => item.textContent)
    ].filter(Boolean).join(" ");

    return /\b(you said|you asked|you wrote|you sent)\b/i.test(labelText);
  }

  function getMessageNode(node) {
    if (node.matches?.('[data-message-author-role="user"]')) {
      return node;
    }

    return node.querySelector?.('[data-message-author-role="user"]') || node;
  }

  function compareEntries(a, b) {
    if (a.element?.isConnected && b.element?.isConnected && a.element !== b.element) {
      const position = a.element.compareDocumentPosition(b.element);

      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }

      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
    }

    if (a.scroller === b.scroller && Number.isFinite(a.scrollTop) && Number.isFinite(b.scrollTop)) {
      const delta = a.scrollTop - b.scrollTop;
      if (Math.abs(delta) > 4) {
        return delta;
      }
    }

    return (a.discoveredAt || 0) - (b.discoveredAt || 0);
  }

  function getEntryKey(messageNode, scrollTarget, keySource, fallbackTop) {
    const idNode = messageNode.closest?.("[data-message-id]") || scrollTarget.querySelector?.("[data-message-id]");
    const messageId = idNode?.getAttribute("data-message-id");

    if (messageId) {
      return `message:${messageId}`;
    }

    const testId = scrollTarget.getAttribute?.("data-testid");

    if (testId && testId.startsWith("conversation-turn-")) {
      return `turn:${testId}`;
    }

    return `content:${hashText(`${keySource}|${Math.round(fallbackTop || 0)}`)}`;
  }

  function getLocationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function getScrollPosition(element) {
    const scroller = getScrollParent(element);
    const rect = element.getBoundingClientRect();

    if (isWindowScroller(scroller)) {
      return {
        scroller: null,
        top: window.scrollY + rect.top
      };
    }

    const scrollerRect = scroller.getBoundingClientRect();

    return {
      scroller,
      top: scroller.scrollTop + rect.top - scrollerRect.top
    };
  }

  function getScrollParent(element) {
    let node = element.parentElement;

    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const canScroll = /(auto|scroll|overlay)/.test(`${style.overflowY}${style.overflow}`);

      if (canScroll && node.scrollHeight > node.clientHeight + 8) {
        return node;
      }

      node = node.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function isWindowScroller(scroller) {
    return !scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
  }

  function hashText(text) {
    let hash = 5381;

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 33) ^ text.charCodeAt(index);
    }

    return (hash >>> 0).toString(36);
  }

  function findConnectedEntry(entry) {
    if (entry.element?.isConnected) {
      return entry;
    }

    const currentEntry = findUserMessageEntries().find((item) => item.key === entry.key);

    if (!currentEntry) {
      return entry;
    }

    const storedEntry = state.entriesByKey.get(entry.key);

    if (storedEntry) {
      storedEntry.element = currentEntry.element;
      storedEntry.scroller = currentEntry.scroller;
      storedEntry.scrollTop = currentEntry.scrollTop;
      return storedEntry;
    }

    return currentEntry;
  }

  function scrollToStoredPosition(entry) {
    const offset = 120;
    const top = Math.max(0, entry.scrollTop - offset);

    if (entry.scroller?.isConnected && !isWindowScroller(entry.scroller)) {
      entry.scroller.scrollTo({
        top,
        behavior: "smooth"
      });
      return;
    }

    window.scrollTo({
      top,
      behavior: "smooth"
    });
  }

  function scrollAndHighlight(entry) {
    if (entry.element?.isConnected) {
      entry.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      highlight(entry.element);
      return;
    }

    scrollToStoredPosition(entry);

    setTimeout(() => {
      collectEntries();
      const latestEntry = state.entriesByKey.get(entry.key);

      if (latestEntry?.element?.isConnected) {
        highlight(latestEntry.element);
      }
    }, 650);
  }

  function getScrollTarget(node) {
    return node.closest('[data-testid^="conversation-turn-"], article, [role="article"]') || node;
  }

  function getReadableText(node) {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, svg, textarea, [aria-hidden='true'], .sr-only").forEach((item) => {
      item.remove();
    });

    return normalizeText(clone.textContent || "");
  }

  function getMessageContent(node) {
    if (!node) {
      return null;
    }

    const text = getReadableText(node);
    const media = getMediaSummary(node);

    if (text && media.preview) {
      return {
        title: `${text}\n${media.title}`,
        preview: `${text} ${media.preview}`,
        keySource: `${text}|${media.signature}`
      };
    }

    if (text) {
      return {
        title: text,
        preview: text,
        keySource: text
      };
    }

    if (media.preview) {
      return {
        title: media.title,
        preview: media.preview,
        keySource: media.signature
      };
    }

    return null;
  }

  function chooseBetterContent(primaryContent, fallbackContent) {
    if (!primaryContent) {
      return fallbackContent;
    }

    if (!fallbackContent) {
      return primaryContent;
    }

    return fallbackContent.title.length > primaryContent.title.length ? fallbackContent : primaryContent;
  }

  function getMediaSummary(node) {
    const images = Array.from(node.querySelectorAll("img, picture, canvas, video"))
      .filter(isContentMedia);
    const backgroundImages = Array.from(node.querySelectorAll("[style*='background-image']"))
      .filter(isVisibleElement);
    const attachmentLabels = getAttachmentLabels(node);
    const imageCount = images.length + backgroundImages.length;
    const parts = [];

    if (imageCount === 1) {
      parts.push("Image message");
    } else if (imageCount > 1) {
      parts.push(`${imageCount} images`);
    }

    if (attachmentLabels.length === 1) {
      parts.push(`Attachment: ${attachmentLabels[0]}`);
    } else if (attachmentLabels.length > 1) {
      parts.push(`${attachmentLabels.length} attachments`);
    }

    if (!parts.length) {
      return {
        preview: "",
        title: "",
        signature: ""
      };
    }

    const imageSignature = images
      .map((item, index) => {
        const src = item.currentSrc || item.src || "";
        const label = item.getAttribute("alt") || item.getAttribute("aria-label") || item.getAttribute("title") || "";
        const size = `${item.naturalWidth || item.width || 0}x${item.naturalHeight || item.height || 0}`;

        return `${item.tagName}:${index}:${label}:${size}:${hashText(src)}`;
      })
      .join("|");
    const backgroundSignature = backgroundImages
      .map((item, index) => `${index}:${hashText(item.getAttribute("style") || "")}`)
      .join("|");
    const signature = `media:${parts.join("|")}:${attachmentLabels.join("|")}:${imageSignature}:${backgroundSignature}`;

    return {
      preview: parts.join(" · "),
      title: parts.join("\n"),
      signature
    };
  }

  function isContentMedia(element) {
    if (!isVisibleElement(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width >= 24 && rect.height >= 24;
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function getAttachmentLabels(node) {
    const labels = new Set();
    const selectors = [
      "a[href]",
      "[aria-label*='file' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='uploaded' i]",
      "[title*='file' i]",
      "[title*='attachment' i]",
      "[data-testid*='file' i]",
      "[data-testid*='attachment' i]"
    ];

    node.querySelectorAll(selectors.join(",")).forEach((item) => {
      const label = normalizeText(
        item.getAttribute("aria-label") ||
        item.getAttribute("title") ||
        item.textContent ||
        ""
      );

      if (label && label.length <= 120) {
        labels.add(label);
      }
    });

    return Array.from(labels).slice(0, 3);
  }

  function normalizeText(text) {
    return text
      .replace(/\s+/g, " ")
      .replace(/\u200b/g, "")
      .trim();
  }

  function truncateText(text, limit) {
    if (text.length <= limit) {
      return text;
    }

    return `${text.slice(0, limit).trim()}...`;
  }

  function renderList() {
    list.replaceChildren();
    empty.hidden = state.entries.length > 0;
    list.hidden = state.entries.length === 0;

    state.entries.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cgj-item";
      item.setAttribute("role", "listitem");
      item.title = entry.text;

      if (entry.key === state.activeKey) {
        item.classList.add("cgj-active");
      }

      const number = document.createElement("span");
      number.className = "cgj-index";
      number.textContent = String(index + 1);

      const preview = document.createElement("span");
      preview.className = "cgj-preview";
      preview.textContent = entry.preview;

      item.append(number, preview);
      item.addEventListener("click", () => {
        jumpToEntry(entry.key);
      });

      list.appendChild(item);
    });
  }

  function jumpToEntry(key) {
    const entry = state.entriesByKey.get(key);
    if (!entry) {
      return;
    }

    const latestEntry = findConnectedEntry(entry);
    state.activeKey = key;
    renderList();
    scrollAndHighlight(latestEntry);
  }

  function highlight(element) {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((item) => {
      item.classList.remove(HIGHLIGHT_CLASS);
    });

    element.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => {
      element.classList.remove(HIGHLIGHT_CLASS);
    }, 1600);
  }
})();
