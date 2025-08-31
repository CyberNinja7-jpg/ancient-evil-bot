const startPairing = require("./pairing");
const commands = require("./commands");
const chalk = require("chalk");
const config = require("../config.json");

async function startBot() {
    const sock = await startPairing();

    sock.ev.on("messages.upsert", async (msg) => {
        const m = msg.messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        if (text.startsWith(config.prefix)) {
            const reply = commands[text];
            if (reply) {
                await sock.sendMessage(from, { text: reply });
                console.log(chalk.red(`⚡ Evil Command Executed: ${text}`));
            }
        }
    });
}

startBot();
