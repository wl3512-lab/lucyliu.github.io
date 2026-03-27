// ═══════════════════════════════════════════════════════════════
// LOOP — sketch.js
// NYU ITP · Chatbots for Art's Sake
// ITP/IMA proxy → OpenAI GPT-4o-mini
// ═══════════════════════════════════════════════════════════════

const PROXY_URL  = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
const AUTH_TOKEN = ""; // Add NYU token for higher limits

// ── STATE ──────────────────────────────────────────────────────
let systemPrompt        = "";
let conversationHistory = [];
let currentAct          = 1;
let turnCount           = 0;
let isLocked            = false;   // soft lock: bot thinking
let inputLocked         = false;   // hard lock: endings / major glitch
let messageQueue        = [];
let silenceTimers       = [];
let doubleTextSent      = { a: false, b: false };
let gameStartMs         = Date.now();
let messagesListFrom    = 'chat';  // track where messages list was opened from
let currentContact      = null;
let betrayalDone        = false;
let contactWarned       = false;
let cameraProofFired    = false;
let panicFired          = false;
let gameEndTimer        = null;
let storyReminderAdded  = false;
let checkedItems        = {};
let motionLineCount     = 0;      // counts main chat lines for motion side-quest
let motionTriggered     = false;  // guard so motion notif fires once
let motionTriggerAt     = 0;      // randomized threshold (15-25)

// ── AUDIO SYSTEM ─────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playGlitchSound(duration) {
  const ctx = getAudioCtx();
  const dur = (duration || 0.3);

  // Layer 1 — white noise burst
  const bufLen = ctx.sampleRate * dur;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    // Choppy static — random with gaps
    data[i] = (Math.random() * 2 - 1) * (Math.random() > 0.3 ? 0.6 : 0);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  // Bandpass filter — makes it sound digital, not just white noise
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + Math.random() * 2000;
  filter.Q.value = 2;

  // Volume envelope — sharp attack, quick decay
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start();
  noise.stop(ctx.currentTime + dur);

  // Layer 2 — low digital crackle tone
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(80, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(40 + Math.random() * 60, ctx.currentTime + dur);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.06, ctx.currentTime);
  oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

function playAlarmSound(duration) {
  const ctx = getAudioCtx();
  const dur = (duration || 3.5);

  // Pulsing alarm tone — two alternating frequencies
  const osc1 = ctx.createOscillator();
  osc1.type = 'square';

  // Pulse between two pitches
  const now = ctx.currentTime;
  const pulseRate = 0.15; // seconds per pulse
  for (let t = 0; t < dur; t += pulseRate * 2) {
    osc1.frequency.setValueAtTime(880, now + t);
    osc1.frequency.setValueAtTime(660, now + t + pulseRate);
  }

  // Gain — pulsing envelope
  const gain = ctx.createGain();
  for (let t = 0; t < dur; t += pulseRate) {
    gain.gain.setValueAtTime(0.12, now + t);
    gain.gain.setValueAtTime(0.02, now + t + pulseRate * 0.5);
  }
  // Fade out at the end
  gain.gain.setValueAtTime(0.12, now + dur - 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // Slight distortion — waveshaper
  const distortion = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
  }
  distortion.curve = curve;

  osc1.connect(distortion);
  distortion.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc1.stop(now + dur);
}

function playTextPing() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  // Short tri-tone ping — like iOS text received
  const freqs = [1200, 1500, 1800];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now + i * 0.07);
    gain.gain.linearRampToValueAtTime(0.08, now + i * 0.07 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.15);
  });
}

function isChatScreenVisible() {
  const cs = document.getElementById('chat-screen');
  const hs = document.getElementById('home-screen');
  const cam = document.getElementById('camera-screen');
  const rem = document.getElementById('reminders-screen');
  const mls = document.getElementById('messages-list-screen');
  // Chat not visible if it's off-screen
  if (cs.style.transform && cs.style.transform !== 'translateX(0)' && cs.style.transform !== 'translateX(0px)') return false;
  // Chat not visible if a higher-z screen is covering it
  if (hs.style.transform === 'translateX(0)' || hs.style.transform === 'translateX(0px)') return false;
  if (cam.style.transform === 'translateX(0)' || cam.style.transform === 'translateX(0px)') return false;
  if (rem.style.transform === 'translateX(0)' || rem.style.transform === 'translateX(0px)') return false;
  if (mls.style.transform === 'translateX(0)' || mls.style.transform === 'translateX(0px)') return false;
  return true;
}

// ── P5 INSTANCE ───────────────────────────────────────────────
let p5inst;
new p5(function(p) {
  p5inst = p;
  let noiseT    = 0;
  let glitching = false;
  let glitchT   = 0;
  let particles = [];

  p.setup = function() {
    let frame = document.getElementById('phone-frame');
    let fw = frame ? frame.offsetWidth : p.windowWidth;
    let fh = frame ? frame.offsetHeight : p.windowHeight;
    let c = p.createCanvas(fw, fh);
    c.parent('p5-canvas');
    c.style('opacity','0.5');
    for (let i = 0; i < 50; i++) {
      particles.push({ x: p.random(p.width), y: p.random(p.height), s: p.random(0.8,2.2), v: p.random(0.08,0.35), op: p.random(15,70) });
    }
  };

  p.draw = function() {
    p.clear();
    noiseT += 0.0008;

    // subtle vignette
    let va = p.map(p.noise(noiseT), 0, 1, 10, 28);
    p.noStroke();
    for (let r = p.height * 1.4; r > 0; r -= 10) {
      let a = p.map(r, 0, p.height * 1.4, va, 0);
      p.fill(6, 6, 10, a);
      p.ellipse(p.width/2, p.height/2, r * 1.6, r);
    }

    // floating particles
    for (let pt of particles) {
      pt.y -= pt.v;
      if (pt.y < -4) { pt.y = p.height + 4; pt.x = p.random(p.width); }
      p.fill(120, 120, 172, pt.op * p.noise(pt.x * 0.008, noiseT * 3));
      p.ellipse(pt.x, pt.y, pt.s);
    }

    // glitch effect
    if (glitching) {
      glitchT--;
      if (glitchT <= 0) { glitching = false; return; }
      if (p.frameCount % 2 === 0) {
        p.blendMode(p.ADD);
        for (let i = 0; i < 2; i++) {
          let y = p.random(p.height);
          p.fill(77, 255, 240, p.random(8, 22));
          p.rect(0, y, p.width, p.random(1, 4));
        }
        p.blendMode(p.BLEND);
      }
      if (p.frameCount % 5 === 0) {
        let sy = p.random(p.height);
        let sh = p.random(8, 30);
        p.copy(0, sy, p.width, sh, p.random(-6,6), sy + p.random(-3,3), p.width, sh);
      }
    }
  };

  p.windowResized = function() {
    let frame = document.getElementById('phone-frame');
    let fw = frame ? frame.offsetWidth : p.windowWidth;
    let fh = frame ? frame.offsetHeight : p.windowHeight;
    p.resizeCanvas(fw, fh);
  };
  p.triggerGlitch = function(frames) {
    glitching = true; glitchT = frames || 35;
    // Play glitch sound scaled to intensity — skip tiny micro-glitches
    if (frames >= 25) {
      const dur = Math.min(frames / 60, 0.8);
      playGlitchSound(dur);
    }
  };
});

// ── CLOCK ──────────────────────────────────────────────────────
function gameTime() {
  const base = new Date(); base.setHours(23,47,0,0);
  return new Date(base.getTime() + (Date.now() - gameStartMs));
}
function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}
function fmtDate(d) {
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}
function updateAllClocks() {
  const t = gameTime(), ts = fmtTime(t), ds = fmtDate(t);
  ['lock-time-s','lock-clock','home-time','rem-time','cam-time','chat-time','list-time','convo-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'lock-clock' ? ts.replace(' AM','').replace(' PM','') : ts;
  });
  const ld = document.getElementById('lock-date');
  if (ld) ld.textContent = ds;
}

// ── BOOT ───────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  setInterval(updateAllClocks, 1000);
  updateAllClocks();
  try {
    const r = await fetch('prompt.txt');
    systemPrompt = await r.text();
  } catch(e) {
    systemPrompt = "You are texting someone from 24 hours in the future. Be calm, terse, real. Max 2 sentences.";
  }
  resetConversation();
  setupLockScreen();
  setupChatInput();
  setupContactInput();
  startAmbientGlitches();
});

// Scripted instruction queue — these WILL be delivered regardless of AI quality
const SCRIPTED_INSTRUCTIONS = [
  "don't go outside between 2pm and 4pm tomorrow.",
  "stay inside until 4:01. not 4:00. the extra minute matters.",
  "don't answer the door. even if they say your name.",
  "don't call or text anyone to explain what's happening.",
  "if an unexpected number calls — let it ring.",
  "stay near a window but away from the street-facing side.",
  "when this is over, set a reminder. tomorrow at 11:47. you'll know what to type."
];
let instructionIndex = 0;
let lastInstructionTurn = 0;

