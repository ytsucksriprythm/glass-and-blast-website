# DataFlows SMS cutover

The CRM uses the DataFlows HTTP API with the Developers bearer token. `DATAFLOWS_HTTP_API_URL` defaults to `https://sms.dataflows.com.au/api/http/`. The OAuth v3 URL and credentials are separate and unused by this integration. See the [HTTP API reference](https://docs.dataflows.com.au/).

## Production configuration

1. Buy a dedicated Australian mobile number in DataFlows under **Sending → Numbers**. Confirm that it appears in **Developers** and in the authenticated HTTP `sender-ids` response. Keep the existing Twilio number and settings active.
2. Set `DATAFLOWS_API_TOKEN` in the server environment. Set `DATAFLOWS_SENDER_NUMBER` to the dedicated number in international format. Set `DATAFLOWS_WEBHOOK_SECRET` to a random secret of at least 32 characters shared with the authenticated event relay. Leave `DATAFLOWS_CUTOVER_READY` unset.
3. Optionally set `DATAFLOWS_SMS_SEGMENT_COST_AUD` and `TWILIO_SMS_SEGMENT_COST_AUD` to your current AUD rates per segment. The report shows unpriced sends separately.
4. Deploy with **Twilio** selected under **Provider for new SMS conversations**. The app schema creates `sms_routes` without changing historical message rows, bookings or invoices.
5. In **Settings → SMS provider routing**, run the dry run and review the Twilio history and no-history counts. Confirm **Backfill Twilio routing** while cutover stays off. Review routes flagged because the old records did not capture a sender or contained multiple senders.

## Inbound and status events

DataFlows documents inbound and receipt events, but its public guide does not specify a signature or a complete wire payload. Connect the authenticated DataFlows triggers for inbound SMS and delivery through a trusted relay, such as your Zapier or Power Automate workflow. Verify field names and event IDs using the account's test events. [DataFlows webhook guide](https://dataflows.com.au/blog/sms-webhooks-dataflows)

The relay sends HTTPS POST requests to `/api/webhooks/dataflows` with `Authorization: Bearer <DATAFLOWS_WEBHOOK_SECRET>` and JSON:

```json
{"type":"inbound","uid":"stable-inbound-event-id","from":"+61400000001","to":"+61400000002","body":"Example reply","timestamp":"2026-11-23T12:00:00+11:00"}
```

```json
{"type":"status","uid":"outbound-message-uid","status":"delivered"}
```

Map Pending to `accepted` and Failed to `failed`. Use the actual provider message UID in status events. Preserve inbound UIDs across retries. Configure retries for HTTP 409 (receipt arrived before the outbox saved the provider UID) and 503. A 401 indicates a relay credential mismatch. Existing Twilio webhooks keep their current URL and signature validation.

## Validation and activation

1. In a test deployment, verify the send response UID and sender format using a staff-controlled number, plus inbound reply, STOP, retry, and all delivery states. Verify that delivery of the first-contact notice releases queued messages. Check that ambiguous submission outcomes stay unresolved for reconciliation rather than automatically sending another copy.
2. Check a staff-controlled number with Twilio history still uses Twilio. Check a fresh staff-controlled number uses DataFlows in the test deployment when the cutover gate and setting are on. Confirm both appear in the same inbox.
3. After backfill and account validation, set `DATAFLOWS_CUTOVER_READY=true` in production, redeploy, then select **DataFlows** under **Provider for new SMS conversations** and save. Selecting **Twilio** later assigns it to new outbound conversations while preserving existing assignments.

Individual overrides and retirement of the Twilio number are deferred to a controlled migration stage.
