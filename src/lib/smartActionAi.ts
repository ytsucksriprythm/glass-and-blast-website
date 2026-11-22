import { interpretSms, type SmsIntent } from './smartActionRules';

// Send only isolated scheduling vocabulary and recognised calendar/time tokens.
// Arbitrary text, identifiers, names, addresses and phone numbers stay in the CRM.
function schedulingTokens(text: string): string {
  return (text.toLowerCase().match(/\b(?:reschedul\w*|move|change|postpone|instead|cancel|appointment|booking|today|tomorrow|this|next|week|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|before|after|around|between|or|if|unless|only|not|\d{4}-\d{2}-\d{2}|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{2}:\d{2})\b/g) ?? [])
    .map(word => word.startsWith('reschedul') ? 'reschedule' : word).slice(0, 35).join(' ');
}

export async function smartSmsIntent(text: string, receivedAt: string, request = fetch): Promise<SmsIntent> {
  const fallback = interpretSms(text, receivedAt);
  const apiKey = process.env.GEMINI_API_KEY;
  const tokens = schedulingTokens(text);
  if (!apiKey || process.env.SMART_ACTIONS_GEMINI_ENABLED !== 'true' || !tokens) return fallback;
  const model = process.env.SMART_ACTIONS_GEMINI_MODEL || 'gemini-3.1-flash-lite';
  if (!/^gemini-[\w.-]+$/.test(model)) return fallback;
  try {
    const response = await request('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(3500),
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Classify the scheduling intent. Sydney reference timestamp: ' + receivedAt +
          '. Return localStart (YYYY-MM-DDTHH:mm) only if explicit and unambiguous. Tokens: ' + tokens }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json', responseSchema: {
          type: 'OBJECT', properties: { intent: { type: 'STRING', enum: ['reschedule', 'cancel', 'other'] }, localStart: { type: 'STRING' } },
          required: ['intent'],
        } },
      }),
    });
    if (!response.ok) return fallback;
    const result = JSON.parse((await response.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
    // AI can route a message to clarification. Booking changes require a date
    // independently verified from the customer's original words.
    if (fallback.intent === 'other' && ['reschedule', 'cancel'].includes(result.intent)) return { intent: result.intent };
    if (fallback.localStart && result.intent === 'reschedule' && result.localStart && result.localStart !== fallback.localStart) {
      return { intent: 'reschedule' };
    }
  } catch {
    return fallback;
  }
  return fallback;
}
