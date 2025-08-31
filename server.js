// server.js
// Evil WhatsApp Bot backend — QR + Pairing code + evil commands
// Use only for roleplay / admin tasks in groups you control.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const qrcode = require('qrcode');
const P = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(bodyParser.json());

let latestQRDataUrl = null;
let sessionStatus = { status: 'WAITING', message: 'Altar cold.' };
let sockRef = null; // keep a reference to the socket so endpoints can call pairing

// utility
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: P({ level: 'fatal' }),
    printQRInTerminal: false,
    browser: ['Evil-Bot','NodeJS','1.0.0']
  });

  sockRef = sock;

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      // convert the QR string to a data URL so the frontend can show it
      try {
        latestQRDataUrl = await qrcode.toDataURL(qr);
        sessionStatus = { status: 'WAITING', message: 'Sigil generated. Scan it to bind.' };
        console.log('[ritual] QR generated (served at /qr)');
      } catch (e) {
        console.error('[ritual] failed to convert QR to image', e);
      }
    }

    if (connection === 'open') {
      sessionStatus = { status: 'CONNECTED', message: '⚡ The Pact is Sealed ⚡' };
      console.log('[ritual] Connected — pact sealed.');
      latestQRDataUrl = null; // no longer needed
    }

    if (connection === 'close') {
      const reason = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode)
        || lastDisconnect?.error?.message;
      sessionStatus = { status: 'FAILED', message: `Ritual interrupted (${String(reason)})` };
      console.log('[ritual] connection closed', reason);

      // restart automatically unless logged out
      const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!loggedOut) {
        console.log('[ritual] attempting reconnection...');
        // small delay then restart
        setTimeout(() => startBot().catch(err => console.error('reconnect failed', err)), 1500);
      } else {
        console.log('[ritual] session was logged out. To re-pair delete ./session and re-run.');
      }
    }
  });

  // save creds when updated
  sock.ev.on('creds.update', saveCreds);

  // message handler: friendly, roleplay commands
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const message = m.messages && m.messages[0];
      if (!message) return;
      if (message.key && message.key.remoteJid === 'status@broadcast') return;

      const from = message.key.remoteJid;
      const isGroup = from && from.endsWith('@g.us');
      const senderJid = message.key.participant || message.key.remoteJid; // participant for groups
      const sender = jidNormalizedUser(senderJid || '');
      // get text (works for simple text + extendedText)
      const text = (message.message?.conversation) ||
                    (message.message?.extendedTextMessage?.text) ||
                    '';

      if (!text) return;

      const txt = text.trim();
      const cmd = txt.split(/\s+/)[0].toLowerCase();

      // ---------- Roleplay / Evil commands ----------
      if (cmd === '!prophecy') {
        const omens = [
          "🔥 The moon shall weep blood; trust no familiar face.",
          "⚡ Old debts return as shadows. Keep a torch at night.",
          "☠️ A name you speak tonight will not answer tomorrow.",
          "🔮 Fortune turns; what you hold so dear will ask for a price."
        ];
        await sock.sendMessage(from, { text: `🔮 **Prophecy** 🔮\n\n${pick(omens)}` });
        return;
      }

      if (cmd === '!curse') {
        // allow optional mention target: extract mentionedJid or text after command
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const target = mentioned.length ? mentioned.map(j => j.split('@')[0]).join(', ') : '(the void)';
        const curses = [
          `May the four winds unmake ${target}'s shoes and slow their steps.`,
          `${target} will wake to find their left sock vanished into night.`,
          `Shadows will whisper ${target}'s secrets back at them at midnight.`
        ];
        await sock.sendMessage(from, { text: `☠️ **Curse** ☠️\n\n${pick(curses)}` });
        return;
      }

      if (cmd === '!ritual') {
        // short ritual roleplay message
        const ritual = [
          "🔥 The candles flare — the sigils burn brighter.",
          "🕯️ A hush falls; the old names echo in the throat of night.",
          "☠️ Blood (pretend) spilled — the pact pulls tighter."
        ];
        await sock.sendMessage(from, { text: `🔺 **Ritual** 🔺\n\n${pick(ritual)}\n\n*This is roleplay only.*` });
        return;
      }

      if (cmd === '!summon' && txt.toLowerCase().includes('demon')) {
        await sock.sendMessage(from, { text: "👹 *You have summoned a demon.* It merely sighs and demands tea.\n\n(Just roleplay — no real demons here.)" });
        return;
      }

      if (cmd === '!darkquote') {
        const quotes = [
          "“Where light is lost, hunger finds its home.”",
          "“Every throne was built on someone’s silence.”",
          "“Names forgotten are the ones that linger.”"
        ];
        await sock.sendMessage(from, { text: `📜 **Ancient Quote**\n\n${pick(quotes)}` });
        return;
      }

      // ---------- Admin action: !banish or !sacrifice ----------
      // only allow in groups and only if the sender is a group admin and bot is admin
      if ((cmd === '!banish' || cmd === '!sacrifice') && isGroup) {
        // target must be mentioned
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (!mentioned.length) {
          await sock.sendMessage(from, { text: '⚠️ You must mention the one to banish. Example: `!banish @number`' });
          return;
        }

        // get metadata to check admins
        const metadata = await sock.groupMetadata(from).catch(()=>null);
        const participants = metadata?.participants || [];
        const adminIds = participants.filter(p => p.admin).map(p => p.id);

        // sender must be admin
        const senderIsAdmin = adminIds.includes(sender);
        const botId = sock.user && (sock.user.id || sock.user?.wa_version) ? jidNormalizedUser(sock.user.id) : null;
        const botIsAdmin = adminIds.includes(botId);

        if (!senderIsAdmin) {
          await sock.sendMessage(from, { text: '🛡️ Only the coven\'s elders (group admins) may perform this rite.' });
          return;
        }
        if (!botIsAdmin) {
          await sock.sendMessage(from, { text: '❗ I lack the status to execute banishment. Promote me to admin first.' });
          return;
        }

        // try to remove each mentioned
        for (const targetJid of mentioned) {
          try {
            await sock.groupParticipantsUpdate(from, [targetJid], 'remove');
            await sock.sendMessage(from, { text: `💀 ${targetJid.split('@')[0]} has been banished from the coven.` });
          } catch (err) {
            await sock.sendMessage(from, { text: `❌ Failed to banish ${targetJid.split('@')[0]} — ${String(err.message || err)}` });
          }
        }
        return;
      }

      // ---------- small fun command to confirm bot is alive ----------
      if (cmd === '!wake') {
        await sock.sendMessage(from, { text: '🩸 The darkness stirs. I am awake.' });
        return;
      }

      // ignore everything else
    } catch (err) {
      console.error('[ritual] message handler error', err);
    }
  });

  console.log('[ritual] bot started (socket ready)');
}