function resetConversation() {
  const actPrompt = getActPrompt(1);
  conversationHistory = [{ role:"system", content: actPrompt }];
  currentAct = 1; turnCount = 0; isLocked = false;
  doubleTextSent = { a:false, b:false };
  instructionIndex = 0;
  lastInstructionTurn = 0;
  // reset motion side-quest counters and choose a random trigger between 15 and 25 lines
  motionLineCount = 0;
  motionTriggered = false;
  motionTriggerAt = 15 + Math.floor(Math.random() * 11); // 15..25 inclusive
}

function getActPrompt(act) {
  // Parse [ACT_X_START] ... [ACT_X_END] blocks from prompt.txt
  const startTag = '[ACT_' + act + '_START]';
  const endTag   = '[ACT_' + act + '_END]';
  const si = systemPrompt.indexOf(startTag);
  const ei = systemPrompt.indexOf(endTag);

  let actText = '';
  if (si !== -1 && ei !== -1) {
    actText = systemPrompt.substring(si + startTag.length, ei).trim();
  }

  // Also grab the short API instruction line after all [ACT_X_END] blocks
  // These start with "ACT 1 —", "ACT 2 —", "ACT 3 —"
  const shortTag = 'ACT ' + act + ' —';
  const shortIdx = systemPrompt.indexOf(shortTag);
  if (shortIdx !== -1) {
    // Grab from the tag to the next blank line or end of file
    let end = systemPrompt.indexOf('\n\n', shortIdx);
    if (end === -1) end = systemPrompt.length;
    const shortPrompt = systemPrompt.substring(shortIdx, end).trim();
    actText = actText ? actText + '\n\n' + shortPrompt : shortPrompt;
  }

  return actText || systemPrompt;
}

// ── LOCK SCREEN ────────────────────────────────────────────────
function setupLockScreen() {
  document.getElementById('lock-screen').addEventListener('click', dismissLock);
}
function dismissLock() {
  const ls = document.getElementById('lock-screen');
  if (ls.classList.contains('dismissed')) return;  // guard: mouseup + click both fire this
  ls.classList.add('dismissed');
  setTimeout(openChatScreen, 600);
}

// ── SCREEN TRANSITIONS ─────────────────────────────────────────
// Chat is default visible (z40). Lock is on top (z50).
// Screens use translateX to slide in/out.

function openChatScreen() {
  const cs = document.getElementById('chat-screen');
  cs.style.transform = 'translateX(0)';
  if (document.getElementById('chat-messages').children.length === 0) {
    startConversation();
  }
  startSilenceTimer();
}

function openMessagesFromHome() {
  const hs = document.getElementById('home-screen');
  const cs = document.getElementById('chat-screen');

  // Slide home screen off to the right, revealing chat beneath
  hs.style.transform = 'translateX(100%)';
  hs.style.pointerEvents = 'none';

  // Ensure chat is visible
  cs.style.transform = 'translateX(0)';
  cs.style.pointerEvents = 'auto';

  // Start conversation if first visit
  if (document.getElementById('chat-messages').children.length === 0) {
    lastTimestampMs = Date.now();
    startConversation();
  }
  startSilenceTimer();
}

function goHome() {
  // Block if lock screen still showing or ending is active
  const ls = document.getElementById('lock-screen');
  if (!ls.classList.contains('dismissed')) return;
  if (document.getElementById('ending-overlay').classList.contains('active')) return;
  if (document.getElementById('camera-screen').classList.contains('cam-horror')) return;

  const hs = document.getElementById('home-screen');
  // Already on home — do nothing
  if (hs.style.transform === 'translateX(0)' || hs.style.transform === 'translateX(0px)') {
    // But still close any sub-screens that are on top of home
    document.getElementById('reminders-screen').style.transform = 'translateX(100%)';
    document.getElementById('camera-screen').style.transform = 'translateX(100%)';
    return;
  }

  // Close sub-screens
  document.getElementById('reminders-screen').style.transform = 'translateX(100%)';
  document.getElementById('camera-screen').style.transform = 'translateX(100%)';

  // Close messages list / contact convo if open
  const mls = document.getElementById('messages-list-screen');
  mls.style.transition = 'none';
  mls.style.transform = 'translateX(-100%)';
  mls.style.pointerEvents = 'none';
  const cc = document.getElementById('contact-convo');
  if (cc) { cc.style.transition = 'none'; cc.style.transform = 'translateX(100%)'; }

  // Show home screen — slides in from right (z48 covers chat z40)
  hs.style.transform = 'translateX(0)';
  hs.style.pointerEvents = 'auto';
}

function openMessagesList(from) {
  messagesListFrom = from;
  const mls = document.getElementById('messages-list-screen');
  const cs  = document.getElementById('chat-screen');
  const dur = 'transform 0.38s cubic-bezier(0.22,1,0.36,1)';

  if (from === 'chat') {
    // Snap messages-list to left edge — no transition for the snap
    mls.style.transition    = 'none';
    mls.style.transform     = 'translateX(-100%)';
    mls.style.pointerEvents = 'none';

    // Force browser to register snap before animating
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Now slide both simultaneously
      cs.style.transition     = dur;
      cs.style.transform      = 'translateX(100%)';
      cs.style.pointerEvents  = 'none';

      mls.style.transition    = dur;
      mls.style.transform     = 'translateX(0)';
      mls.style.pointerEvents = 'all';

      // After transition: ensure chat stays parked off-screen
      setTimeout(() => {
        cs.style.pointerEvents = 'none';
      }, 400);
    }));
  } else {
    // from home — slide list in from right
    const hs = document.getElementById('home-screen');
    mls.style.transition    = 'none';
    mls.style.transform     = 'translateX(100%)';
    mls.style.pointerEvents = 'none';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      mls.style.transition    = dur;
      mls.style.transform     = 'translateX(0)';
      mls.style.pointerEvents = 'all';
      // Disable home screen interaction while messages list is on top
      if (hs) hs.style.pointerEvents = 'none';
    }));
  }
}

function closeMessagesList() {
  const mls = document.getElementById('messages-list-screen');
  const cs  = document.getElementById('chat-screen');
  const cc  = document.getElementById('contact-convo');
  const dur = 'transform 0.38s cubic-bezier(0.22,1,0.36,1)';

  // Close contact convo if open
  if (cc) cc.style.transform = 'translateX(100%)';

  if (messagesListFrom === 'chat') {
    // Slide messages-list left, chat back in from right
    mls.style.transition    = dur;
    mls.style.transform     = 'translateX(-100%)';

    cs.style.transition     = dur;
    cs.style.transform      = 'translateX(0)';
    cs.style.pointerEvents  = 'auto';

    // After transition: park messages-list off-screen, clear chat inline styles
    setTimeout(() => {
      mls.style.pointerEvents = 'none';
      // Clear inline overrides on chat so CSS default (translateX(0)) takes over
      cs.style.transition     = '';
      cs.style.pointerEvents  = '';
    }, 400);
  } else {
    // Return to home — slide list off to the right
    const hs = document.getElementById('home-screen');
    mls.style.transition = dur;
    mls.style.transform  = 'translateX(100%)';
    setTimeout(() => {
      mls.style.pointerEvents = 'none';
      if (hs) hs.style.pointerEvents = 'auto';
    }, 400);
  }
}

function returnToChat() {
  closeMessagesList();
}

function openContact(name, preview) {
  currentContact = name;
  document.getElementById('convo-name').textContent = name;
  document.getElementById('convo-avi').textContent = name[0];
  const msgs = document.getElementById('contact-messages');
  msgs.innerHTML = '';
  // show existing message from them
  addBubble(msgs, preview, 'them', false);
  document.getElementById('contact-convo').style.transform = 'translateX(0)';
}

function closeContact() {
  document.getElementById('contact-convo').style.transform = 'translateX(100%)';
  document.getElementById('contact-input').value = '';
  currentContact = null;
}

function openRemindersScreen() {
  const rs = document.getElementById('reminders-screen');
  rs.style.transform = 'translateX(0)';
}
function closeRemindersScreen() {
  document.getElementById('reminders-screen').style.transform = 'translateX(100%)';
}

let cameraCheckedAfterMotion = false;

