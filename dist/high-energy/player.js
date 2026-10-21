/* ============================================================================
   sermon2slides :: animated deck player
   Custom, fully-controlled navigation + whoosh transition engine.

   Reuses the html-ppt `data-anim` entry vocabulary (anim-<name> classes) and
   `data-fx` effects, but owns the slide lifecycle and the exit choreography
   completely.

   Navigation (clicker-friendly):
     ArrowRight / Space / PageDown / Enter  -> next
     ArrowLeft  / PageUp   / Backspace      -> prev
     Home / End                             -> first / last
     F / F11                                -> fullscreen
     touch-swipe left/right                 -> next / prev

   Each `go` performs:
     1. pop an exit whoosh on the OLD slide (directional),
        advancing to it; meanwhile RETRIGGER entry anims on the NEW slide.
     2. after the --t-out duration, swap .is-active, then clear exit classes.
   Direction is inferred from the index delta (forward=left exit/right entry).
   ============================================================================ */

(function(){
  "use strict";

  /* Durations come from the MOOD layer's CSS variables (--t-out / --t-in) so the
     JS lifecycle matches whatever the CSS animation timings say. Fall back to
     the data-* hints on #player-options, then to built-in defaults. */
  var OPTIONS_EL = document.getElementById('player-options');
  function opt(k, d){ return OPTIONS_EL ? (OPTIONS_EL.getAttribute(k) || d) : d; }
  function parseFloatA(v, d){ v = v + ''; var n = parseFloat(v); return (isFinite(n) ? n : d); }

  var rootStyle = getComputedStyle(document.documentElement);
  var cssTout = parseFloatA(rootStyle.getPropertyValue('--t-out'), NaN);
  var cssTin  = parseFloatA(rootStyle.getPropertyValue('--t-in'),  NaN);

  var T_OUT = isFinite(cssTout) ? cssTout : parseFloatA(opt('data-t-out', 620), 620);
  var T_IN  = isFinite(cssTin)  ? cssTin  : parseFloatA(opt('data-t-in', 680), 680);

  var deck   = document.querySelector('.player') || document.querySelector('.deck');
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  if (!slides.length) return;

  var idx = 0;
  var inFlight = false;

  /* ---------- fullscreen toggle ---------- */
  function fullscreen(){
    if (!document.fullscreenElement) { (document.documentElement.requestFullscreen||function(){}).call(null); }
    else { (document.exitFullscreen||function(){}).call(null); }
  }

  /* ---------- progress / number chrome ---------- */
  function paintChrome(){
    var barFill = document.getElementById('bar-fill');
    if (barFill) barFill.style.transform = 'scaleY(' + ((idx+1)/slides.length) + ')';
    var cur = document.getElementById('cur'); if (cur) cur.textContent = (idx+1);
    var tot = document.getElementById('tot'); if (tot) tot.textContent = slides.length;
    var nav = document.getElementById('slide-nav'); if (nav) nav.textContent = (idx+1) + ' / ' + slides.length;
  }

  /* ---------- retrigger html-ppt entry anims on a slide ---------- */
  function retriggerEntry(slide){
    slide.querySelectorAll('[data-anim]').forEach(function(el){
      var a = el.getAttribute('data-anim');
      el.classList.remove('anim-' + a);
      void el.offsetWidth;
      el.classList.add('anim-' + a);
      // clear the animation once done so re-entry later is clean
      setTimeout(function(){ el.classList.remove('anim-' + a); }, (T_IN + 600));
    });
  }

  /* ---------- the whoosh ---------- */
  function playExit(oldSlide, delta){
    var dir = delta > 0 ? 'left' : 'right';   // forward => leave left
    oldSlide.classList.remove('is-exit-left', 'is-exit-right');
    void oldSlide.offsetWidth;
    oldSlide.classList.add('is-exit-' + dir);
  }

  function go(next, fromRemote){
    next = Math.max(0, Math.min(slides.length - 1, next));
    var prev = idx;
    if (next === prev) return;
    if (inFlight) return; // ignore spam-clicker

    var delta = next - prev;
    inFlight = true;

    /* Optional per-slide data-transition: allow override of default whoosh */
    var oldSlide = slides[prev];
    var newSlide = slides[next];

    playExit(oldSlide, delta);

    // Bring the new slide into the stack (position + retrigger) regardless of
    // direction — a forward move enters from the right, backward from the left.
    newSlide.style.zIndex = '1';
    idx = next;

    /* Set a transient entry transform, then retrigger anims & paint. */
    retriggerEntry(newSlide);
    paintChrome();

    /* After the exit plays, swap active — the new slide fades/rise in. */
    setTimeout(function(){
      slides.forEach(function(s, i){
        // clear exit + participation state
        s.classList.remove('is-exit-left', 'is-exit-right');
        s.classList.toggle('is-active', i === next);
      });
      newSlide.style.zIndex = '';
      inFlight = false;
    }, T_OUT);

    // keep listeners/history simple; broadcast optional
    if (typeof BroadcastChannel !== 'undefined') { try {
      var bc = window.__s2s_bc;
      if (bc) bc.postMessage({ type: 'go', idx: next });
    } catch(e){} }
  }

  /* ---------- input ---------- */
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      window.__s2s_bc = new BroadcastChannel('s2s-deck');
      window.__s2s_bc.onmessage = function(e){
        if (e.data && e.data.type === 'go') go(e.data.idx, true);
      };
    } catch(e){}
  }

  document.addEventListener('keydown', function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch(e.key){
      case 'ArrowRight': case ' ': case 'PageDown': case 'Enter': go(idx + 1); e.preventDefault(); break;
      case 'ArrowLeft':  case 'PageUp':   case 'Backspace': go(idx - 1); e.preventDefault(); break;
      case 'Home': go(0); e.preventDefault(); break;
      case 'End':  go(slides.length - 1); e.preventDefault(); break;
      case 'f': case 'F': case 'F11': fullscreen(); e.preventDefault(); break;
    }
  }, false);

  /* touch swipe */
  var tX = null;
  document.addEventListener('touchstart', function(e){ tX = e.touches[0].clientX; }, {passive:true});
  document.addEventListener('touchend', function(e){
    if (tX == null) return;
    var dx = e.changedTouches[0].clientX - tX;
    if (Math.abs(dx) > 60) go(idx + (dx < 0 ? 1 : -1));
    tX = null;
  }, {passive:true});

  /* clickable left/right zones (useful for clicker-less review) */
  deck.addEventListener('click', function(e){
    var x = e.clientX;
    go(idx + (x > window.innerWidth * 0.7 ? 1 : (x < window.innerWidth * 0.3 ? -1 : 0)));
  });

  /* ---------- init ---------- */
  slides.forEach(function(s, i){ s.classList.toggle('is-active', i === 0); });
  paintChrome();
  slides[0].style.zIndex = '2';
  retriggerEntry(slides[0]);

  window.__s2sGo = go;
})();
