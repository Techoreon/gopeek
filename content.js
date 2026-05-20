

// ==========================================
// 1. IFRAME CONTEXT (Inside the mini-browser)
// ==========================================
if (window !== window.top && window.name.startsWith('gopeak-frame')) {

  const antiBuster = document.createElement('style');
  antiBuster.textContent = `
    html, body { display: block !important; visibility: visible !important; opacity: 1 !important; overscroll-behavior: none !important; }
  `;
  if (document.documentElement) document.documentElement.appendChild(antiBuster);

  const scrollBlocker = document.createElement('style');
  scrollBlocker.id = 'gopeak-scroll-blocker';
  scrollBlocker.textContent = `::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }`;
  if (document.documentElement) document.documentElement.appendChild(scrollBlocker);

  chrome.storage.local.get({ hp_scroll: false }, (data) => {
    if (data.hp_scroll) {
      const blocker = document.getElementById('gopeak-scroll-blocker');
      if (blocker) blocker.remove();
    }
  });

  // SECURITY FIX: Extract precise Frame ID and Parent Origin from the window name
  const nameParts = window.name.split('|');
  const frameId = nameParts[0];
  const parentOrigin = (nameParts[1] && nameParts[1] !== 'null') ? nameParts[1] : '*';

  // SECURITY FIX: Centralized, strictly-targeted postMessage wrapper
  function securePostToParent(payload) {
    payload.id = frameId;
    window.parent.postMessage(payload, parentOrigin);
  }

  let lastScroll = 0;
  let scrollRaf = null;
  window.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      let current = window.scrollY;
      if (current > lastScroll && current > 50) securePostToParent({ gopeak: 'hideHeader' });
      else securePostToParent({ gopeak: 'showHeader' });
      lastScroll = current;
      scrollRaf = null;
    });
  }, { passive: true });

  window.addEventListener('message', (event) => {
    // SECURITY FIX: Reject messages from unauthorized origins or fake window sources
    if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    if (event.source !== window.parent) return;
    if (!event.data || !event.data.gopeak) return;

    if (event.data.gopeak === 'goBack') window.history.back();
    if (event.data.gopeak === 'goForward') window.history.forward();
  });

  function getThemeColor() {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && metaTheme.content) return metaTheme.content;
    return getPageBg();
  }

  function getPageBg() {
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') return bodyBg;
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg && htmlBg !== 'rgba(0, 0, 0, 0)' && htmlBg !== 'transparent') return htmlBg;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '#121212' : '#ffffff';
  }

  function isColorDark(colorStr) {
    if (!document.body) return false;
    const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
      return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
    }
    if (colorStr.startsWith('#')) {
      const hex = colorStr.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
      return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
    }
    return false;
  }
  function reportState() {
    if (!document.body) return;
    const color = getThemeColor();
    securePostToParent({
      gopeak: 'themeAndUrl',
      color: color, pageBg: getPageBg(), isDark: isColorDark(color), url: window.location.href
    });
  }

  let observerThrottle = null;

  const observer = new MutationObserver((mutations) => {
    let needsUpdate = false;
    for (let m of mutations) {
      if (m.target.nodeName === 'TITLE' || m.target.nodeName === 'META') {
          needsUpdate = true;
          break; // Stop looping once we find what we need
      }
    }
    
    // Batch the postMessage calls
    if (needsUpdate) {
        clearTimeout(observerThrottle);
        observerThrottle = setTimeout(reportState, 150);
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    reportState();
    if (document.head) observer.observe(document.head, { childList: true, subtree: true, attributes: true });
  });
  window.addEventListener('load', reportState);
}