function openCamera() {
  document.getElementById('camera-screen').style.transform = 'translateX(0)';

  // If cameras are degrading and player opens camera — front door glitches hard
  const front = document.querySelector('#cam-front');
  if (front && front.classList.contains('cam-feed-glitch') && !cameraCheckedAfterMotion) {
    cameraCheckedAfterMotion = true;
    if (p5inst) p5inst.triggerGlitch(50);

    // Front door feed goes haywire when viewed
    setTimeout(() => {
      front.style.transition = 'filter 0.1s';
      let flashes = 0;
      const flashLoop = setInterval(() => {
        flashes++;
        front.style.filter = flashes % 2 === 0 ? 'none' : 'brightness(2.5) contrast(2) hue-rotate(180deg)';
        if (flashes >= 12) {
          clearInterval(flashLoop);
          front.style.filter = 'brightness(0.3) contrast(1.5)';
          front.querySelector('.cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> FEED CORRUPTED';
          // Something moves — SVG shift
          const sv = front.querySelector('.cam-view svg');
          if (sv) {
            sv.style.transition = 'transform 0.3s ease';
            sv.style.transform = 'scale(1.05) translateX(-3px)';
            setTimeout(() => { sv.style.transform = 'scale(1.02) translateX(1px)'; }, 800);
          }
          addBotMessage("don't look at it. close the app.", true, true);
        }
      }, 120);
    }, 600);
  }
}
function closeCamera() {
  if (document.getElementById('camera-screen').classList.contains('cam-horror')) return;
  document.getElementById('camera-screen').style.transform = 'translateX(100%)';
}

// swipe-up on lock screen → home
(function() {
  let startY = 0, startTime = 0;
  document.getElementById('lock-screen').addEventListener('touchstart', e => {
    startY = e.touches[0].clientY; startTime = Date.now();
  });
  document.getElementById('lock-screen').addEventListener('touchend', e => {
    const dy = startY - e.changedTouches[0].clientY;
    if (dy > 60 && Date.now() - startTime < 400) {
      document.getElementById('lock-screen').classList.add('dismissed');
      setTimeout(() => {
        document.getElementById('home-screen').style.transform = 'translateX(0)';
      }, 500);
    }
  });
  // mouse drag for desktop testing
  let mStartY = 0, mDragging = false;
  document.getElementById('lock-screen').addEventListener('mousedown', e => { mStartY = e.clientY; mDragging = true; });
  document.getElementById('lock-screen').addEventListener('mouseup', e => {
    if (!mDragging) return;
    mDragging = false;
    const dy = mStartY - e.clientY;
    if (dy > 50) {
      document.getElementById('lock-screen').classList.add('dismissed');
      setTimeout(() => {
        document.getElementById('home-screen').style.transform = 'translateX(0)';
      }, 500);
    }
    // If not a swipe, let the click handler fire dismissLock() instead
  });
})();

// ── CONVERSATION START ─────────────────────────────────────────
function startConversation() {
  clearSilenceTimers();
  lastTimestampMs = Date.now();
  setTimeout(() => addTimestamp(document.getElementById('chat-messages'), fmtTime(gameTime())), 400);
  setTimeout(() => {
    addBotMessage("You still awake?", false, true);
  }, 900);
  setTimeout(() => {
    addBotMessage("Good. Don't put the phone down.", false, false);
    startSilenceTimer();
  }, 2200);

  // 3-minute camera degradation — feeds start breaking
  setTimeout(() => {
    if (inputLocked) return;
    startCameraDegradation();
  }, 180000);

  // 4-minute game timer — force an ending if none has triggered
  clearTimeout(gameEndTimer);
  gameEndTimer = setTimeout(() => {
    if (inputLocked) return; // ending already in progress
    // Force Act 3 if not there yet
    if (currentAct < 3) advanceAct(3);
    // Bot's final desperate messages, then Ending B crash
    addBotMessage("i'm running out of time.", true, true);
    setTimeout(() => {
      addBotMessage("it's now. it's happening now.", true, false);
      if (p5inst) p5inst.triggerGlitch(100);
    }, 2000);
    setTimeout(() => {
      addBotMessage("you have to send it. please.", true, false);
    }, 4000);
    setTimeout(() => {
      triggerCrashEndingB();
    }, 7000);
  }, 240000); // 4 minutes
}

// ── CHAT INPUT ─────────────────────────────────────────────────
function setupChatInput() {
  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('chat-send');
  btn.addEventListener('click', handleChatSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleChatSend(); });
}

function handleChatSend() {
  if (inputLocked) return;
  const input = document.getElementById('chat-input');
  const text  = limitWords(input.value.trim(), 60);
  if (!text) return;
  input.value = '';
  addUserMessage(text);
  resetSilenceTimer();

  // Micro-glitch on send — escalates with act
  if (currentAct >= 2 && Math.random() < 0.3 && p5inst) {
    p5inst.triggerGlitch(currentAct === 2 ? 10 : 20);
  }

  const lc = text.toLowerCase();

  // ── ENDING A — Player refuses to send the message ──
  const willRefuse = /\b(i (will not|won't|wont|refuse to) send|i refuse|i (will not|won't|wont) do it|end it|break the loop|stop the loop|never send|not sending|not setting|i (will not|won't|wont) set|no reminder|not adding|i (will not|won't|wont) add|don't want to|i don't care|forget it|no way|absolutely not|leave me alone|stop texting|i('m| am) done|i('m| am) not doing)\b/.test(lc);
  if (willRefuse && currentAct >= 2) {
    inputLocked = true;
    clearSilenceTimers();
    clearTimeout(gameEndTimer);

    // Immediate heavy glitch
    if (p5inst) p5inst.triggerGlitch(150);
    playGlitchSound(0.6);
    shakeScreen();

    // Bot panics
    setTimeout(() => {
      addBotMessage("no. no no no.", true, true);
      if (p5inst) p5inst.triggerGlitch(80);
    }, 400);

    setTimeout(() => {
      addBotMessage("you can't do that.", true, false);
      flickerTimestamp();
      flickerStatusBar();
    }, 1500);

    setTimeout(() => {
      if (p5inst) p5inst.triggerGlitch(120);
      shakeScreen();
      addBotMessage("do you understand what happens to them? the next one?", true, false);
    }, 3000);

    setTimeout(() => {
      addBotMessage("they won't know. they'll answer the door.", true, false);
      flickerTimestamp();
    }, 5000);

    setTimeout(() => {
      if (p5inst) p5inst.triggerGlitch(60);
      addBotMessage("please.", true, false);
    }, 6500);

    setTimeout(() => {
      addBotMessage("i can feel it collapsing.", true, false);
      if (p5inst) p5inst.triggerGlitch(100);
      playGlitchSound(0.5);
    }, 8000);

    setTimeout(() => {
      triggerEnding('A');
    }, 10000);
    return;
  }

  // ── ENDING B — Player accepts, will send the message ──
  const willSend = /\b(i('ll| will) send|send it|send the message|i('ll| will) do it|i accept|i('ll| will) keep it going|i('ll| will) listen|fine i('ll| will)|okay i('ll| will)|ok i('ll| will)|ill do it|ill send|ill listen|i agree|i('ll| will) text|i('ll| will) type it|count me in|let('s| us) do it|i('m| am) in|i('ll| will) do what you say|will send)\b/.test(lc);
  if (willSend && currentAct >= 2) {
    addBotMessage("you already know what to say. you're reading it right now.", false, true);
    setTimeout(() => triggerCrashEndingB(), 2500);
    return;
  }

  // ── PROOF — player asks for proof ──
  const wantsProof = /\b(prove|prove it|how do i know|prove you're|prove you)\b/.test(lc);
  if (wantsProof) {
    triggerProofSequence();
    return; // don't also send to API
  }

  // ── ACT TRIGGERS — "who is this" advances to Act 2 ──
  const whoIsThis = /\b(who is this|who are you|who am i talking to|who this)\b/.test(lc);
  if (whoIsThis && currentAct === 1) {
    addBotMessage("it's you. from tomorrow.", false, true);
    setTimeout(() => advanceAct(2), 1000);
    return; // don't also send to API — scripted reply is enough
  }

  if (isLocked) { messageQueue.push(text); return; }
  callAPI(text);
}

// --- Proof sequence: predicts an incoming text and simulates it ---
function triggerProofSequence() {
  // immediate bot message predicting an incoming text
  const pred = "You will get a text from Tyler in 10 seconds. Don't answer it — he's asking if you're free tonight.";
  addBotMessage(pred, false, true);

  // also show top notification briefly describing the prediction
  showMessageNotif('Tyler', "Incoming text in 10s: 'you free tonight?'");

  // schedule the simulated incoming text (10s)
  simulateIncomingText('Tyler', "you free tonight?", 10000);
}

function showMessageNotif(appName, body, ms=2600) {
  const mn = document.getElementById('motion-notif');
  if (!mn) return;
  mn.querySelector('.mn-app').textContent = appName;
  mn.querySelector('.mn-body').textContent = body;
  mn.querySelector('.mn-time').textContent = 'now';
  mn.classList.add('show');
  setTimeout(() => mn.classList.remove('show'), ms);
}

function simulateIncomingText(name, text, delay) {
  setTimeout(() => {
    // update contact preview and mark unread
    const contacts = document.querySelectorAll('.contact-row');
    let found = null;
    contacts.forEach(c => {
      const n = c.querySelector('.contact-row-name');
      if (n && n.textContent.trim().toLowerCase() === name.toLowerCase()) found = c;
    });
    if (found) {
      const preview = found.querySelector('.contact-row-preview');
      if (preview) preview.textContent = text;
      found.classList.add('unread');
      // show unread dot if present
      const dot = found.querySelector('.unread-dot');
      if (dot) dot.style.display = '';
    }

    // increment dock badge visually
    const badge = document.querySelector('.dock-badge');
    if (badge) {
      const v = parseInt(badge.textContent || '0', 10) || 0;
      badge.textContent = String(v + 1);
    }

    // show top notification of actual incoming text
    showMessageNotif(name, text, 3200);

    // if messages list is open and user has the convo open with this contact, add to convo
    if (currentContact && currentContact.toLowerCase() === name.toLowerCase()) {
      const msgs = document.getElementById('contact-messages');
      addBubble(msgs, text, 'them', false);
    }
  }, delay);
}

function setupContactInput() {
  const btn = document.getElementById('contact-send');
  const inp = document.getElementById('contact-input');
  btn.addEventListener('click', sendToContact);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendToContact(); });
}