// start bot immediately
startBot().catch(err => {
  console.error('Failed to start bot:', err);
});

// -------------- Express endpoints for pairing panel & pairing code --------------

app.get('/qr', (req, res) => {
  // Return latest QR data URL (or null)
  res.json({ qr: latestQRDataUrl });
});

app.get('/status', (req, res) => {
  res.json(sessionStatus);
});

// POST /pair  { "number": "2547xxxxxxx" }  -> returns pairing code string
app.post('/pair', async (req, res) => {
  try {
    if (!sockRef) return res.status(500).json({ error: 'socket not initialized yet' });
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'missing number in body' });

    // normalize number to digits only (country + number, no plus)
    const digits = String(number).replace(/\D/g, '');
    console.log('[ritual] requestPairingCode for', digits);

    // requestPairingCode returns a string (8 chars or similar) — format it for readability
    const raw = await sockRef.requestPairingCode(digits);
    const code = String(raw || '').trim();
    // try to present in chunks like '1234-5678' if possible
    const formatted = (code.match(/.{1,4}/g) || [code]).join('-');

    // also set sessionStatus so frontend shows something
    sessionStatus = { status: 'WAITING', message: `Pairing code ready (${formatted}). Enter it on your primary WhatsApp device.` };

    res.json({ code: formatted });
  } catch (err) {
    console.error('[ritual] /pair error', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// serve (simple) info on root
app.get('/', (req, res) => {
  res.send('Evil bot server — endpoints: GET /qr , GET /status , POST /pair {number}');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[ritual] HTTP server listening on :${PORT}`));