// ==========================================
// 2. MAIN WINDOW CONTEXT (The Host OS)
// ==========================================
else if (window === window.top) {

  function initGoPeak() {
    if (window.gopeakInitialized) return;
    window.gopeakInitialized = true;

    let settings = {
      hp_width: 768, hp_height: 529, hp_autohide: false, hp_theme: false,
      hp_ghost: false, hp_multipeak: false,
      hp_search: false, hp_modifier: 'Shift', hp_sidebar_mode: 'split', hp_bubble_trigger: 'dblclick_head',
      hp_allow_bubble: true, hp_scroll: false
    };

    chrome.storage.local.get(settings, (data) => { settings = data; });
    chrome.storage.onChanged.addListener((changes) => {
      for (let key in changes) settings[key] = changes[key].newValue;
    });

    let activeWindows = [];
    let intentTimer = null;
    let activeHoverLink = null;

    function prefetchUrl(url) {
      if (document.querySelector(`link[rel="prefetch"][href="${url}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'prefetch'; link.href = url; link.as = 'document';
      document.head.appendChild(link);
      setTimeout(() => { if (link.parentNode) link.remove(); }, 5000);
    }

    function checkModifier(e) {
      if (settings.hp_modifier === 'Shift') return e.shiftKey;
      if (settings.hp_modifier === 'Alt') return e.altKey;
      if (settings.hp_modifier === 'Ctrl') return e.ctrlKey || e.metaKey;
      return false;
    }

    class GoPeakWindow {
      constructor() {
        this.id = 'gopeak-frame-' + Date.now() + Math.floor(Math.random() * 1000);
        const hostOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
        this.frameName = this.id + '|' + hostOrigin;

        this.url = '';
        this.isPinned = false;
        this.isMinimized = false;
        this.isSnapped = false;
        this.snappedSide = null;
        this.isAnimatingSize = false;
        this.isVisible = false;

        this.floatingRect = {};
        this.sidebarWidth = 400;

        this.wasSnappedBeforeMinimize = false;
        this.snappedSideBeforeMinimize = null;
        this.bubbleMovedWhileMinimized = false;

        this.host = document.createElement('div');
        this.host.className = 'gopeak-host';
        document.body.appendChild(this.host);
        this.shadow = this.host.attachShadow({ mode: 'open' });

        this.shadow.innerHTML = `
          <style>
            #mini-browser {
              position: fixed; z-index: 2147483647; background: #ffffff;
              border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.1);
              font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column;
              overflow: hidden; opacity: 0; 
              transform: translate3d(0, 15px, 0) scale(0.95);
              transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.3s; 
              pointer-events: none; overscroll-behavior: none; resize: both;
              min-width: 320px; min-height: 250px; 
              will-change: transform, opacity, width, height, left, top;
              contain: strict; 
              backface-visibility: hidden;
              perspective: 1000px;
            }
            #mini-browser.visible { opacity: 1; transform: translate3d(0, 0, 0) scale(1); pointer-events: auto; }
            #mini-browser.ghost { opacity: 0.3 !important; transition: opacity 0.4s ease; }
            #mini-browser:hover { opacity: 1 !important; }
            
            #mini-browser.animating-size {
              transition: opacity 0.2s ease-out, transform 0.2s ease-out, border-radius 0.3s, width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1), left 0.2s cubic-bezier(0.4, 0, 0.2, 1), top 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            #mini-browser.dragging { transition: none !important; }

            .resize-handle {
              position: absolute; top: 0; bottom: 0; width: 8px; z-index: 100;
              background: transparent; cursor: ew-resize; display: none; transition: background 0.2s;
            }
            .resize-handle:hover { background: rgba(0, 122, 255, 0.4); }
            #mini-browser.snapped-right .resize-handle { left: 0; display: block; }
            #mini-browser.snapped-left .resize-handle { right: 0; display: block; }

            #mini-browser.minimized {
              width: 56px !important; height: 56px !important; min-width: 56px !important; min-height: 56px !important;
              border-radius: 28px !important; resize: none !important; cursor: pointer; padding: 0 !important;
              box-shadow: 0 10px 20px rgba(0,0,0,0.3);
            }
            #mini-browser.minimized #header, #mini-browser.minimized #iframe-container { display: none !important; }
            
            #bubble-icon { 
              display: none; width: 100%; height: 100%; background-color: #fff; border-radius: 50%;
              justify-content: center; align-items: center; overflow: hidden; border: 2px solid #e9e9e9; box-sizing: border-box;
            }
            #bubble-icon img { width: 60%; height: 60%; object-fit: contain; pointer-events: none;}
            #mini-browser.minimized #bubble-icon { display: flex !important; }

            #header {
              height: 38px; background: var(--header-bg, #f5f5f5); display: flex; align-items: center;
              padding: 0 12px; cursor: grab; transition: margin-top 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s;
            }
            #header:active { cursor: grabbing; }
            #mini-browser.header-hidden #header { margin-top: -38px; }

            .traffic-lights { display: flex; gap: 8px; margin-right: 12px; padding: 5px; cursor: default; }
            .light { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; transition: 0.1s; position: relative;}
            .close { background: #ff5f56; } .close:hover { transform: scale(1.1); }
            .expand { background: #28c940; } .expand:hover { transform: scale(1.1); }
            .pin { background: #d1d1d6; } .pin:hover { transform: scale(1.1); }
            .pin::after { content: ''; position: absolute; top:3px; left:3px; width:6px; height:6px; background: rgba(0,0,0,0.4); border-radius:50%; opacity: 0; }
            #mini-browser.pinned .pin { background: #ffbd2e; }
            #mini-browser.pinned .pin::after { opacity: 1; }

            .nav-btns { display: flex; gap: 4px; margin-right: 10px; color: var(--url-color, #444); }
            .nav-btn { width: 16px; height: 16px; padding: 4px; border-radius: 4px; cursor: pointer; opacity: 0.6; transition: 0.15s; }
            .nav-btn:hover { background: rgba(128, 128, 128, 0.2); opacity: 1; }

            #url-bar { 
              flex-grow: 1; background: var(--url-bg, #e9e9e9); color: var(--url-color, #444); 
              padding: 4px 12px; border-radius: 6px; font-size: 12px; text-align: center; 
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: none; transition: 0.4s;
            }
            
            #iframe-container { flex-grow: 1; background: var(--iframe-bg, #ffffff); position: relative; overscroll-behavior: none; }
            iframe { width: 100%; height: 100%; border: none; background: transparent; }
            #drag-overlay { position: absolute; inset: 0; z-index: 10; display: none; background: transparent; }
          </style>
          <div id="mini-browser">
            <div id="bubble-icon"><img src="" /></div>
            <div id="header">
              <div class="traffic-lights">
                <div class="light close" title="Close"></div>
                <div class="light expand" title="Open in Tab"></div>
                <div class="light pin" title="Pin Window"></div>
              </div>
              <div class="nav-btns">
                <svg class="nav-btn back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <svg class="nav-btn forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </div>
              <div id="url-bar">Loading...</div>
            </div>
            <div id="iframe-container">
              <div class="resize-handle"></div>
              <div id="drag-overlay"></div>
              <iframe id="content-frame" name="${this.id}"></iframe>
            </div>
          </div>
        `;

        this.browser = this.shadow.querySelector('#mini-browser');
        this.iframe = this.shadow.querySelector('#content-frame');
        this.header = this.shadow.querySelector('#header');
        this.urlBar = this.shadow.querySelector('#url-bar');
        this.overlay = this.shadow.querySelector('#drag-overlay');
        this.bubble = this.shadow.querySelector('#bubble-icon');
        this.bubbleImg = this.bubble.querySelector('img');
        this.resizeHandle = this.shadow.querySelector('.resize-handle');

        this.isDragging = false;
        this.isDraggingMotion = false;
        this.isResizingEdge = false;

        this.setupListeners();
      }

      securePostToIframe(payload) {
        if (!this.iframe || !this.iframe.contentWindow) return;
        let targetOrigin = '*';
        try {
          const parsedUrl = new URL(this.url);
          if (parsedUrl.origin !== 'null') targetOrigin = parsedUrl.origin;
        } catch (e) { }
        this.iframe.contentWindow.postMessage(payload, targetOrigin);
      }

      replaceIframe(newUrl) {
        if (newUrl.startsWith('http://')) newUrl = newUrl.replace(/^http:\/\//i, 'https://');

        const freshIframe = document.createElement('iframe');
        freshIframe.id = 'content-frame';
        freshIframe.name = this.frameName; 
        freshIframe.src = newUrl;

        this.iframe.replaceWith(freshIframe);
        this.iframe = freshIframe;
      }

      preload(url, mouseX, mouseY) {
        if (this.url === url && this.isVisible && !this.isClosing) return;

        const wasVisible = this.isVisible;
        this.url = url;
        try { this.urlBar.textContent = new URL(url).hostname; } catch { this.urlBar.textContent = url; }

        if (!wasVisible) {
          this.header.style.removeProperty('--header-bg');
          this.header.style.removeProperty('--url-bg');
          this.header.style.removeProperty('--url-color');
          this.browser.style.removeProperty('--iframe-bg');
        }

        if (!this.isPinned && !this.isSnapped) {
          let w = settings.hp_width; let h = settings.hp_height;
          let top = mouseY + 20; let left = mouseX + 20;
          if (left + w > window.innerWidth) left = window.innerWidth - w - 20;
          if (top + h > window.innerHeight) top = window.innerHeight - h - 20;

          this.browser.style.width = w + 'px';
          this.browser.style.height = h + 'px';
          this.browser.style.top = top + 'px';
          this.browser.style.left = left + 'px';

          this.floatingRect = { w: w + 'px', h: h + 'px', t: top + 'px', l: left + 'px' };
        }

        this.replaceIframe(url);

        if (!wasVisible) {
          this.browser.classList.remove('visible');
          this.isVisible = false;
        }

        if (this.isMinimized) this.toggleMinimize();
      }

      show() {
        this.browser.classList.add('visible');
        this.isVisible = true;
        this.isClosing = false;
      }

      cancelPreload() {
        if (!this.isVisible && !this.isPinned) {
          this.iframe.src = 'about:blank';
          this.url = '';
        }
      }

      toggleMinimize() {
        if (!settings.hp_allow_bubble) return;

        this.isDragging = false;
        this.overlay.style.display = 'none';

        this.isAnimatingSize = true;
        this.browser.classList.add('animating-size');
        setTimeout(() => {
          this.browser.classList.remove('animating-size');
          this.isAnimatingSize = false;
        }, 300);

        this.isMinimized = !this.isMinimized;

        if (this.isMinimized) {
          this.isPinned = true;
          this.browser.classList.add('pinned');
          this.bubbleMovedWhileMinimized = false;

          if (this.isSnapped) {
            this.wasSnappedBeforeMinimize = true;
            this.snappedSideBeforeMinimize = this.snappedSide;
            this.unsnap();
          } else {
            this.wasSnappedBeforeMinimize = false;
            this.snappedSideBeforeMinimize = null;
          }

          this.browser.classList.add('minimized');
          try { this.bubbleImg.src = `https://www.google.com/s2/favicons?sz=64&domain=${new URL(this.url).hostname}`; } catch (e) { }

        } else {
          this.browser.classList.remove('minimized');

          if (this.wasSnappedBeforeMinimize && !this.bubbleMovedWhileMinimized) {
            this.snap(this.snappedSideBeforeMinimize);
          } else {
            let w = parseInt(this.floatingRect.w) || settings.hp_width;
            let h = parseInt(this.floatingRect.h) || settings.hp_height;
            let t = parseInt(this.browser.style.top) || 20;
            let l = parseInt(this.browser.style.left) || 20;

            if (l + w > window.innerWidth) l = window.innerWidth - w - 20;
            if (t + h > window.innerHeight) t = window.innerHeight - h - 20;
            if (l < 0) l = 20;
            if (t < 0) t = 20;

            this.browser.style.top = t + 'px';
            this.browser.style.left = l + 'px';
            this.browser.style.width = w + 'px';
            this.browser.style.height = h + 'px';
          }

          this.wasSnappedBeforeMinimize = false;
          this.snappedSideBeforeMinimize = null;
          this.bubbleMovedWhileMinimized = false;
        }
      }

      snap(side) {
        if (!this.isSnapped) {
          this.floatingRect = { w: this.browser.style.width, h: this.browser.style.height, t: this.browser.style.top, l: this.browser.style.left };
        }

        this.isPinned = true;
        this.browser.classList.add('pinned');

        this.isSnapped = true;
        this.snappedSide = side;
        this.browser.classList.remove('snapped-left', 'snapped-right');
        this.browser.classList.add('snapped-' + side);

        this.browser.style.resize = 'none';
        this.browser.style.top = '0px';
        this.browser.style.height = '100vh';
        this.browser.style.width = this.sidebarWidth + 'px';
        this.browser.style.borderRadius = '0px';
        this.browser.style.left = side === 'left' ? '0px' : (window.innerWidth - this.sidebarWidth) + 'px';

        if (settings.hp_sidebar_mode === 'split') {
          document.documentElement.style.transition = 'padding 0.3s ease';
          if (side === 'right') {
            document.documentElement.style.paddingRight = this.sidebarWidth + 'px';
            document.documentElement.style.paddingLeft = '';
          }
          if (side === 'left') {
            document.documentElement.style.paddingLeft = this.sidebarWidth + 'px';
            document.documentElement.style.paddingRight = '';
          }
        }
      }

      unsnap() {
        if (!this.isSnapped) return;
        this.isSnapped = false;
        this.browser.classList.remove('snapped-left', 'snapped-right');
        this.browser.style.resize = 'both';
        this.browser.style.borderRadius = '12px';

        this.browser.style.width = this.floatingRect.w;
        this.browser.style.height = this.floatingRect.h;

        if (settings.hp_sidebar_mode === 'split') {
          document.documentElement.style.transition = 'padding 0.3s ease';
          document.documentElement.style.paddingRight = '';
          document.documentElement.style.paddingLeft = '';
        }
      }

      close() {
        this.isClosing = true;
        this.isVisible = false;
        this.browser.classList.remove('dragging'); 

        if (this.isSnapped && settings.hp_sidebar_mode === 'split') {
          document.documentElement.style.transition = 'padding 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
          document.documentElement.style.paddingRight = '';
          document.documentElement.style.paddingLeft = '';
        }

        this.browser.classList.remove('visible'); 
        
        setTimeout(() => {
          if (this.iframe) this.iframe.src = 'about:blank';
          if (this.host && this.host.parentNode) this.host.remove();
          activeWindows = activeWindows.filter(w => w !== this);
          
          // SECURITY FIX: If no more previews are open, dynamically raise the shields again!
          if (activeWindows.length === 0) {
              chrome.runtime.sendMessage({ action: "disable_bypass" });
          }
        }, 250);
      }

      setupListeners() {
        this.shadow.querySelector('.close').addEventListener('click', () => this.close());
        this.shadow.querySelector('.expand').addEventListener('click', () => { window.open(this.url, '_blank'); this.close(); });
        this.shadow.querySelector('.pin').addEventListener('click', () => {
          this.isPinned = !this.isPinned;
          this.browser.classList.toggle('pinned', this.isPinned);
          if (settings.hp_ghost && this.isPinned) this.browser.classList.add('ghost');
          else this.browser.classList.remove('ghost');
        });

        this.shadow.querySelector('.back').addEventListener('click', () => this.securePostToIframe({ gopeak: 'goBack' }));
        this.shadow.querySelector('.forward').addEventListener('click', () => this.securePostToIframe({ gopeak: 'goForward' }));

        this.bubble.addEventListener('click', () => {
          if (!this.isDraggingMotion) this.toggleMinimize();
        });

        this.header.addEventListener('dblclick', (e) => {
          if (settings.hp_bubble_trigger === 'dblclick_head' && !e.target.closest('.traffic-lights')) {
            this.isDragging = false; this.overlay.style.display = 'none';
            this.toggleMinimize();
          }
        });

        this.browser.addEventListener('mouseenter', () => { if (this.isPinned && settings.hp_ghost) this.browser.classList.remove('ghost'); });
        this.browser.addEventListener('mouseleave', () => { if (this.isPinned && settings.hp_ghost && !this.isMinimized) this.browser.classList.add('ghost'); });

        new ResizeObserver(() => {
          if (!this.isVisible || this.isMinimized || this.isSnapped || this.isAnimatingSize) return;
          this.floatingRect.w = this.browser.style.width;
          this.floatingRect.h = this.browser.style.height;
          chrome.storage.local.set({ hp_width: this.browser.offsetWidth, hp_height: this.browser.offsetHeight });
        }).observe(this.browser);

        let startX, startY, offsetX, offsetY;
        let resizeStartX, startWidth;
        let rafId = null;

        const startDrag = (e) => {
          if (e.target.closest('.traffic-lights') || e.target.closest('.nav-btns')) return;
          e.preventDefault();

          this.browser.classList.add('dragging');
          this.isDragging = true; this.isDraggingMotion = false;
          startX = e.clientX; startY = e.clientY;
          offsetX = e.clientX - this.browser.getBoundingClientRect().left;
          offsetY = e.clientY - this.browser.getBoundingClientRect().top;
          this.overlay.style.display = 'block';
        };

        this.header.addEventListener('mousedown', startDrag);
        this.bubble.addEventListener('mousedown', startDrag);

        this.resizeHandle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.isResizingEdge = true;
          this.browser.classList.add('dragging');
          this.overlay.style.display = 'block';
          resizeStartX = e.clientX; startWidth = this.browser.offsetWidth;
        });

        document.addEventListener('mousemove', (e) => {
          if (this.isResizingEdge) {
            if (!rafId) {
              rafId = requestAnimationFrame(() => {
                let newWidth = startWidth;
                if (this.snappedSide === 'right') newWidth = startWidth - (e.clientX - resizeStartX);
                if (this.snappedSide === 'left') newWidth = startWidth + (e.clientX - resizeStartX);
                if (newWidth < 250) newWidth = 250;
                if (newWidth > window.innerWidth - 100) newWidth = window.innerWidth - 100;

                this.sidebarWidth = newWidth;
                this.browser.style.width = newWidth + 'px';
                if (this.snappedSide === 'right') this.browser.style.left = (window.innerWidth - newWidth) + 'px';

                if (settings.hp_sidebar_mode === 'split') {
                  document.documentElement.style.transition = 'none';
                  if (this.snappedSide === 'right') document.documentElement.style.paddingRight = newWidth + 'px';
                  if (this.snappedSide === 'left') document.documentElement.style.paddingLeft = newWidth + 'px';
                }
                rafId = null;
              });
            }
            return;
          }

          if (!this.isDragging) return;

          if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
            this.isDraggingMotion = true;
            if (this.isMinimized) this.bubbleMovedWhileMinimized = true;
          }

          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              let newLeft = e.clientX - offsetX;
              let newTop = e.clientY - offsetY;
              this.browser.style.left = newLeft + 'px';
              this.browser.style.top = newTop + 'px';

              if (!this.isMinimized && !this.isSnapped) {
                this.floatingRect.l = newLeft + 'px';
                this.floatingRect.t = newTop + 'px';
              }

              if (this.isSnapped && !this.isMinimized) this.unsnap();
              rafId = null;
            });
          }
        });

        document.addEventListener('mouseup', (e) => {
          if (this.isResizingEdge) {
            this.isResizingEdge = false;
            this.browser.classList.remove('dragging');
            this.overlay.style.display = 'none';
          }
          if (this.isDragging) {
            this.isDragging = false;
            this.browser.classList.remove('dragging');
            this.overlay.style.display = 'none';

            if (!this.isMinimized && this.isDraggingMotion) {
              if (e.clientX < 20) this.snap('left');
              else if (e.clientX > window.innerWidth - 20) this.snap('right');
            }
            setTimeout(() => this.isDraggingMotion = false, 100);
          }
        });
      }
    }

    // --- GLOBAL EVENT LISTENERS ---
    window.addEventListener('message', (event) => {
      if (!event.data || !event.data.gopeak) return;
      const targetWin = activeWindows.find(w => w.id === event.data.id);
      if (!targetWin) return;

      if (event.source !== targetWin.iframe.contentWindow) return;

      if (event.data.gopeak === 'hideHeader' && settings.hp_autohide) targetWin.browser.classList.add('header-hidden');

      if (event.data.gopeak === 'themeAndUrl') {
        if (event.data.url !== targetWin.url) {
          targetWin.url = event.data.url;
          try { targetWin.urlBar.textContent = new URL(targetWin.url).hostname; } catch { }
        }
        if (settings.hp_theme) {
          targetWin.header.style.setProperty('--header-bg', event.data.color);
          targetWin.browser.style.setProperty('--iframe-bg', event.data.pageBg);
          const rgb = parseInt(event.data.color.replace('#', ''), 16);
          const luma = 0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * ((rgb >> 0) & 0xff);
          if (event.data.isDark || luma < 128) {
            targetWin.header.style.setProperty('--url-bg', 'rgba(255, 255, 255, 0.15)');
            targetWin.header.style.setProperty('--url-color', '#fdfdfd');
          } else {
            targetWin.header.style.setProperty('--url-bg', 'rgba(0, 0, 0, 0.05)');
            targetWin.header.style.setProperty('--url-color', '#444444');
          }
        }
      }
    });

    let preIntentTimer = null; // Add this near your intentTimer definition

    document.addEventListener("mouseover", (e) => {
      const link = e.target.closest("a");
      if (link && link.href && checkModifier(e)) {
        activeHoverLink = link.href;
        
        // Wait 75ms to ensure the user actually stopped on the link
        clearTimeout(preIntentTimer);
        preIntentTimer = setTimeout(() => {
            if (activeHoverLink !== link.href) return; // User kept moving, abort!
            
            // NOW we wake up the service worker and drop the shields
            chrome.runtime.sendMessage({ action: "enable_bypass" }, () => {
                if (activeHoverLink !== link.href) return; 
                
                prefetchUrl(link.href); 
                
                clearTimeout(intentTimer);
                // Reduce this from 300 to 225 since we already waited 75ms
                intentTimer = setTimeout(() => {
                  let targetWin = activeWindows.find(w => !w.isPinned && !w.isClosing);
                  if (!targetWin) {
                    if (!settings.hp_multipeak && activeWindows.filter(w => !w.isClosing).length > 0) {
                        targetWin = activeWindows.find(w => !w.isClosing);
                    } else { 
                        targetWin = new GoPeakWindow(); 
                        activeWindows.push(targetWin); 
                    }
                  }
                  targetWin.preload(link.href, e.clientX, e.clientY);
                  if (activeHoverLink === link.href) targetWin.show(); 
                }, 225); 
            });
        }, 75);
      }
    });

    document.addEventListener("mouseout", (e) => {
      if (e.target.closest("a")) {
        activeHoverLink = null;
        clearTimeout(preIntentTimer); // Kill the network request if they leave early
        clearTimeout(intentTimer);
        let targetWin = activeWindows.find(w => !w.isPinned && !w.isVisible && !w.isClosing);
        if (targetWin) targetWin.cancelPreload();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (!settings.hp_search || !checkModifier(e)) return;
      const selection = window.getSelection().toString().trim();
      if (selection) {
        const searchUrl = `https://www.google.com/search?igu=1&q=${encodeURIComponent(selection)}`;
        
        // SECURITY FIX: Session rule injected right before Search selection load
        chrome.runtime.sendMessage({ action: "enable_bypass" }, () => {
            prefetchUrl(searchUrl);
            let targetWin = activeWindows.find(w => !w.isPinned && !w.isClosing);
            if (!targetWin) {
              if (!settings.hp_multipeak && activeWindows.filter(w => !w.isClosing).length > 0) {
                targetWin = activeWindows.find(w => !w.isClosing);
              } else {
                targetWin = new GoPeakWindow();
                activeWindows.push(targetWin);
              }
            }
            targetWin.preload(searchUrl, e.clientX, e.clientY);
            targetWin.show();
        });
      }
    });

    document.addEventListener('mousedown', (e) => {
      const isOutsideAll = !activeWindows.some(w => w.host.contains(e.target));
      if (isOutsideAll) activeWindows.forEach(win => { if (!win.isPinned && !win.isClosing) win.close(); });
    });

    document.addEventListener('dblclick', (e) => {
      if (settings.hp_bubble_trigger === 'dblclick_out' && settings.hp_allow_bubble) {
        const isOutsideAll = !activeWindows.some(w => w.host.contains(e.target));
        if (isOutsideAll) activeWindows.forEach(w => {
          if (w.isPinned && !w.isClosing) { w.isDragging = false; w.overlay.style.display = 'none'; w.toggleMinimize(); }
        });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') activeWindows.forEach(win => { if (!win.isPinned && !win.isClosing) win.close(); });
    });
  }

  if (document.body) {
    initGoPeak();
  } else {
    document.addEventListener('DOMContentLoaded', initGoPeak);
  }
}