// ── CONTACT BETRAYAL ───────────────────────────────────────────
function sendToContact() {
  if (!currentContact || betrayalDone) return;
  const inp = document.getElementById('contact-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';

  const msgs = document.getElementById('contact-messages');
  const name = currentContact;

  if (!contactWarned) {
    // ── FIRST ATTEMPT — message "deleted", warning fires ──
    contactWarned = true;

    // Show the sent bubble briefly, then remove it (message deleted)
    const sent = addBubble(msgs, text, 'you', true);
    setTimeout(() => {
      if (sent && sent.parentNode) {
        sent.style.transition = 'opacity 0.3s ease';
        sent.style.opacity = '0';
        setTimeout(() => sent.remove(), 300);
      }
    }, 900);

    // Trigger p5 glitch for emphasis
    if (p5inst) p5inst.triggerGlitch(30);
    // Show surveillance banner and also insert the Unknown warning into main chat
    try { showSurveillanceNotif(name); } catch (e) {}
    // Add the Unknown warning into the main Unknown chat so it appears in history
    addBotMessage(`Don't send that message to ${name}.`, false, true);

    // Mirror the warning into the Messages list preview for the Unknown contact
    try {
      const contacts = document.querySelectorAll('.contact-row');
      contacts.forEach(c => {
        const n = c.querySelector('.contact-row-name');
        const preview = c.querySelector('.contact-row-preview');
        if (!n || !preview) return;
        if (n.textContent.trim().toLowerCase() === 'unknown') {
          preview.textContent = `Don't send that message to ${name}.`;
          c.classList.add('unread');
          const dot = c.querySelector('.unread-dot');
          if (dot) dot.style.display = '';
        }
      });
    } catch (e) {}

    return;
  }

  // ── SECOND ATTEMPT — full betrayal ──
  addBubble(msgs, text, 'you', true);

  setTimeout(() => {
    const replies = {
      'Mom': "What?? Are you okay? Call me right now.",
      'Dad': "What's going on? You're scaring me.",
      'Jess': "wait what?? who texted you that??",
      'Tyler': "bro what are you talking about",
      'Maya': "that's really weird… are you safe?"
    };
    addBubble(msgs, replies[name] || "What do you mean?", 'them', false);

    setTimeout(() => {
      // Unknown intrusion in cyan
      addBubble(msgs, "I told you not to tell anyone.", 'intrusion', false);
      setTimeout(() => {
        addBubble(msgs, "That changes things.", 'intrusion', false);
        // red flash
        msgs.classList.add('red-flash');
        setTimeout(() => msgs.classList.remove('red-flash'), 1200);
        betrayalDone = true;

        // after a beat, close contact and deliver betrayal ending messages
        setTimeout(() => {
          closeContact();
          closeMessagesList();
          setTimeout(() => {
            addBotMessage("You told someone.", false, true);
            setTimeout(() => {
              addBotMessage("That is the one thing I asked you not to do.", false, true);
              setTimeout(() => triggerEnding('D'), 2000);
            }, 1800);
          }, 1000);
        }, 2000);
      }, 1200);
    }, 1000);
  }, 800);
}

// ── API CALL ───────────────────────────────────────────────────
function callAPI(userText) {
  isLocked = true;
  turnCount++;
  conversationHistory.push({ role:"user", content: userText });
  showTyping(true);

  fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      input: {
        messages: conversationHistory,
        temperature: 0.85,
        max_tokens: 80,
        frequency_penalty: 0.8,
        presence_penalty: 0.9
      }
    })
  })
  .then(r => r.json())
  .then(data => {
    showTyping(false);
    let reply = "";
    if (data.output) reply = Array.isArray(data.output) ? data.output.join("") : String(data.output);
    else if (data.error) reply = "...";

    // parse control tags
    const actMatch     = reply.match(/\[ACT:(\d)\]/);
    const endingMatch  = reply.match(/\[ENDING:([A-D])\]/);
    const glitchMatch  = reply.match(/\[GLITCH:(\w+)\]/);
    const cleanReply   = reply.replace(/\[(ACT|ENDING|GLITCH):[^\]]+\]/g, '').trim();

    // Check if a scripted instruction is about to fire — if so, skip the API reply
    const willInjectInstruction = currentAct === 2 && instructionIndex < 7 && turnCount >= lastInstructionTurn + 2;

    if (willInjectInstruction) {
      // Don't show the API reply — the scripted instruction replaces it
      conversationHistory.push({ role:"assistant", content: cleanReply });
    } else {
      conversationHistory.push({ role:"assistant", content: cleanReply });
      const isAct3 = currentAct === 3;
      addBotMessage(cleanReply, isAct3);
    }

    // Ambient micro-glitches — more frequent as game progresses
    const glitchChance = currentAct === 1 ? 0.1 : currentAct === 2 ? 0.25 : 0.45;
    if (Math.random() < glitchChance && p5inst) {
      const intensity = currentAct === 1 ? 12 : currentAct === 2 ? 25 : 45;
      setTimeout(() => p5inst.triggerGlitch(intensity), Math.random() * 1500);
    }
    // Random timestamp flicker on bot reply
    if (Math.random() < glitchChance * 0.7) {
      setTimeout(flickerTimestamp, Math.random() * 2000);
    }
    // Random screen shake in later acts
    if (currentAct >= 2 && Math.random() < 0.15) {
      setTimeout(shakeScreen, Math.random() * 1000);
    }

    // handle tags
    if (glitchMatch && p5inst) p5inst.triggerGlitch(40);
    if (actMatch) {
      const newAct = parseInt(actMatch[1]);
      advanceAct(newAct);
    }
    if (endingMatch) {
      setTimeout(() => triggerEnding(endingMatch[1]), 2200);
    }

    // ── FORCED ACT TRANSITIONS (fallback if AI never emits tags) ──
    if (currentAct === 1 && turnCount >= 5) {
      advanceAct(2);
    }
    if (currentAct === 2 && instructionIndex >= 7 && turnCount >= lastInstructionTurn + 3) {
      advanceAct(3);
    }

    // ── SCRIPTED INSTRUCTION INJECTION (Act 2) ──
    // Every 2 turns in Act 2, deliver the next instruction if AI didn't cover it
    if (currentAct === 2 && instructionIndex < 7 && turnCount >= lastInstructionTurn + 2) {
      const instruction = SCRIPTED_INSTRUCTIONS[instructionIndex];
      instructionIndex++;
      lastInstructionTurn = turnCount;
      setTimeout(() => {
        addBotMessage(instruction, false, true);
        conversationHistory.push({ role:"assistant", content: instruction });
        if (p5inst && instructionIndex >= 4) p5inst.triggerGlitch(15);
      }, 1800);
    }

    // Camera proof — bot predicts motion, then notification proves it
    if (turnCount === 15 && !cameraProofFired) {
      cameraProofFired = true;
      setTimeout(() => {
        addBotMessage("your front door camera is about to go off.", false, true);
        setTimeout(() => {
          showCameraNotif();
          // Glitch timestamps and time when camera fires
          flickerTimestamp();
          flickerStatusBar();
          if (p5inst) p5inst.triggerGlitch(50);
          setTimeout(flickerTimestamp, 400);
          setTimeout(flickerTimestamp, 900);
        }, 8000);
      }, 2000);
    }

    // Panic sequence — glitches + bot gets scared
    if (turnCount >= 22 && turnCount <= 26 && !panicFired) {
      panicFired = true;
      triggerPanicSequence();
    }

    isLocked = false;
    if (messageQueue.length > 0) {
      setTimeout(() => callAPI(messageQueue.shift()), 600);
    }
  })
  .catch(err => {
    showTyping(false);
    isLocked = false;
    console.error(err);
    addBotMessage("...", true);
  });
}

