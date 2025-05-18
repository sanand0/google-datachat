# Google Datachat

A Google Chatbot that answers questions from data.

To use it:

1. Add "Google Datachat" to your chat or space.
2. DM it saying something, e.g. "@Google Datachat Help".

## Setup

Use a Google Workspace Account. Chat API is available only in Google Workspace accounts.

<!--

This application is deployed by $ADMIN at
https://console.cloud.google.com/home/dashboard?authuser=2&project=straive-datachat
-->

1. [Enable the Chat API](https://console.cloud.google.com/flows/enableapi?apiid=chat.googleapis.com)
2. [Configure OAuth](https://console.cloud.google.com/auth/overview/create)

- [Audience](https://console.cloud.google.com/auth/audience): Internal

3. In [APIs & Services - Credentials](https://console.cloud.google.com/apis/credentials), [add a service account](https://console.cloud.google.com/iam-admin/serviceaccounts/create)
   <!-- I used this configuration:
    - Name: Offline
    - Email: offline@straive-datachat.iam.gserviceaccount.com
    - No roles or users
    - Link: https://console.cloud.google.com/iam-admin/serviceaccounts/details/103936132819337995173?inv=1&invt=AbxtxA&project=comms-apps
   -->
4. Create and download a JSON key for the service account. Save it in `.dev.vars` as a single line, e.g.:
   ```ini
   GOOGLE_SERVICE_ACCOUNT='{ "type": "service_account", "project_id": "...", ... }'
   ```

Configure the [Chat API in Google Cloud Console](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)

<!--
  - App Name: Straive Datachat
  - Avatar URL: `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSCPpb1Hpdia-kMDmeGQOCgxplz2m_EUPbWsw&s`
  - Description: Check your Service Desk ticket status
  - Interactive features: Enable everything
  - Connection Settings: HTTP endpoint URL
  - HTTP endpoint URL: `https://google-datachat.sanand.workers.dev/googlechat`
  - App home URL: `https://google-datachat.sanand.workers.dev/`
  - Authentication audience: HTTP endpoint URL
  - Visibility: Make chat available to specific people and groups in Straive.com (add users, comma-separated)
  - Logs: Log errors to Logging
-->

On Google Chat - New Chat - type the App Name you entered in the Chat API configuration and it should appear.

Clone [this repository](https://github.com/gramener/google-datachat). Then run:

```bash
# Install dependencies
npm install

# Deploy to CloudFlare
npm run deploy

# Add secrets from the downloaded service account JSON key
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT
```
