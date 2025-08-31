const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");

async function startPairing() {
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Evil Bot", "Chrome", "1.0"]
    });

    sock.ev.on("connection.update", ({ qr, connection }) => {
        if (qr) {
            console.log(chalk.red("\n☠ SCAN THIS EVIL QR TO UNLEASH DARKNESS ☠\n"));
            qrcode.generate(qr, { small: true });
        }
        if (connection === "open") {
            console.log(chalk.green("\n🔥 Your soul is now bound to the EVIL bot 🔥\n"));
        }
    });

    sock.ev.on("creds.update", saveCreds);

    return sock;
}

module.exports = startPairing;