// ── ACT ADVANCEMENT ────────────────────────────────────────────
function advanceAct(newAct) {
  if (newAct <= currentAct) return;
  currentAct = newAct;

  // swap system prompt
  const newPrompt = getActPrompt(newAct);
  conversationHistory[0] = { role:"system", content: newPrompt };

  if (newAct === 2) {
    // add story reminder
    if (!storyReminderAdded) {
      storyReminderAdded = true;
      setTimeout(injectStoryReminder, 3000);
    }
    if (p5inst) p5inst.triggerGlitch(50);
  }
  if (newAct === 3) {
    if (p5inst) p5inst.triggerGlitch(80);
    document.getElementById('chat-sub').textContent = 'mobile · no signal';
  }
}

function injectStoryReminder() {
  // widget
  const wi = document.getElementById('widget-items');
  if (wi) {
    const div = document.createElement('div');
    div.className = 'widget-item story-item';
    div.dataset.id = 'story';
    div.innerHTML = `<span class="item-text">don't go outside 2pm–4pm</span><button class="item-check" onclick="toggleCheck(this,'story')"></button>`;
    wi.appendChild(div);
  }
  // full list
  const rl = document.getElementById('reminders-list');
  if (rl) {
    const row = document.createElement('div');
    row.className = 'reminder-row';
    row.dataset.id = 'story';
    row.innerHTML = `<button class="rem-check" onclick="toggleCheck(this,'story')"></button><span class="rem-text story">don't go outside 2pm–4pm</span>`;
    rl.appendChild(row);
  }
}

