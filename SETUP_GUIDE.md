# Claude + Microsoft Teams IT Helpdesk Bot

This project is a Microsoft Teams bot for only two IT actions:

1. Password reset
2. Account unlock

The bot uses Claude for short, natural conversation and intent classification. The actual security workflow is controlled by code:

1. User asks for password reset or account unlock.
2. Bot asks for Employee ID, username, or registered email.
3. Bot looks up the user in the local SQLite database.
4. Bot sends an OTP to the registered email, or prints it in `server.log` during local development.
5. User enters OTP in Teams.
6. If OTP is correct, the bot performs the local demo action.
7. If user lookup or OTP verification fails, the bot creates a ticket assigned to the SD team.

## Folder Map

- `index.js` - starts the web server, Teams bot endpoint, and dashboard APIs.
- `bot/helpdeskBot.js` - main conversation workflow.
- `bot/claudeAI.js` - Claude helper for intent and response text.
- `auth/otpService.js` - OTP generation and email delivery.
- `db/database.js` - all local SQLite operations. Replace internals later for a real DB.
- `db/setup.js` - creates local tables and sample users.
- `services/accountActions.js` - local password reset/account unlock actions. Replace later with AD, LDAP, Microsoft Graph, or IAM calls.
- `tickets/ticketService.js` - creates tickets and optionally notifies SD team using Teams webhook.
- `public/dashboard.html` - SD team local dashboard.
- `teams/manifest.json` - Teams app manifest template.

## Step 1: Install Dependencies

In PowerShell, run:

```powershell
npm.cmd install
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

## Step 2: Create `.env`

Copy `.env.example` to `.env`.

```powershell
Copy-Item .env.example .env
```

Open `.env` and set at least:

```env
ANTHROPIC_API_KEY=your_real_claude_key
COMPANY_NAME=Your Company Name
```

For local testing, you can leave email blank:

```env
EMAIL_USER=
EMAIL_PASS=
```

When email is blank, the OTP is printed in `server.log`.

## Step 3: Create Local Database

```powershell
npm.cmd run setup
```

Sample test users:

- `EMP001` / `john.doe` / `john.doe@yourcompany.com`
- `EMP002` / `jane.smith` / `jane.smith@yourcompany.com`
- `EMP003` / `alice.johnson` / locked account test user
- `EMP004` / `bob.wilson`

You can edit sample users in `db/setup.js`.

## Step 4: Run Locally

```powershell
npm.cmd start
```

Open:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/health
```

Bot endpoint:

```text
http://localhost:8000/api/messages
```

## Step 5: Test Conversation in Teams or Bot Framework Emulator

Example password reset:

```text
User: I forgot my password
Bot: asks for Employee ID / username / email
User: EMP001
Bot: sends OTP
User: enter OTP from email or server.log
Bot: completes local password reset
```

Example account unlock:

```text
User: My account is locked
Bot: asks for Employee ID / username / email
User: EMP003
Bot: sends OTP
User: enter OTP
Bot: unlocks local account
```

Failed OTP:

```text
Enter the wrong OTP 3 times.
Bot creates an SD ticket.
Dashboard shows the ticket.
```

## Step 6: Connect to Microsoft Teams

High-level steps:

1. Create an Azure Bot resource in Azure Portal.
2. Copy its Microsoft App ID and client secret into `.env`:

```env
MicrosoftAppId=...
MicrosoftAppPassword=...
```

3. Expose your local bot with ngrok:

```powershell
npm.cmd run ngrok
```

4. In Azure Bot configuration, set Messaging endpoint:

```text
https://your-ngrok-url.ngrok-free.app/api/messages
```

5. In `teams/manifest.json`, replace:

```json
"id": "YOUR_AZURE_BOT_APP_ID"
"botId": "YOUR_AZURE_BOT_APP_ID"
```

with your real Azure Bot App ID.

6. Zip the Teams manifest folder contents and upload it in Teams as a custom app.

## Replacing Local DB Later

Keep the rest of the app the same and replace the internals of `db/database.js`.

Functions your real DB layer must provide:

- `findUser(identifier)`
- `getUserById(id)`
- `getAllUsers()`
- `unlockUserAccount(userId)`
- `resetUserPassword(userId, newPasswordHash)`
- `saveOTP(userId, conversationId, otpCode, action, expiryMinutes)`
- `verifyOTP(userId, otpCode, action)`
- `createTicket(ticketData)`
- `getAllTickets(status)`
- `updateTicket(ticketId, updates)`
- `logAction(...)`
- `saveConversationState(...)`
- `getConversationState(...)`
- `getDashboardStats()`

## Replacing Local Password Reset / Unlock Later

Change `services/accountActions.js`.

For production, do not send a temporary password in Teams chat. Use your approved secure channel, for example:

- Active Directory password reset API
- LDAP admin bind
- Microsoft Graph / Entra ID
- IAM platform API
- ServiceNow workflow

## Important Security Notes

- Do not store plain text passwords in a real database.
- Do not show temporary passwords in Teams chat in production.
- Add dashboard authentication before using this outside local testing.
- Use HTTPS for public Teams integration.
- Restrict the bot to password reset and account unlock only.
