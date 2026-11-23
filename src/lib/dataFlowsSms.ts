import { australianMobile } from './smsTypes';

export const dataFlowsSender = () => australianMobile(process.env.DATAFLOWS_SENDER_NUMBER ?? '');
export const dataFlowsConfigured = () => Boolean(process.env.DATAFLOWS_API_TOKEN && dataFlowsSender() &&
  (process.env.DATAFLOWS_WEBHOOK_SECRET?.length ?? 0) >= 32);
export const dataFlowsCutoverReady = () => dataFlowsConfigured() && process.env.DATAFLOWS_CUTOVER_READY === 'true' &&
  dataFlowsSender() !== australianMobile(process.env.TWILIO_SMS_FROM ?? '');

const basic = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extended = new Set(Array.from('^{}\\[~]|€\f'));

export function smsEstimate(body: string) {
  const chars = Array.from(body);
  const unicode = chars.some(char => !basic.has(char) && !extended.has(char));
  const lengths = chars.map(char => unicode ? char.length : extended.has(char) ? 2 : 1);
  if (lengths.reduce((sum, length) => sum + length, 0) <= (unicode ? 70 : 160)) return { unicode, segments: 1 };
  const limit = unicode ? 67 : 153;
  let segments = 1;
  let used = 0;
  for (const length of lengths) {
    if (used + length > limit) { segments++; used = 0; }
    used += length;
  }
  return { unicode, segments };
}

async function request(path: string, body?: object) {
  const base = new URL(process.env.DATAFLOWS_HTTP_API_URL || 'https://sms.dataflows.com.au/api/http/');
  if (base.origin !== 'https://sms.dataflows.com.au' || !/^\/api\/http\/?$/.test(base.pathname) || base.search || base.hash) {
    throw new Error('Invalid DataFlows HTTP API URL');
  }
  const response = await fetch(base.origin + '/api/http/' + path, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + process.env.DATAFLOWS_API_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== 'success') {
    throw Object.assign(new Error('DataFlows request was not confirmed'), {
      status: response.status >= 400 ? response.status : payload?.status === 'error' ? 422 : 0,
    });
  }
  return payload;
}

export async function sendDataFlowsSms(to: string, from: string, body: string) {
  const result = await request('sms/send', {
    recipient: to.slice(1), sender_id: from.slice(1), message: body, type: smsEstimate(body).unicode ? 'unicode' : 'plain',
  });
  const uid = result.uid ?? result.data?.uid ?? result.message_uid ?? result.data?.message_uid;
  // A success with an unrecognised identifier is ambiguous. Never resend it automatically.
  if (typeof uid !== 'string' || !/^[\w.-]{1,128}$/.test(uid)) throw new Error('DataFlows did not return a recognised message UID');
  return { sid: 'DF-' + uid, status: 'accepted' };
}