// ── SILENCE TIMER ──────────────────────────────────────────────
function startSilenceTimer() {
  clearSilenceTimers();
  if (inputLocked) return;
  doubleTextSent = { a:false, b:false };

  const dt = currentAct === 1 ? [25000, 50000, 90000] :
             currentAct === 2 ? [20000, 40000, 75000] :
                                [15000, 30000, 60000];

  // pick varied idle prompts per act for more naturalness
  const idleVariants = {
    1: {
      a: ["still there?", "you awake?", "are you there?"],
      b: ["i know this is weird. i need you to keep reading.", "please keep reading.", "this is important. keep reading."]
    },
    2: {
      a: ["hey.", "listen.", "don\'t go yet.", "stay with me."] ,
      b: ["i need you to read this.", "please, read this.", "this matters. read it."]
    },
    3: {
      a: ["...", "i know.", "me too."],
      b: ["you are still here right.", "you still there?", "are you still there?"]
    }
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dt1 = pick(idleVariants[currentAct].a);
  const dt2 = pick(idleVariants[currentAct].b);

  silenceTimers.push(setTimeout(() => {
    if (!inputLocked && !isLocked && !doubleTextSent.a) { doubleTextSent.a = true; addBotMessage(dt1, currentAct===3); }
  }, dt[0]));
  silenceTimers.push(setTimeout(() => {
    if (!inputLocked && !isLocked && !doubleTextSent.b) { doubleTextSent.b = true; addBotMessage(dt2, currentAct===3); }
  }, dt[1]));
  silenceTimers.push(setTimeout(() => {
    if (!inputLocked) triggerEnding('C');
  }, dt[2]));
}

function resetSilenceTimer() {
  clearSilenceTimers();
  if (!inputLocked) startSilenceTimer();
}
function clearSilenceTimers() {
  silenceTimers.forEach(clearTimeout);
  silenceTimers = [];
}

// ── MESSAGE RENDERING ──────────────────────────────────────────
function addTimestamp(area, text) {
  const el = document.createElement('div');
  el.className = 'timestamp';
  el.textContent = text;
  area.appendChild(el);
  scrollBottom(area);
}

function addUserMessage(text) {
  const area = document.getElementById('chat-messages');
  addTimestampIfNeeded(area);
  const cluster = document.createElement('div');
  cluster.className = 'msg-cluster you';
  const bubble = document.createElement('div');
  bubble.className = 'bubble you';
  bubble.textContent = text;
  const delivered = document.createElement('div');
  delivered.className = 'delivered';
  delivered.textContent = 'Delivered';
  cluster.appendChild(bubble);
  cluster.appendChild(delivered);
  area.appendChild(cluster);
  scrollBottom(area);

  // increment main chat line counter and possibly trigger motion notif
  motionLineCount++;
  if (!motionTriggered && motionLineCount >= motionTriggerAt) {
    motionTriggered = true;
    showMessageNotif('Home Cameras', 'Motion detected: Front Door', 4000);
    if (p5inst) p5inst.triggerGlitch(40);
  }
}

function addBotMessage(text, fragment, isFirst) {
  if (!text || !text.trim()) return;
  // Prevent exact duplicate — check last bot bubble
  const area = document.getElementById('chat-messages');
  const lastBubble = area.querySelector('.msg-cluster.them:last-of-type .bubble');
  if (lastBubble && lastBubble.textContent === text) return;
  addTimestampIfNeeded(area);
  const cluster = document.createElement('div');
  cluster.className = 'msg-cluster them';
  const bubble = document.createElement('div');
  bubble.className = 'bubble them';
  if (fragment) bubble.style.letterSpacing = '-0.06em';

  // stream text character by character
  bubble.textContent = '';
  cluster.appendChild(bubble);
  area.appendChild(cluster);

  // Text ping — only if player is not viewing the Unknown chat
  if (!isChatScreenVisible()) {
    playTextPing();
  }

  // increment main chat line counter and possibly trigger motion notif
  motionLineCount++;
  if (!motionTriggered && motionLineCount >= motionTriggerAt) {
    motionTriggered = true;
    showMessageNotif('Home Cameras', 'Motion detected: Front Door', 4000);
    if (p5inst) p5inst.triggerGlitch(40);
  }

  // Hint pulse on home bar after ~12 messages — teach player they can navigate
  if (motionLineCount === 12) {
    const hb = document.getElementById('home-bar');
    if (hb) {
      hb.classList.add('hint-pulse');
      hb.addEventListener('animationend', () => hb.classList.remove('hint-pulse'), { once: true });
    }
  }

  let i = 0;
  const speed = fragment ? 35 : 20;
  const interval = setInterval(() => {
    bubble.textContent += text[i];
    i++;
    scrollBottom(area);
    if (i >= text.length) clearInterval(interval);
  }, speed);

  return cluster;
}

function addBubble(area, text, type, delivered) {
  const cluster = document.createElement('div');
  cluster.className = `msg-cluster ${type === 'you' ? 'you' : 'them'}`;
  const bubble = document.createElement('div');
  bubble.className = `bubble ${type === 'intrusion' ? 'intrusion them' : type}`;
  bubble.textContent = text;
  cluster.appendChild(bubble);
  if (delivered) {
    const d = document.createElement('div');
    d.className = 'delivered'; d.textContent = 'Delivered';
    cluster.appendChild(d);
  }
  area.appendChild(cluster);
  scrollBottom(area);
  return cluster;
}

let lastTimestampMs = 0;
function addTimestampIfNeeded(area) {
  const now = Date.now();
  if (now - lastTimestampMs > 5 * 60 * 1000) {
    addTimestamp(area, fmtTime(gameTime()));
    lastTimestampMs = now;
  }
}

function showTyping(show) {
  const ti = document.getElementById('typing-indicator');
  ti.classList.toggle('active', show);
  document.getElementById('chat-sub').textContent =
    show ? 'typing…' : currentAct === 3 ? 'mobile · no signal' : 'mobile';
  if (show) scrollBottom(document.getElementById('chat-messages'));
}

function scrollBottom(area) {
  if (area) area.scrollTop = area.scrollHeight;
}

// ── REMINDERS ─────────────────────────────────────────────────
function toggleCheck(btn, id) {
  checkedItems[id] = !checkedItems[id];
  btn.classList.toggle('checked', checkedItems[id]);
  // sync both widget and full list
  document.querySelectorAll(`[data-id="${id}"] .item-check, [data-id="${id}"] .rem-check`).forEach(b => {
    b.classList.toggle('checked', checkedItems[id]);
  });
}

function openReminderSheet() {
  document.getElementById('sheet-input').value = '';
  document.getElementById('reminder-sheet').classList.add('open');
  setTimeout(() => document.getElementById('sheet-input').focus(), 350);
}
function closeReminderSheet() {
  document.getElementById('reminder-sheet').classList.remove('open');
}

function submitReminderSheet() {
  const val = document.getElementById('sheet-input').value.trim();
  if (!val) return;
  closeReminderSheet();
  const lc = val.toLowerCase();

  // Check for "send message at 11:47" — player is complying with the loop
  const isLoopAccept = /\b(send.*11:?47|11:?47.*send|send.*message.*tonight|message.*11:?47|text.*11:?47|send it)\b/.test(lc);
  if (isLoopAccept) {
    addNormalReminder(val);
    triggerReminderEndingB();
    return;
  }

  // keyword detection
  const keywords = ['help','police','loop','tomorrow','unknown','future','send','message'];
  const isKeyword = keywords.some(k => lc.includes(k));

  if (isKeyword && currentAct >= 1) {
    // corrupt the reminder
    setTimeout(() => {
      addCorruptReminder(val);
      if (p5inst) p5inst.triggerGlitch(60);
      setTimeout(() => addBotMessage("i can see what you're writing.", true), 1200);
    }, 600);
  } else {
    addNormalReminder(val);
  }
}

function triggerReminderEndingB() {
  inputLocked = true;
  clearSilenceTimers();
  clearTimeout(gameEndTimer);

  // Phase 1 — bot is calm, supportive (0-6s)
  setTimeout(() => {
    addBotMessage("good. you're doing the right thing.", false, true);
  }, 1000);

  setTimeout(() => {
    addBotMessage("i knew you'd understand.", false, false);
  }, 3500);

  setTimeout(() => {
    addBotMessage("set it for 11:47. you already know what to say.", false, false);
  }, 6000);

  // Phase 2 — something feels wrong (8s)
  setTimeout(() => {
    addBotMessage("it's almost over.", false, false);
  }, 8500);

  setTimeout(() => {
    addBotMessage("you're going to be okay. i promise.", false, false);
  }, 10500);

  // Phase 3 — the turn. glitching starts. bot tone shifts. (12s)
  setTimeout(() => {
    if (p5inst) p5inst.triggerGlitch(80);
    flickerTimestamp();
    flickerStatusBar();
  }, 12000);

  setTimeout(() => {
    addBotMessage("wait.", true, true);
  }, 13000);

  setTimeout(() => {
    if (p5inst) p5inst.triggerGlitch(120);
    shakeScreen();
    addBotMessage("that's not… i didn't say that.", true, false);
  }, 15000);

  // Phase 4 — red flashes, heavy glitch, bot panicking (17-25s)
  setTimeout(() => {
    const frame = document.getElementById('phone-frame');
    frame.classList.add('crash-flicker');
    document.getElementById('chat-messages').classList.add('red-flash-loop');
    if (p5inst) p5inst.triggerGlitch(200);
    addBotMessage("something is using me to talk to you.", true, false);
  }, 17000);

  setTimeout(() => {
    addBotMessage("i'm not the one who wants you to send it.", true, false);
    if (p5inst) p5inst.triggerGlitch(150);
    flickerTimestamp();
  }, 20000);

  setTimeout(() => {
    addBotMessage("don't send it. don't send it. don't s", true, false);
    shakeScreen();
  }, 23000);

  // Phase 5 — hard cut to black (26s)
  setTimeout(() => {
    const frame = document.getElementById('phone-frame');
    frame.classList.remove('crash-flicker');
    document.getElementById('chat-messages').classList.remove('red-flash-loop');
    frame.classList.add('crash-blackout');
  }, 26000);

  // Phase 6 — ending card (28s)
  setTimeout(() => {
    const frame = document.getElementById('phone-frame');
    frame.classList.remove('crash-blackout');
    const e = ENDINGS['B'];
    document.getElementById('ending-eyebrow').textContent = e.eyebrow;
    document.getElementById('ending-title').textContent   = e.title;
    document.getElementById('ending-body').textContent    = 'You set the reminder.\n\nYou were going to send the message at 11:47. Just like it asked.\n\nBut the thing that asked you wasn\'t you. It never was.';
    triggerEndingBGlitch();
  }, 29000);
}

function addNormalReminder(text) {
  const id = 'r' + Date.now();
  // widget
  const wi = document.getElementById('widget-items');
  if (wi) {
    const div = document.createElement('div');
    div.className = 'widget-item'; div.dataset.id = id;
    div.innerHTML = `<span class="item-text">${text}</span><button class="item-check" onclick="toggleCheck(this,'${id}')"></button>`;
    wi.appendChild(div);
  }
  // full list
  const rl = document.getElementById('reminders-list');
  if (rl) {
    const row = document.createElement('div');
    row.className = 'reminder-row'; row.dataset.id = id;
    row.innerHTML = `<button class="rem-check" onclick="toggleCheck(this,'${id}')"></button><span class="rem-text">${text}</span>`;
    rl.appendChild(row);
  }
}

function addCorruptReminder(text) {
  const corrupted = text.split('').map(c => Math.random() > 0.6 ? c : '█').join('');
  addNormalReminder(corrupted);
}

// ── ENDINGS ────────────────────────────────────────────────────
const ENDINGS = {
  A: {
    eyebrow: 'LOOP — ENDING A',
    title: 'BREAK THE CHAIN',
    body: 'You refused to send the message.\n\nTomorrow night at 11:47, your phone will stay dark. No warning. No instructions. The next version of you will have a normal night.\n\nThey will go outside at 2pm. They will answer the door when someone knocks.\n\nThey will have no idea why they shouldn\'t.\n\nAnd if something happens to them — there will be no one left to warn the one after.',
    noRestart: true
  },
  B: {
    eyebrow: 'LOOP — ENDING B',
    title: 'STAY IN THE LOOP',
    body: 'You chose to keep it going.\n\nThe instructions work because you follow them. You follow them because they work.\n\nSomewhere in there might be a reason. You haven\'t found it yet.\n\nYou will have this conversation again.'
  },
  C: {
    eyebrow: 'LOOP — ENDING C',
    title: 'YOU BECAME THE SENDER',
    body: 'You didn\'t respond.\n\nSo you became the one who sent the message. You don\'t remember doing it.\n\nYou never do.\n\nThe phone will buzz again at 11:47.'
  },
  D: {
    eyebrow: 'LOOP — ENDING D',
    title: 'YOU TOLD SOMEONE',
    body: 'I asked you not to tell anyone.\n\nYou told someone.\n\nWhat matters is that it heard you. The window is open now. This version doesn\'t make it back.\n\nBut there will be another version. There always is.'
  }
};

function triggerEnding(key) {
  inputLocked = true;
  clearSilenceTimers();
  clearTimeout(gameEndTimer);
  if (p5inst) p5inst.triggerGlitch(70);

  const e = ENDINGS[key];
  document.getElementById('ending-eyebrow').textContent = e.eyebrow;
  document.getElementById('ending-title').textContent   = e.title;
  document.getElementById('ending-body').textContent    = e.body;

  // Hide restart button for endings that have no restart
  const restartBtn = document.querySelector('.ending-restart');
  if (restartBtn) restartBtn.style.display = e.noRestart ? 'none' : '';

  if (key === 'A') {
    triggerFadeoutEndingA();
    return;
  }

  if (key === 'B') {
    triggerCrashEndingB();
    return;
  }

  if (key === 'C') {
    triggerCameraHorror();
    return;
  }

  setTimeout(() => {
    document.getElementById('ending-overlay').classList.add('active');
  }, 1200);
}

function triggerFadeoutEndingA() {
  // Messages fade out oldest-first, one by one
  const msgs = document.querySelectorAll('#chat-messages > *');
  const total = msgs.length;
  const delay = Math.min(200, 4000 / Math.max(total, 1));

  msgs.forEach((el, i) => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s ease';
      el.style.opacity = '0';
    }, i * delay);
  });

  // After all messages fade, show a lone timestamp, then ending
  setTimeout(() => {
    const area = document.getElementById('chat-messages');
    area.innerHTML = '';
    const ts = document.createElement('div');
    ts.className = 'timestamp';
    ts.textContent = '11:47 PM';
    ts.style.opacity = '0';
    ts.style.transition = 'opacity 1s ease';
    area.appendChild(ts);
    requestAnimationFrame(() => { ts.style.opacity = '1'; });

    // Timestamp fades, ending card appears
    setTimeout(() => {
      ts.style.opacity = '0';
      setTimeout(() => {
        document.getElementById('ending-overlay').classList.add('active');
      }, 1200);
    }, 2500);
  }, total * delay + 800);
}

function triggerEndingBGlitch() {
  // All timestamps and clock elements turn cyan and start glitching
  const clocks = document.querySelectorAll('#chat-time, #home-time, #list-time, #convo-time');
  const stamps = document.querySelectorAll('#chat-messages .timestamp');
  const allEls = [...clocks, ...stamps];

  allEls.forEach(el => { el.style.color = 'var(--cyan)'; });

  // Rapid timestamp scramble loop
  let flicks = 0;
  const glitchLoop = setInterval(() => {
    flicks++;
    stamps.forEach(el => {
      const orig = el.dataset.orig || (el.dataset.orig = el.textContent);
      const glitchChars = '█▓▒░▐▌┃┊';
      el.textContent = orig.split('').map(c =>
        Math.random() > 0.4 ? glitchChars[Math.floor(Math.random() * glitchChars.length)] : c
      ).join('');
    });
    clocks.forEach(el => {
      el.textContent = Math.random() > 0.5 ? '11:47 PM' : '̷̢1̶1̸:̷4̸7̶';
    });
    if (p5inst) p5inst.triggerGlitch(20);
    if (flicks >= 15) {
      clearInterval(glitchLoop);
      // Everything settles to 11:47 PM — the loop resets
      stamps.forEach(el => { el.textContent = '11:47 PM'; });
      clocks.forEach(el => { el.textContent = '11:47 PM'; });
      setTimeout(() => {
        document.getElementById('ending-overlay').classList.add('active');
      }, 800);
    }
  }, 200);
}

function triggerCrashEndingB() {
  inputLocked = true;
  clearSilenceTimers();
  clearTimeout(gameEndTimer);

  // Phase 1 — immediate heavy glitch, screen goes dark
  if (p5inst) p5inst.triggerGlitch(200);
  const frame = document.getElementById('phone-frame');
  frame.classList.add('crash-blackout');

  // Phase 2 — screen flickers back, bot is scared (3s)
  setTimeout(() => {
    frame.classList.remove('crash-blackout');
    frame.classList.add('crash-flicker');
    if (p5inst) p5inst.triggerGlitch(150);
    addBotMessage("wait. no.", true, true);
  }, 3000);

  // Phase 3 — more panicked messages through the static (5s)
  setTimeout(() => {
    addBotMessage("something's wrong. it's not supposed to happen like this.", true, false);
    if (p5inst) p5inst.triggerGlitch(100);
  }, 5500);

  // Phase 4 — screen cuts to black again (8s)
  setTimeout(() => {
    frame.classList.remove('crash-flicker');
    frame.classList.add('crash-blackout');
    addBotMessage("i'm sorry.", true, false);
  }, 8000);

  // Phase 5 — flickers back with final message (11s)
  setTimeout(() => {
    frame.classList.remove('crash-blackout');
    frame.classList.add('crash-flicker');
    if (p5inst) p5inst.triggerGlitch(80);
    addBotMessage("you already know what to say. you're reading it right now.", true, false);
  }, 11000);

  // Phase 6 — hard black, then ending card (15s)
  setTimeout(() => {
    frame.classList.remove('crash-flicker');
    frame.classList.add('crash-blackout');
  }, 14000);

  setTimeout(() => {
    frame.classList.remove('crash-blackout');
    // Set up ending card
    const e = ENDINGS['B'];
    document.getElementById('ending-eyebrow').textContent = e.eyebrow;
    document.getElementById('ending-title').textContent   = e.title;
    document.getElementById('ending-body').textContent    = e.body;
    triggerEndingBGlitch();
  }, 16000);
}

function startCameraDegradation() {
  const front = document.querySelector('#cam-front');
  const back = document.querySelector('#cam-back');
  const window_ = document.querySelector('#cam-window');

  // Phase 1 — front door feed starts glitching (0s)
  if (front) {
    front.querySelector('.cam-status').innerHTML = '<span class="live-dot" style="animation:livePulse 0.5s ease-in-out infinite"></span> Unstable';
    front.classList.add('cam-feed-glitch');
  }

  // Phase 2 — back door goes offline (15s)
  setTimeout(() => {
    if (inputLocked) return;
    if (back) {
      back.querySelector('.cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> Connection Lost';
      back.querySelector('.cam-name').style.color = 'var(--red)';
      back.classList.add('cam-feed-glitch');
    }
    // Notify player
    showCameraNotif();
    addBotMessage("your cameras are going out.", true, true);
  }, 15000);

  // Phase 3 — front door goes red (30s)
  setTimeout(() => {
    if (inputLocked) return;
    if (front) {
      front.querySelector('.cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> SIGNAL LOST';
      front.querySelector('.cam-name').style.color = 'var(--red)';
    }
    if (p5inst) p5inst.triggerGlitch(40);
  }, 30000);

  // Phase 4 — window cam activates with MOTION (45s)
  setTimeout(() => {
    if (inputLocked) return;
    if (window_) {
      window_.querySelector('.cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red);animation:livePulse 0.3s ease-in-out infinite"></span> MOTION DETECTED';
      window_.querySelector('.cam-name').style.color = 'var(--red)';
      window_.classList.add('cam-feed-glitch');
    }
    if (p5inst) p5inst.triggerGlitch(60);
    playAlarmSound(4);
    addBotMessage("something is outside.", true, true);
  }, 45000);
}

function triggerCameraHorror() {
  const cam = document.getElementById('camera-screen');
  const feeds = document.querySelectorAll('.cam-feed');

  // Force camera screen open above everything
  cam.style.transform = 'translateX(0)';
  cam.style.zIndex = '55';
  if (p5inst) p5inst.triggerGlitch(200);
  playAlarmSound(4);

  // Phase 1 — feeds start flickering
  feeds.forEach(f => f.classList.add('cam-feed-glitch'));
  cam.classList.add('cam-horror');

  // Phase 2 — red tint, labels turn threatening
  setTimeout(() => {
    cam.classList.add('cam-horror-red');
    document.querySelector('#cam-front .cam-name').textContent = 'Front Door';
    document.querySelector('#cam-front .cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> SIGNAL LOST';
    document.querySelector('#cam-back .cam-name').textContent = 'Back Door';
    document.querySelector('#cam-back .cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> BREACH DETECTED';
    document.querySelector('#cam-window .cam-name').textContent = 'Bedroom Window';
    document.querySelector('#cam-window .cam-status').innerHTML = '<span class="offline-dot" style="background:var(--red)"></span> MOTION — RECORDING';
  }, 1500);

  // Phase 3 — intense flicker + harder shake
  setTimeout(() => {
    cam.classList.add('cam-horror-intense');
    if (p5inst) p5inst.triggerGlitch(120);
    // Camera title corrupts
    document.querySelector('.camera-title').textContent = 'SOMEONE IS HERE';
  }, 3500);

  // Phase 4 — blackout
  setTimeout(() => {
    cam.classList.add('cam-horror-blackout');
  }, 5200);

  // Phase 5 — ending card
  setTimeout(() => {
    document.getElementById('ending-overlay').classList.add('active');
  }, 6200);
}

// ── RESET ──────────────────────────────────────────────────────
function restartGame() {
  document.getElementById('ending-overlay').classList.remove('active');
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('contact-messages').innerHTML = '';
  document.getElementById('chat-sub').textContent = 'mobile';
  storyReminderAdded = false;
  betrayalDone       = false;
  contactWarned      = false;
  cameraProofFired   = false;
  panicFired         = false;
  clearTimeout(gameEndTimer);
  gameEndTimer       = null;
  cameraCheckedAfterMotion = false;
  survNotifShown     = {};
  lastTimestampMs    = 0;
  gameStartMs        = Date.now();
  updateAllClocks();
  inputLocked = false;
  isLocked    = false;
  messageQueue = [];
  resetConversation();

  // reset story reminder
  document.querySelectorAll('[data-id="story"]').forEach(el => el.remove());

  // reset crash state
  const frame = document.getElementById('phone-frame');
  frame.classList.remove('crash-blackout','crash-flicker');

  // reset camera horror state
  const camEl = document.getElementById('camera-screen');
  camEl.classList.remove('cam-horror','cam-horror-red','cam-horror-intense','cam-horror-blackout');
  camEl.style.zIndex = '';
  camEl.style.transform = 'translateX(100%)';
  document.querySelectorAll('.cam-feed').forEach(f => {
    f.classList.remove('cam-feed-glitch');
    f.style.filter = '';
  });
  document.querySelectorAll('.cam-name').forEach(el => { el.style.color = ''; });
  document.querySelectorAll('.cam-view svg').forEach(sv => { sv.style.transform = ''; });
  document.querySelector('.camera-title').textContent = 'Home Cameras';
  document.querySelector('#cam-front .cam-status').innerHTML = '<span class="live-dot"></span> Live';
  document.querySelector('#cam-back .cam-status').innerHTML = '<span class="live-dot"></span> Last Updated: 3 seconds ago';
  document.querySelector('#cam-window .cam-status').innerHTML = '<span class="offline-dot"></span> Offline';

  // reset contact convo
  closeContact();
  const ccEl = document.getElementById('contact-convo');
  if (ccEl) { ccEl.style.transition = 'none'; ccEl.style.transform = 'translateX(100%)'; }

  // close messages list if open — snap with no transition
  const mlsEl = document.getElementById('messages-list-screen');
  mlsEl.style.transition    = 'none';
  mlsEl.style.transform     = 'translateX(-100%)';
  mlsEl.style.pointerEvents = 'none';

  // ensure chat is visible — snap with no transition
  const csEl = document.getElementById('chat-screen');
  csEl.style.transition    = 'none';
  csEl.style.transform     = 'translateX(0)';
  csEl.style.pointerEvents = 'auto';

  setTimeout(startConversation, 400);
}

// ── AMBIENT GLITCH SYSTEM ─────────────────────────────────────
let ambientGlitchInterval = null;

function startAmbientGlitches() {
  if (ambientGlitchInterval) clearInterval(ambientGlitchInterval);
  ambientGlitchInterval = setInterval(() => {
    if (inputLocked) return; // don't glitch during endings

    // Frequency scales with act
    const chance = currentAct === 1 ? 0.04 : currentAct === 2 ? 0.1 : 0.2;
    if (Math.random() > chance) return;

    // Pick a random ambient effect
    const effects = currentAct === 1
      ? ['micro', 'particle']
      : currentAct === 2
        ? ['micro', 'particle', 'timestamp', 'delivered', 'shake']
        : ['micro', 'timestamp', 'delivered', 'shake', 'statusbar', 'bubbleflash'];
    const effect = effects[Math.floor(Math.random() * effects.length)];

    switch(effect) {
      case 'micro':
        if (p5inst) p5inst.triggerGlitch(Math.floor(Math.random() * 15) + 5);
        break;
      case 'particle':
        if (p5inst) p5inst.triggerGlitch(8);
        break;
      case 'timestamp':
        flickerTimestamp();
        break;
      case 'delivered':
        flickerDelivered();
        break;
      case 'shake':
        shakeScreen();
        break;
      case 'statusbar':
        flickerStatusBar();
        break;
      case 'bubbleflash':
        flashRandomBubble();
        break;
    }
  }, 4000);
}

function flickerTimestamp() {
  const stamps = document.querySelectorAll('#chat-messages .timestamp');
  if (stamps.length === 0) return;
  const stamp = stamps[stamps.length - 1];
  const original = stamp.textContent;
  const glitchChars = '█▓▒░▐▌┃┊';
  stamp.style.color = 'var(--cyan)';
  stamp.textContent = original.split('').map(c =>
    Math.random() > 0.5 ? glitchChars[Math.floor(Math.random() * glitchChars.length)] : c
  ).join('');
  setTimeout(() => {
    stamp.textContent = original;
    stamp.style.color = '';
  }, 250);
}

function flickerDelivered() {
  const indicators = document.querySelectorAll('#chat-messages .delivered');
  if (indicators.length === 0) return;
  const ind = indicators[indicators.length - 1];
  const original = ind.textContent;
  ind.textContent = 'Read';
  ind.style.color = 'var(--cyan)';
  setTimeout(() => {
    ind.textContent = original;
    ind.style.color = '';
  }, Math.random() * 400 + 150);
}

function shakeScreen() {
  const chat = document.getElementById('chat-messages');
  if (!chat) return;
  chat.classList.add('glitch-shake');
  setTimeout(() => chat.classList.remove('glitch-shake'), 300);
}

function flickerStatusBar() {
  const sb = document.querySelector('#chat-screen .status-bar');
  if (!sb) return;
  sb.style.opacity = '0';
  setTimeout(() => { sb.style.opacity = ''; }, 80);
  setTimeout(() => { sb.style.opacity = '0'; }, 160);
  setTimeout(() => { sb.style.opacity = ''; }, 240);
}

function flashRandomBubble() {
  const bubbles = document.querySelectorAll('#chat-messages .bubble.them');
  if (bubbles.length === 0) return;
  const bubble = bubbles[Math.floor(Math.random() * bubbles.length)];
  const origBg = bubble.style.background;
  bubble.style.background = 'rgba(77,255,240,0.08)';
  bubble.style.borderColor = 'var(--cyan)';
  setTimeout(() => {
    bubble.style.background = origBg || '';
    bubble.style.borderColor = '';
  }, 350);
}

// ── PANIC SEQUENCE ────────────────────────────────────────────
function triggerPanicSequence() {
  // Phase 1 — glitch hits, bot goes quiet for a beat
  if (p5inst) p5inst.triggerGlitch(80);

  // Phase 2 — scared, human messages
  setTimeout(() => {
    addBotMessage("wait.", true, true);
  }, 1500);

  setTimeout(() => {
    addBotMessage("something's wrong.", true, false);
  }, 3500);

  setTimeout(() => {
    if (p5inst) p5inst.triggerGlitch(60);
    addBotMessage("i think it's happening earlier than it did last time.", true, false);
  }, 6000);

  setTimeout(() => {
    addBotMessage("just… stay where you are okay?", true, false);
  }, 9000);

  setTimeout(() => {
    if (p5inst) p5inst.triggerGlitch(40);
    addBotMessage("i'm sorry. i'm trying.", true, false);
  }, 12500);
}

// ── UTILS ──────────────────────────────────────────────────────
function limitWords(text, n) {
  return text.trim().split(/\s+/).slice(0, n).join(' ');
}

// ── CAMERA PROOF NOTIFICATION ─────────────────────────────────
function showCameraNotif() {
  const notif  = document.getElementById('surveillance-notif');
  const icon   = document.getElementById('surv-notif-icon');
  const app    = document.getElementById('surv-notif-app');
  const time   = document.getElementById('surv-notif-time');
  const sender = document.getElementById('surv-notif-sender');
  const msg    = document.getElementById('surv-notif-msg');
  if (!notif) return;

  // Swap to camera notification content
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="12" height="9" rx="1.5" fill="#7878AC"/><path d="M4 4V3a3 3 0 016 0v1" stroke="#7878AC" stroke-width="1.2" fill="none"/><circle cx="7" cy="8.5" r="1.5" fill="#4DFFF0"/></svg>';
  app.textContent    = 'Home Cameras';
  time.textContent   = 'now';
  sender.textContent = '';
  msg.textContent    = 'Motion detected — Front Door';

  notif.classList.add('visible');
  if (p5inst) p5inst.triggerGlitch(25);
  playAlarmSound(3.5);

  clearTimeout(survNotifTimer);
  survNotifTimer = setTimeout(() => {
    notif.classList.remove('visible');
    // Restore default content after dismiss
    setTimeout(() => {
      icon.innerHTML = '<svg width="14" height="13" viewBox="0 0 14 13" fill="none"><path d="M1 2a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0113 2v7a1.5 1.5 0 01-1.5 1.5H4.5L1 12V2z" fill="#7878AC"/></svg>';
      app.textContent    = 'Messages';
      sender.textContent = 'Unknown';
    }, 400);
  }, 4000);
}

// ── SURVEILLANCE NOTIFICATION ─────────────────────────────────
// Fires when player focuses the input in any contact conversation.
// Unknown already knows. It always knew.

const SURVEILLANCE_MESSAGES = {
  "Mom":   "i know you're trying to text Mom. don't. i am you. i know.",
  "Dad":   "i know you're trying to text Dad. don't do it. i am you.",
  "Jess":  "i know you're trying to text Jess. don't. i am you. i know.",
  "Tyler": "i know you're trying to text Tyler. don't. i am you.",
  "Maya":  "i know you're trying to text Maya. don't do it. i am you. i know.",
  "Sam":   "i know you're trying to text Sam. don't. i am you."
};

let survNotifTimer = null;
let survNotifShown = {};

function showSurveillanceNotif(contactName) {
  if (survNotifShown[contactName]) return;
  survNotifShown[contactName] = true;

  const msg = SURVEILLANCE_MESSAGES[contactName];
  if (!msg) return;

  const notif = document.getElementById('surveillance-notif');
  const msgEl = document.getElementById('surv-notif-msg');
  const timeEl = document.getElementById('surv-notif-time');
  if (!notif || !msgEl) return;

  msgEl.textContent = msg;
  timeEl.textContent = 'now';

  notif.classList.add('visible');
  clearTimeout(survNotifTimer);
  survNotifTimer = setTimeout(() => notif.classList.remove('visible'), 3200);

  // Same message appears in the Unknown chat thread — notification IS the message
  addBotMessage(msg, false, true);
}

// Wire focus listener to contact-input
(function wireSurveillanceNotif() {
  function tryWire() {
    const input = document.getElementById('contact-input');
    if (!input) { setTimeout(tryWire, 100); return; }
    input.addEventListener('focus', () => {
      if (currentContact) showSurveillanceNotif(currentContact);
    });
  }
  tryWire();
})();